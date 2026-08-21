/**
 * DS studio — Auto Retry
 * 每秒偵測 DeepSeek 對話中出現的「重試」按鈕，並自動點擊。
 *
 * 架構決策：
 *   - 使用 setInterval 輪詢（每 1000ms），與 sidebar-auto-hide.js 的
 *     RESIZE_DEBOUNCE_MS 的毫秒常數命名慣例一致，避免引入 MutationObserver。
 *   - 主開關（isEnabled）閘控交由 content/feature-toggle.js，本層不直讀儲存區；
 *     無獨立功能開關。
 *   - 選擇器採 fallback chain：語意 ds-* class 優先，hash class 為備援。
 */
const AutoRetry = {
    // === 常數 ===
    // 主要選擇器：語意化的 ds-* class（穩定層）
    RETRY_SELECTOR: '.ds-button--warning.ds-button--circle.ds-button--xs',
    // 備援選擇器：hash class，來源見 to-do/samples/retry-button.html
    RETRY_SELECTOR_FALLBACK: '.a3b9bd76._76a2310',
    CLICK_INTERVAL_MS: 1000,

    // === 狀態 ===
    enabled: false,
    _timer: null,

    // ─────────────────────────────
    //  Private: Helpers
    // ─────────────────────────────

    /**
     * 尋找頁面上第一個重試按鈕，依 fallback chain 查找。
     * @returns {Element|null}
     */
    _findRetryButton() {
        return document.querySelector(this.RETRY_SELECTOR) ||
               document.querySelector(this.RETRY_SELECTOR_FALLBACK) ||
               null;
    },

    /**
     * 每次輪詢執行：若已啟用且找到重試按鈕，則點擊。
     */
    _tick() {
        if (!this.enabled) return;

        const button = this._findRetryButton();
        if (button) button.click();
    },

    // ─────────────────────────────
    //  Private: Timer
    // ─────────────────────────────

    /**
     * 啟動輪詢計時器。若已存在則直接返回，避免重複建立。
     */
    _startTimer() {
        if (this._timer) return;
        this._timer = setInterval(() => this._tick(), this.CLICK_INTERVAL_MS);
    },

    /**
     * 停止並清除輪詢計時器。若不存在則直接返回。
     */
    _stopTimer() {
        if (!this._timer) return;
        clearInterval(this._timer);
        this._timer = null;
    },

    // ─────────────────────────────
    //  Public: Lifecycle methods
    // ─────────────────────────────

    /**
     * 啟用自動重試：啟動輪詢計時器。
     * Guard：已啟用時直接返回。
     */
    enable() {
        if (this.enabled) return;

        this.enabled = true;
        this._startTimer();
    },

    /**
     * 停用自動重試：停止輪詢計時器。
     * Guard：未啟用時直接返回。
     */
    disable() {
        if (!this.enabled) return;

        this.enabled = false;
        this._stopTimer();
    },

    /**
     * 初始化模組：把主開關閘控交給共用 registerFeatureToggle，
     * 初始值與後續變更皆由 background 透過訊息提供。
     */
    start() {
        const featureToggle = globalThis.DSSFeatureToggle
            || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
        if (!featureToggle) {
            throw new Error('content/auto-retry.js 需要 content/feature-toggle.js 先行載入');
        }

        featureToggle.registerFeatureToggle({
            onEnable: () => this.enable(),
            onDisable: () => this.disable(),
        });
    }
};

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
AutoRetry.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AutoRetry;
}

// Expose on window for cross-module access
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.AutoRetry = AutoRetry;
}
