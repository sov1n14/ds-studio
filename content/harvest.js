/**
 * DS studio — Harvest Module
 * 負責從虛擬化列表中增量捲動擷取完整對話訊息。
 *
 * 架構決策：
 *   - 此模組純屬 content 層，僅做 DOM 操作，不呼叫 chrome.storage。
 *   - 所有公開函式透過 window.DSstudio.Harvest 暴露，供同層其他模組呼叫。
 *   - 四大單責模組：(a) 擷取/捲動（本檔）、(b) 進度遮罩 UI（harvest.toast.js）、
 *     (c) 是否繼續/停止的純決策邏輯（harvest.policy.js）、
 *     (d) (由外部呼叫者) Markdown 組裝。
 *
 * 載入順序（manifest.json content_scripts）：
 *   1. content/harvest.toast.js  → 掛載 globalThis.__DS_Harvest_toast
 *   2. content/harvest.policy.js → 掛載 window.DSstudio.HarvestPolicy
 *   3. content/harvest.js        （本檔，合入以上 bundle）
 */

// 合併 Toast Bundle（瀏覽器：由 harvest.toast.js 在前載入設定 globalThis；Node.js 測試：直接 require）
const __DSHarvestToast = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_Harvest_toast ||
    (typeof require !== 'undefined' ? require('./harvest.toast.js') : {});
const showHarvestToastScrolling = __DSHarvestToast.showHarvestToastScrolling;
const showHarvestToastCapturing = __DSHarvestToast.showHarvestToastCapturing;
const hideHarvestToast = __DSHarvestToast.hideHarvestToast;

// 合併共用選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DSSelectorsHarvest = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

// 合併決策模組（瀏覽器：由 content/harvest.policy.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DSHarvestPolicy = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.HarvestPolicy ||
    (typeof require !== 'undefined' ? require('./harvest.policy.js') : undefined);

// ─────────────────────────────────────────────────────────────────
//  常數
// ─────────────────────────────────────────────────────────────────

/** 每步捲動距離係數（相對於 viewport 高度） */
const HARVEST_SCROLL_STEP_FACTOR = 0.9;

/** 每步等待 DOM 穩定的最長時間（ms） */
const HARVEST_STEP_TIMEOUT = 8000;

/** DOM 穩定判定：連續幾次未偵測到 mutation 即視為穩定 */
const HARVEST_STABLE_TICKS = 3;

/** DOM 穩定判定：穩定 tick 間隔（ms） */
const HARVEST_STABLE_INTERVAL = 100;

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
//  選擇器
// ─────────────────────────────────────────────────────────────────

/** 虛擬列表可見項目容器 */
const VISIBLE_ITEMS_SELECTOR = '.ds-virtual-list-visible-items';

/** 訊息元素 */
const MESSAGE_SELECTOR = '.ds-message';

/** 虛擬列表項目包裝（攜帶 data-virtual-list-item-key） */
const ITEM_KEY_ATTR = 'data-virtual-list-item-key';

/** 虛擬列表外容器（用於定位滾動容器；單一來源定義於 content/ds-selectors.js） */
const VIRTUAL_LIST_SELECTOR = __DSSelectorsHarvest.VIRTUAL_LIST_SELECTOR;
const VIRTUAL_LIST_FALLBACK = __DSSelectorsHarvest.VIRTUAL_LIST_FALLBACK;

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
                el.classList.contains(__DSSelectorsHarvest.SCROLL_AREA_CLASS) &&
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
 * 回傳值必須讓呼叫端檢查：scrollToTopAndWait 可能因逾時或使用者中途按下
 * GoToTop 按鈕中斷捲動而 resolve 為 { success:false }，若呼叫端忽略此值
 * 直接從目前捲動位置擷取，匯出的 Markdown 會靜默遺漏最舊的訊息。
 * @param {Element} container - 滾動容器
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function _scrollToTopAndSettle(container) {
    const goTop = window.DSstudio?.GoToTop;
    if (goTop && typeof goTop.scrollToTopAndWait === 'function') {
        return await goTop.scrollToTopAndWait({ timeout: 30000 });
    }
    container.scrollTop = 0;
    await _waitForDomStability(container, 3000);
    return { success: true };
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
 * 主要擷取函式：從頂到底增量捲動，蒐集所有虛擬化訊息節點。是否繼續或停止
 * 完全委派給 window.DSstudio.HarvestPolicy 純函式決定；本函式只提供觀測值
 * （含 Date.now()）並依裁決執行 DOM 操作。刻意移除整體逾時上限：只要仍有
 * 進度就不應被時間切斷，使用者可透過 Toast 取消鈕主動中止。
 * @returns {Promise<{items: Element[], isComplete: boolean, reason?: string}>}
 *   reason: 'cancelled' | 'stalled' | 'scroll_interrupted' | 'no_container' | 'no_messages' | undefined
 */
async function harvestAllMessages() {
    // ── Guard clauses ──────────────────────────────────────────────
    if (!__DSHarvestPolicy) {
        throw new Error('window.DSstudio.HarvestPolicy is required but was not found — check that content/harvest.policy.js loads before content/harvest.js in manifest.json');
    }

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
    // 用於使用者主動中止擷取（Toast 上的取消鈕）；生命週期僅限本次呼叫。
    const abortController = new AbortController();
    const onCancel = () => abortController.abort();

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
        // 啟用自動捲動攔截：確保頁面 React 無法在掃描途中自動跳至最新訊息破壞受控掃描。
        // harvest.js 在 isolated world，使用獨立 prototype，不受 patch 影響。
        const _preventAutoScroll = window.DSstudio?.PreventAutoScroll;
        if (_preventAutoScroll) {
            _preventAutoScroll.enable();
        }

        // 捲動至頂部階段：顯示捲動提示，不顯示數量（尚未擷取，顯示 0 則具誤導性）
        showHarvestToastScrolling(onCancel);
        const scrollResult = await _scrollToTopAndSettle(container);
        // 必須檢查回傳值：忽略 success:false 會從非頂部位置擷取，靜默漏收最舊訊息。
        if (scrollResult && scrollResult.success === false) {
            reason = scrollResult.reason;
            return { items: [], isComplete: false, reason };
        }
        captureVisible();
        // 抵達頂部後切換至擷取階段，顯示數量與警示
        showHarvestToastCapturing(capturedMap.size, onCancel);

        // 記錄捲到頂部後的起始預期位置
        _expectedScrollTop = container.scrollTop;

        // ── 步驟 2：逐步向下捲動並擷取，由 HarvestPolicy 裁決繼續或停止 ──
        let policyState = __DSHarvestPolicy.createInitialState({
            nowMs: Date.now(),
            capturedCount: capturedMap.size,
            scrollHeight: container.scrollHeight,
        });

        while (true) {
            // 每輪只讀取一次版面度量，避免重複讀取觸發多次 layout reflow。
            // 這些值僅在本輪內重用，下一輪捲動後會再重新讀取。
            const scrollTop = container.scrollTop;
            const clientHeight = container.clientHeight;
            const scrollHeight = container.scrollHeight;

            const isAtBottomNow =
                scrollTop + clientHeight >= scrollHeight - HARVEST_BOTTOM_TOLERANCE;

            if (isAtBottomNow) {
                bottomConfirmCount++;
            } else {
                // 重設底部確認計數（尚未到底）
                bottomConfirmCount = 0;
            }
            const isAtBottomConfirmed = isAtBottomNow && bottomConfirmCount >= HARVEST_BOTTOM_CONFIRM_COUNT;

            // Safety net：scrollTop 遠超預期位置（> 1.5x viewport）視為外部干預，標記中斷。
            const jumpThreshold = window.innerHeight * HARVEST_SCROLL_JUMP_THRESHOLD_FACTOR;
            const isScrollJumpDetected =
                scrollTop > _expectedScrollTop + jumpThreshold && !isAtBottomNow;

            const decision = __DSHarvestPolicy.decideNextStep(
                {
                    nowMs: Date.now(),
                    capturedCount: capturedMap.size,
                    scrollHeight,
                    isAtBottomConfirmed,
                    isAborted: abortController.signal.aborted,
                    isScrollJumpDetected,
                },
                policyState
            );
            policyState = decision.state;

            if (decision.action === 'stop') {
                reason = decision.reason;
                isComplete = reason === 'complete';
                if (isComplete) {
                    // 再擷取一次確保底部訊息被收入
                    captureVisible();
                }
                break;
            }

            if (isAtBottomNow) {
                // 尚未達到確認次數，繼續等待並重新擷取
                await _waitForDomStability(container, HARVEST_STEP_TIMEOUT);
                captureVisible();
                showHarvestToastCapturing(capturedMap.size, onCancel);
                // 在底部確認階段，更新預期位置為當前值（允許位置穩定）
                _expectedScrollTop = container.scrollTop;
                continue;
            }

            // 向下捲一步，並更新預期位置
            container.scrollBy(0, window.innerHeight * HARVEST_SCROLL_STEP_FACTOR);
            _expectedScrollTop = container.scrollTop;

            // 等待 DOM 穩定（lazy-load 注入新節點）
            await _waitForDomStability(container, HARVEST_STEP_TIMEOUT);

            captureVisible();
            showHarvestToastCapturing(capturedMap.size, onCancel);
        }
    } finally {
        // disable() 必須在 finally 中確保即使拋出也能還原，讓頁面恢復正常自動捲動行為。
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
