/**
 * DS studio — Harvest Module
 * 負責從虛擬化列表中增量捲動擷取完整對話訊息。
 *
 * 架構決策：
 *   - 此模組純屬 content 層，僅做 DOM 操作，不呼叫 chrome.storage。
 *   - 所有公開函式透過 window.DSstudio.Harvest 暴露，供同層其他模組呼叫。
 *   - 五大單責模組：(a) 迴圈編排/捲動控制（本檔）、(b) DOM 探測與量測（harvest.dom.js）、
 *     (c) 進度遮罩 UI（harvest.toast.js）、
 *     (d) 是否繼續/停止與捲動步進的純決策邏輯（harvest.policy.js）、
 *     (e) (由外部呼叫者) Markdown 組裝。
 *
 * 載入順序（manifest.json content_scripts）：
 *   1. content/harvest.toast.js  → 掛載 globalThis.__DS_Harvest_toast
 *   2. content/harvest.dom.js    → 掛載 globalThis.__DS_Harvest_dom
 *   3. content/harvest.policy.js → 掛載 window.DSstudio.HarvestPolicy
 *   4. content/harvest.js        （本檔，合入以上 bundle）
 */

// 合併 Toast Bundle（瀏覽器：由 harvest.toast.js 在前載入設定 globalThis；Node.js 測試：直接 require）
const __DSHarvestToast = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_Harvest_toast ||
    (typeof require !== 'undefined' ? require('./harvest.toast.js') : {});
const showHarvestToastScrolling = __DSHarvestToast.showHarvestToastScrolling;
const showHarvestToastCapturing = __DSHarvestToast.showHarvestToastCapturing;
const hideHarvestToast = __DSHarvestToast.hideHarvestToast;

// 合併 DOM 探測/量測 Bundle（瀏覽器：由 harvest.dom.js 在前載入設定 globalThis；Node.js 測試：直接 require）
const __DSHarvestDom = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_Harvest_dom ||
    (typeof require !== 'undefined' ? require('./harvest.dom.js') : {});
const VISIBLE_ITEMS_SELECTOR = __DSHarvestDom.VISIBLE_ITEMS_SELECTOR;
const MESSAGE_SELECTOR = __DSHarvestDom.MESSAGE_SELECTOR;
const _findHarvestScrollContainer = __DSHarvestDom._findHarvestScrollContainer;
const _harvestVisibleMessages = __DSHarvestDom._harvestVisibleMessages;
const _waitForDomStability = __DSHarvestDom._waitForDomStability;
const _isAtBottom = __DSHarvestDom._isAtBottom;
const _measureMountedBottomOffset = __DSHarvestDom._measureMountedBottomOffset;

// 合併決策模組（瀏覽器：由 content/harvest.policy.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DSHarvestPolicy = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.HarvestPolicy ||
    (typeof require !== 'undefined' ? require('./harvest.policy.js') : undefined);

// ─────────────────────────────────────────────────────────────────
//  常數
// ─────────────────────────────────────────────────────────────────

/** 每步等待 DOM 穩定的最長時間（ms） */
const HARVEST_STEP_TIMEOUT = 8000;

/** 底部確認需連續幾次穩定才算真的到底 */
const HARVEST_BOTTOM_CONFIRM_COUNT = 3;

/**
 * 捲動跳躍偵測：若 scrollTop 與預期位置偏差超過此閾值（px），
 * 視為外部意外跳躍（safety net）。
 * 設為 viewport 高度的倍數以避免誤判正常捲動。
 */
const HARVEST_SCROLL_JUMP_THRESHOLD_FACTOR = 1.5;

// ─────────────────────────────────────────────────────────────────
//  (a) 迴圈編排 / 捲動控制
// ─────────────────────────────────────────────────────────────────

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
            const scrollHeight = container.scrollHeight;

            // 底部判定與容差常數的單一來源為 harvest.dom.js 的 _isAtBottom()。
            const isAtBottomNow = _isAtBottom(container);

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

            // 量測目前掛載內容底部量測值，交由 HarvestPolicy 換算為本步捲動距離；
            // 量測不可用時回傳 null，policy 內部會退回舊版固定步進。
            const mountedBottomOffset = _measureMountedBottomOffset(container);
            const scrollStep = __DSHarvestPolicy.computeScrollStep({
                mountedBottomOffset,
                viewportHeight: window.innerHeight,
            });

            // 向下捲一步，並更新預期位置
            container.scrollBy(0, scrollStep);
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
