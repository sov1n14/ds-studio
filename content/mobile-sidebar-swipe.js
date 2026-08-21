/**
 * DS studio — Mobile Sidebar Swipe
 * Detects right-swipe gestures within the central 80% viewport area on
 * mobile devices and clicks the sidebar toggle button to show/hide the
 * navigation sidebar.
 *
 * 觸發區域：畫面正中央 80% 區域（水平與垂直各扣除 10% 邊界），
 * 在該區域內向右滑動即可展開側邊欄。
 *
 * 架構決策：
 *   - 僅在行動裝置（觸控或行動 UA）上啟動，桌面端零開銷；
 *     判定委派 content/mobile-device.js 的共用實作。
 *   - 主開關閘控委派 content/feature-toggle.js 的共用管線（本功能無自身開關）。
 *   - 側邊欄切換按鈕的 DOM 就緒輪詢委派 content/retry-until.js。
 */
// 共用模組（瀏覽器：由 manifest 於前載入設定 globalThis；Node.js 測試：直接 require）
const __DS_SwipeMobileDevice = globalThis.DSSMobileDevice
    || (typeof require !== 'undefined' ? require('./mobile-device.js') : null);
const __DS_SwipeFeatureToggle = globalThis.DSSFeatureToggle
    || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
const __DS_SwipeRetryUntil = globalThis.DSSRetryUntil
    || (typeof require !== 'undefined' ? require('./retry-until.js') : null);
if (!__DS_SwipeMobileDevice || !__DS_SwipeFeatureToggle || !__DS_SwipeRetryUntil) {
    throw new Error('content/mobile-sidebar-swipe.js 需要 content/mobile-device.js、content/feature-toggle.js 與 content/retry-until.js 先行載入');
}
const MobileSidebarSwipe = {
    // === 常數 ===
    SWIPE_THRESHOLD_PX: 50,
    SWIPE_MAX_DURATION_MS: 500,
    // 觸發區域邊界比例：水平與垂直各扣除 10%，保留正中央 80% 區域
    TRIGGER_ZONE_MARGIN_RATIO: 0.10,
    DOM_RETRY_INTERVAL_MS: 500,
    DOM_MAX_RETRIES: 60,

    // === 狀態 ===
    enabled: false,
    _isTouchBound: false,
    _startPoint: null,
    _startTime: null,
    _deltaX: 0,
    _deltaY: 0,
    _touchStartHandler: null,
    _touchMoveHandler: null,
    _touchEndHandler: null,
    _domRetryCancel: null,
    _unregisterToggle: null,

    // ─────────────────────────────
    //  Private: Helpers
    // ─────────────────────────────

    /**
     * 嘗試以多重選擇器找到側邊欄切換按鈕。
     * 主選擇器使用穩定的 ds-* class 組合；降級路徑逐一嘗試各 class 組合。
     * @returns {Element|null}
     */
    _findButton() {
        // 主選擇器（from sidebar-buttom.html）
        const primary = document.querySelector(
            'div.ds-button--capsule.ds-button--iconLabelPrimary[role="button"]'
        );
        if (primary) return primary;

        // 降級路徑：逐一嘗試各 class 組合
        const fallbacks = [
            '.ds-button--capsule.ds-button--iconLabelPrimary',
            '.ds-button--capsule.ds-button--icon',
            '.ds-button--iconLabelPrimary.ds-button--icon',
            '.ds-button--capsule[role="button"]',
            '.ds-button--xl[role="button"]',
        ];
        for (const sel of fallbacks) {
            const el = document.querySelector(sel);
            if (el) return el;
        }

        return null;
    },

    /**
     * 以共用輪詢等待目標按鈕 DOM 就緒後綁定觸控事件。
     * 立即判定一次，之後每 500ms 重試，最多 60 次（≈30s）；
     * 次數用盡即靜默放棄（不拋出錯誤）。
     */
    _tryConnectDom() {
        if (!this.enabled) return;

        this._cancelDomRetry();
        this._domRetryCancel = __DS_SwipeRetryUntil(() => this._findButton(), {
            intervalMs: this.DOM_RETRY_INTERVAL_MS,
            maxRetries: this.DOM_MAX_RETRIES,
            onReady: () => this._bindTouchEvents(),
        });
    },

    // ─────────────────────────────
    //  Private: Touch event handlers
    // ─────────────────────────────

    /**
     * touchstart 處理器：記錄起始點與時間。
     * 僅在觸控點位於畫面正中央 80% 區域內時才追蹤（水平與垂直各扣除 10% 邊界）。
     * @param {TouchEvent} e
     */
    _onTouchStart(e) {
        if (!this.enabled) return;
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;

        const touch = e.touches[0];
        if (!touch) return;

        const vpWidth = window.innerWidth;
        const vpHeight = window.innerHeight;
        const margin = this.TRIGGER_ZONE_MARGIN_RATIO;

        // 水平範圍：扣除左右各 10%，保留中央 80%
        const minX = vpWidth * margin;
        const maxX = vpWidth * (1 - margin);
        if (touch.clientX < minX || touch.clientX > maxX) return;

        // 垂直範圍：扣除上下各 10%，保留中央 80%
        const minY = vpHeight * margin;
        const maxY = vpHeight * (1 - margin);
        if (touch.clientY < minY || touch.clientY > maxY) return;

        this._startPoint = { x: touch.clientX, y: touch.clientY };
        this._startTime = Date.now();
        this._deltaX = 0;
        this._deltaY = 0;
    },

    /**
     * touchmove 處理器：追蹤手指位移量。
     * @param {TouchEvent} e
     */
    _onTouchMove(e) {
        if (!this.enabled) return;
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;
        if (!this._startPoint) return;

        const touch = e.touches[0];
        if (!touch) return;

        this._deltaX = touch.clientX - this._startPoint.x;
        this._deltaY = touch.clientY - this._startPoint.y;
    },

    /**
     * touchend 處理器：驗證滑動手勢條件並觸發按鈕點擊。
     *
     * 五項條件必須全部滿足：
     *   a. deltaX ≥ 50px（最小滑動距離）
     *   b. deltaX > |deltaY| * 1.5（主要為水平方向）
     *   c. 持續時間 < 500ms（非慢速拖曳）
     *   d. 起點位於畫面中央 80% 水平區域內
     *   e. 起點位於畫面中央 80% 垂直區域內
     */
    _onTouchEnd() {
        if (!this.enabled) return;
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;
        if (!this._startPoint) return;

        const deltaX = this._deltaX;
        const deltaY = this._deltaY;
        const duration = Date.now() - this._startTime;
        const startX = this._startPoint.x;
        const startY = this._startPoint.y;

        // 立即重設滑動狀態，防止 touchend 重複觸發
        this._startPoint = null;
        this._startTime = null;
        this._deltaX = 0;
        this._deltaY = 0;

        // 條件 a：最小滑動距離 ≥ 50px
        if (deltaX < this.SWIPE_THRESHOLD_PX) return;

        // 條件 b：主要為水平方向（deltaX > |deltaY| * 1.5）
        if (deltaX <= Math.abs(deltaY) * 1.5) return;

        // 條件 c：持續時間 < 500ms（非慢速拖曳）
        if (duration >= this.SWIPE_MAX_DURATION_MS) return;

        // 條件 d+e：起點必須位於畫面中央 80% 區域內（水平與垂直各扣除 10%）
        const vpWidth = window.innerWidth;
        const vpHeight = window.innerHeight;
        const margin = this.TRIGGER_ZONE_MARGIN_RATIO;
        if (startX < vpWidth * margin || startX > vpWidth * (1 - margin)) return;
        if (startY < vpHeight * margin || startY > vpHeight * (1 - margin)) return;

        // 所有條件滿足：尋找按鈕並點擊
        const button = this._findButton();
        if (button) {
            button.click();
        }
    },

    // ─────────────────────────────
    //  Private: Event binding
    // ─────────────────────────────

    /**
     * 綁定觸控事件監聽器至 document。
     * touchstart 使用 passive: false（預留 preventDefault 可能性）；
     * touchmove 與 touchend 使用 passive: true。
     */
    _bindTouchEvents() {
        if (this._isTouchBound) return;

        this._touchStartHandler = (e) => this._onTouchStart(e);
        this._touchMoveHandler = (e) => this._onTouchMove(e);
        this._touchEndHandler = () => this._onTouchEnd();

        document.addEventListener('touchstart', this._touchStartHandler, { passive: false });
        document.addEventListener('touchmove', this._touchMoveHandler, { passive: true });
        document.addEventListener('touchend', this._touchEndHandler, { passive: true });

        this._isTouchBound = true;
    },

    /**
     * 解除所有觸控事件監聽器並重設綁定狀態。
     */
    _unbindTouchEvents() {
        if (!this._isTouchBound) return;

        if (this._touchStartHandler) {
            document.removeEventListener('touchstart', this._touchStartHandler);
            this._touchStartHandler = null;
        }
        if (this._touchMoveHandler) {
            document.removeEventListener('touchmove', this._touchMoveHandler);
            this._touchMoveHandler = null;
        }
        if (this._touchEndHandler) {
            document.removeEventListener('touchend', this._touchEndHandler);
            this._touchEndHandler = null;
        }

        this._isTouchBound = false;
    },

    // ─────────────────────────────
    //  Public: Lifecycle methods
    // ─────────────────────────────

    /**
     * Enable the swipe gesture: start polling for button DOM.
     * Once the button is found, touch event listeners are bound.
     */
    enable() {
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;
        if (this.enabled) return;
        this.enabled = true;

        this._tryConnectDom();
    },

    /**
     * Disable the swipe gesture: unbind all touch listeners,
     * clear all timers, and reset gesture tracking state.
     */
    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        this._unbindTouchEvents();
        this._cancelDomRetry();
        this._resetSwipeState();
    },

    /**
     * Full cleanup: disable the module and remove all listeners.
     */
    destroy() {
        this.disable();
        if (this._unregisterToggle) {
            this._unregisterToggle();
            this._unregisterToggle = null;
        }
    },

    /**
     * 初始化模組：確認為行動裝置後，將主開關閘控交給共用管線。
     */
    start() {
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;

        this._unregisterToggle = __DS_SwipeFeatureToggle.registerFeatureToggle({
            onEnable: () => this.enable(),
            onDisable: () => this.disable(),
        });
    },

    // ─────────────────────────────
    //  Private: Internal helpers
    // ─────────────────────────────

    /**
     * 取消進行中的 DOM 就緒輪詢（可重複呼叫）。
     */
    _cancelDomRetry() {
        if (!this._domRetryCancel) return;
        this._domRetryCancel();
        this._domRetryCancel = null;
    },

    /**
     * 重設手勢追蹤狀態。
     */
    _resetSwipeState() {
        this._startPoint = null;
        this._startTime = null;
        this._deltaX = 0;
        this._deltaY = 0;
    }
};

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
MobileSidebarSwipe.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MobileSidebarSwipe;
}

// Expose on window for cross-module access
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.MobileSidebarSwipe = MobileSidebarSwipe;
}
