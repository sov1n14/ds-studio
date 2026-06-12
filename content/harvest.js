/**
 * DS studio — Harvest Module
 * 負責從虛擬化列表中增量捲動擷取完整對話訊息。
 *
 * 架構決策：
 *   - 此模組純屬 content 層，僅做 DOM 操作，不呼叫 chrome.storage。
 *   - 所有公開函式透過 window.DSstudio.Harvest 暴露，供同層其他模組呼叫。
 *   - 三大單責模組：(a) 擷取/捲動、(b) 進度遮罩 UI、(c) (由外部呼叫者) Markdown 組裝。
 */

// ─────────────────────────────────────────────────────────────────
//  常數
// ─────────────────────────────────────────────────────────────────

/** 每步捲動距離係數（相對於 viewport 高度） */
const HARVEST_SCROLL_STEP_FACTOR = 0.9;

/** 整體擷取超時（ms） */
const HARVEST_TOTAL_TIMEOUT = 120000;

/** 每步等待 DOM 穩定的最長時間（ms） */
const HARVEST_STEP_TIMEOUT = 8000;

/** DOM 穩定判定：連續幾次未偵測到 mutation 即視為穩定 */
const HARVEST_STABLE_TICKS = 3;

/** DOM 穩定判定：穩定 tick 間隔（ms） */
const HARVEST_STABLE_INTERVAL = 150;

/** 判定抵達底部：scrollTop + clientHeight >= scrollHeight - 此容差（px） */
const HARVEST_BOTTOM_TOLERANCE = 4;

/** 底部確認需連續幾次穩定才算真的到底 */
const HARVEST_BOTTOM_CONFIRM_COUNT = 3;

/**
 * 捲動跳躍偵測：若 scrollTop 與預期位置偏差超過此閾值（px），
 * 視為外部意外跳躍（safety net）。
 * 設為 viewport 高度的倍數以避免誤判正常捲動。
 */
const HARVEST_SCROLL_JUMP_THRESHOLD_FACTOR = 1.5;

// ─────────────────────────────────────────────────────────────────
//  選擇器（與 go-top.js 保持一致，提供回退）
// ─────────────────────────────────────────────────────────────────

/** 虛擬列表可見項目容器 */
const VISIBLE_ITEMS_SELECTOR = '.ds-virtual-list-visible-items';

/** 訊息元素 */
const MESSAGE_SELECTOR = '.ds-message';

/** 虛擬列表項目包裝（攜帶 data-virtual-list-item-key） */
const ITEM_KEY_ATTR = 'data-virtual-list-item-key';

/** 虛擬列表外容器（用於定位滾動容器） */
const VIRTUAL_LIST_SELECTOR = '.ds-virtual-list-items._6f2c522';
const VIRTUAL_LIST_FALLBACK = '[class*="ds-virtual-list-items"]';

// ─────────────────────────────────────────────────────────────────
//  (a) 擷取/捲動邏輯
// ─────────────────────────────────────────────────────────────────

/**
 * 定位對話的滾動容器。
 * 策略：從虛擬列表向上走，找到 .ds-scroll-area 且具備可滾動高度的元素。
 * 若失敗回退到 document.scrollingElement。
 * @returns {Element} 滾動容器
 */
function _findHarvestScrollContainer() {
    // 策略 1：從虛擬列表容器向上找 .ds-scroll-area
    const virtualList =
        document.querySelector(VIRTUAL_LIST_SELECTOR) ||
        document.querySelector(VIRTUAL_LIST_FALLBACK);

    if (virtualList) {
        let el = virtualList.parentElement;
        while (el && el !== document.body) {
            if (
                el.classList.contains('ds-scroll-area') &&
                el.scrollHeight > el.clientHeight
            ) {
                return el;
            }
            el = el.parentElement;
        }
    }

    // 策略 2：從可見訊息向上走，找第一個 overflow:auto/scroll 的元素
    const firstMsg = document.querySelector(
        `${VISIBLE_ITEMS_SELECTOR} ${MESSAGE_SELECTOR}`
    );
    if (firstMsg) {
        let el = firstMsg.parentElement;
        while (el && el !== document.body) {
            const style = getComputedStyle(el);
            const overflowY = style.overflowY;
            if (
                (overflowY === 'auto' || overflowY === 'scroll') &&
                el.scrollHeight > el.clientHeight
            ) {
                return el;
            }
            el = el.parentElement;
        }
    }

    // 最後回退
    return document.scrollingElement || document.documentElement;
}

/**
 * 取得目前可見的訊息，回傳 { key, clonedNode } 陣列。
 * 每個訊息節點被克隆以防止後續 React 虛擬化銷毀。
 * @returns {Array<{key: number, clonedNode: Element}>}
 */
function _harvestVisibleMessages() {
    // 找到虛擬列表可見項目容器（可能有多個，取所有）
    const visibleContainers = document.querySelectorAll(VISIBLE_ITEMS_SELECTOR);

    /** @type {Array<{key: number, clonedNode: Element}>} */
    const results = [];

    visibleContainers.forEach(container => {
        const messages = container.querySelectorAll(MESSAGE_SELECTOR);
        messages.forEach(msg => {
            // 找到攜帶 data-virtual-list-item-key 的最近祖先（或自身）
            let keyEl = msg.closest(`[${ITEM_KEY_ATTR}]`);
            if (!keyEl) return;

            const rawKey = keyEl.getAttribute(ITEM_KEY_ATTR);
            const key = parseInt(rawKey, 10);
            // 跳過非數字 key
            if (isNaN(key)) return;

            results.push({ key, clonedNode: msg.cloneNode(true) });
        });
    });

    return results;
}

/**
 * 等待滾動容器內 DOM 穩定（連續 HARVEST_STABLE_TICKS 個 interval 無 mutation）。
 * 同時設有逾時保護，逾時後仍 resolve（不拋出），讓主流程繼續。
 * @param {Element} container - 要觀察的滾動容器
 * @param {number} stepTimeout - 最大等待時間（ms）
 * @returns {Promise<void>}
 */
function _waitForDomStability(container, stepTimeout) {
    return new Promise((resolve) => {
        let stableTicks = 0;
        let isMutated = false;

        const observer = new MutationObserver(() => {
            // 偵測到 mutation，重設穩定計數
            isMutated = true;
            stableTicks = 0;
        });

        observer.observe(container, { childList: true, subtree: true });

        const timeoutId = setTimeout(() => {
            // 超時仍繼續
            observer.disconnect();
            clearInterval(tickId);
            resolve();
        }, stepTimeout);

        const tickId = setInterval(() => {
            if (!isMutated) {
                stableTicks++;
            }
            isMutated = false;

            if (stableTicks >= HARVEST_STABLE_TICKS) {
                clearTimeout(timeoutId);
                clearInterval(tickId);
                observer.disconnect();
                resolve();
            }
        }, HARVEST_STABLE_INTERVAL);
    });
}

/**
 * 捲動到頂部並等待 DOM 穩定。
 * 優先使用 GoToTop.scrollToTopAndWait（已有完整的 lazy-load 等待邏輯），
 * 若不可用則直接設 scrollTop = 0。
 * @param {Element} container - 滾動容器
 * @returns {Promise<void>}
 */
async function _scrollToTopAndSettle(container) {
    const goTop = window.DSstudio?.GoToTop;
    if (goTop && typeof goTop.scrollToTopAndWait === 'function') {
        await goTop.scrollToTopAndWait({ timeout: 30000 });
    } else {
        container.scrollTop = 0;
        await _waitForDomStability(container, 3000);
    }
}

/**
 * 判斷滾動容器是否已抵達底部。
 * @param {Element} container
 * @returns {boolean}
 */
function _isAtBottom(container) {
    return (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - HARVEST_BOTTOM_TOLERANCE
    );
}

/**
 * 主要擷取函式：從頂到底增量捲動，蒐集所有虛擬化訊息節點。
 *
 * 回傳形狀：
 * ```
 * {
 *   items: Element[],       // 按 data-virtual-list-item-key 數字排序的克隆訊息節點
 *   isComplete: boolean,    // true = 成功捲到底；false = 超時或其他中斷
 *   reason?: string         // 中斷原因（'timeout' | 'no_container' | 'no_messages' | 'scroll_interrupted'）
 * }
 * ```
 *
 * @returns {Promise<{items: Element[], isComplete: boolean, reason?: string}>}
 */
async function harvestAllMessages() {
    // ── Guard clauses ──────────────────────────────────────────────
    const container = _findHarvestScrollContainer();
    if (
        !container ||
        container === document.scrollingElement ||
        container === document.documentElement
    ) {
        return { items: [], isComplete: false, reason: 'no_container' };
    }

    const hasSomeMessages = !!document.querySelector(
        `${VISIBLE_ITEMS_SELECTOR} ${MESSAGE_SELECTOR}`
    );
    if (!hasSomeMessages) {
        return { items: [], isComplete: false, reason: 'no_messages' };
    }

    // ── 初始化 ─────────────────────────────────────────────────────
    const startTime = Date.now();
    /** Map<number, Element> — key 為 data-virtual-list-item-key 的整數值 */
    const capturedMap = new Map();
    /** 記錄原始 scrollTop 以便事後還原 */
    const originalScrollTop = container.scrollTop;
    let isComplete = false;
    let reason;
    let bottomConfirmCount = 0;
    /**
     * Safety net：記錄每步捲動前的預期 scrollTop，
     * 用於偵測外部意外跳躍（如頁面 React auto-scroll 穿透了 patch）。
     */
    let _expectedScrollTop = 0;

    /**
     * 將目前可見訊息寫入 capturedMap（略過已有的 key）。
     * @returns {number} 本次新增的項目數
     */
    function captureVisible() {
        const visible = _harvestVisibleMessages();
        let newCount = 0;
        visible.forEach(({ key, clonedNode }) => {
            if (!capturedMap.has(key)) {
                capturedMap.set(key, clonedNode);
                newCount++;
            }
        });
        return newCount;
    }

    try {
        // ── 步驟 1：啟用自動捲動攔截，捲到頂部 ──────────────────────
        // 在捲到頂部之前啟用 PreventAutoScroll，以確保頁面 React 無法在掃描途中
        // 自動跳至最新訊息破壞受控掃描。
        // harvest.js 在 isolated world，使用獨立 prototype，不受 patch 影響。
        const _preventAutoScroll = window.DSstudio?.PreventAutoScroll;
        if (_preventAutoScroll) {
            _preventAutoScroll.enable();
        }

        // 捲動至頂部階段：顯示捲動提示，不顯示數量（尚未擷取，顯示 0 則具誤導性）
        showHarvestToastScrolling();
        await _scrollToTopAndSettle(container);
        captureVisible();
        // 抵達頂部後切換至擷取階段，顯示數量與警示
        showHarvestToastCapturing(capturedMap.size);

        // 記錄捲到頂部後的起始預期位置
        _expectedScrollTop = container.scrollTop;

        // ── 步驟 2：逐步向下捲動並擷取 ───────────────────────────────
        while (true) {
            // 整體超時保護
            if (Date.now() - startTime > HARVEST_TOTAL_TIMEOUT) {
                reason = 'timeout';
                break;
            }

            // ── Safety net：偵測外部意外跳躍 ─────────────────────────
            // 若目前 scrollTop 遠超預期位置（超過 1.5x viewport），
            // 判定為頁面外部干預（patch 未能完全攔截），標記中斷。
            // 保守閾值設計：正常 scrollBy 步進為 0.9x viewport，
            // 只有跳躍量大幅超過正常步進才觸發，避免誤判。
            const jumpThreshold = window.innerHeight * HARVEST_SCROLL_JUMP_THRESHOLD_FACTOR;
            const actualScrollTop = container.scrollTop;
            if (actualScrollTop > _expectedScrollTop + jumpThreshold && !_isAtBottom(container)) {
                // 意外跳躍：捲動位置遠超預期，且尚未到底（若到底則可能是正常的）
                isComplete = false;
                reason = 'scroll_interrupted';
                break;
            }

            // 判斷是否已抵達底部
            if (_isAtBottom(container)) {
                bottomConfirmCount++;
                if (bottomConfirmCount >= HARVEST_BOTTOM_CONFIRM_COUNT) {
                    // 再擷取一次確保底部訊息被收入
                    captureVisible();
                    isComplete = true;
                    break;
                }
                // 尚未達到確認次數，繼續等待並重新擷取
                await _waitForDomStability(container, HARVEST_STEP_TIMEOUT);
                captureVisible();
                showHarvestToastCapturing(capturedMap.size);
                // 在底部確認階段，更新預期位置為當前值（允許位置穩定）
                _expectedScrollTop = container.scrollTop;
                continue;
            }

            // 重設底部確認計數（尚未到底）
            bottomConfirmCount = 0;

            // 向下捲一步，並更新預期位置
            container.scrollBy(0, window.innerHeight * HARVEST_SCROLL_STEP_FACTOR);
            _expectedScrollTop = container.scrollTop;

            // 等待 DOM 穩定（lazy-load 注入新節點）
            await _waitForDomStability(container, HARVEST_STEP_TIMEOUT);

            captureVisible();
            showHarvestToastCapturing(capturedMap.size);
        }
    } finally {
        // ── 步驟 3：停用自動捲動攔截、還原捲動位置 ──────────────────
        // disable() 必須在 finally 中確保即使拋出也能還原，
        // 讓頁面恢復正常自動捲動行為。
        const _preventAutoScrollFinal = window.DSstudio?.PreventAutoScroll;
        if (_preventAutoScrollFinal) {
            _preventAutoScrollFinal.disable();
        }

        try {
            container.scrollTop = originalScrollTop;
        } catch (_) {
            // 忽略還原失敗（容器可能已被 React 重新渲染）
        }
        hideHarvestToast();
    }

    // ── 排序輸出 ────────────────────────────────────────────────────
    // 依 key 數字由小到大排序，確保訊息順序正確
    const sortedKeys = Array.from(capturedMap.keys()).sort((a, b) => a - b);
    const items = sortedKeys.map(k => capturedMap.get(k));

    return { items, isComplete, reason };
}

// ─────────────────────────────────────────────────────────────────
//  (b) 進度遮罩 UI
// ─────────────────────────────────────────────────────────────────

/**
 * 確保 Toast 容器存在並回傳它（若不存在則建立）。
 * 建立時同時產生 __text 與 __warn 兩個子元素。
 * @returns {Element} Toast 根節點
 */
function _ensureHarvestToast() {
    let toast = document.querySelector('.dss-harvest-toast');
    if (toast) return toast;

    toast = document.createElement('div');
    toast.className = 'dss-harvest-toast';

    // 第一行：主要進度文字
    const text = document.createElement('p');
    text.className = 'dss-harvest-toast__text';
    toast.appendChild(text);

    // 第二行：操作警示（擷取階段才顯示）
    const warn = document.createElement('p');
    warn.className = 'dss-harvest-toast__warn';
    toast.appendChild(warn);

    document.body.appendChild(toast);
    return toast;
}

/**
 * 【捲動至頂部階段】顯示 Toast，文字為「正在捲動至對話頂端…」，不顯示數量。
 * 警示行保持隱藏，避免使用者在尚未開始擷取時看到不相干警告。
 */
function showHarvestToastScrolling() {
    const toast = _ensureHarvestToast();

    const text = toast.querySelector('.dss-harvest-toast__text');
    if (text) {
        text.textContent = '正在捲動至對話頂端…';
    }

    // 捲動階段不顯示警示行
    const warn = toast.querySelector('.dss-harvest-toast__warn');
    if (warn) {
        warn.style.display = 'none';
    }

    toast.style.display = 'block';
}

/**
 * 【擷取階段】切換至擷取狀態並更新已擷取數量，同時顯示操作警示。
 * 在向下掃描的每一步呼叫，N 隨實際擷取數量即時更新。
 * @param {number} capturedCount - 已擷取訊息數
 */
function showHarvestToastCapturing(capturedCount) {
    if (typeof capturedCount !== 'number') return;

    const toast = _ensureHarvestToast();

    // 第一行：進度數量
    const text = toast.querySelector('.dss-harvest-toast__text');
    if (text) {
        text.textContent = `正在擷取完整對話… 已擷取 ${capturedCount} 則`;
    }

    // 第二行：警示——整個擷取階段持續可見
    const warn = toast.querySelector('.dss-harvest-toast__warn');
    if (warn) {
        warn.textContent = '⚠ 請勿捲動對話記錄，以免擷取失敗';
        warn.style.display = '';
    }

    toast.style.display = 'block';
}

/**
 * 隱藏 Toast（擷取結束時呼叫，finally 區塊保證執行）。
 */
function hideHarvestToast() {
    const toast = document.querySelector('.dss-harvest-toast');
    if (toast) {
        toast.style.display = 'none';
    }
}

// ─────────────────────────────────────────────────────────────────
//  模組匯出
// ─────────────────────────────────────────────────────────────────

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        harvestAllMessages,
        showHarvestToastScrolling,
        showHarvestToastCapturing,
        hideHarvestToast,
        _findHarvestScrollContainer,
        _harvestVisibleMessages,
        _waitForDomStability,
        _isAtBottom,
    };
}

// 透過 window.DSstudio 供同層模組呼叫
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.Harvest = {
        harvestAllMessages,
        showHarvestToastScrolling,
        showHarvestToastCapturing,
        hideHarvestToast,
    };
}
