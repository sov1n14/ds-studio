/**
 * DS studio — Mobile Homepage Cleanup
 * 在行動裝置上，當路徑為首頁（'/'）時，永久移除所有帶有 CSS class `_9579690`
 * 的 DOM 元素。使用 MutationObserver 應對 DeepSeek SPA 動態插入的元素。
 *
 * 架構決策：
 *   - 僅在行動裝置（觸控或行動 UA）上啟動，桌面端零開銷；
 *     判定委派 content/mobile-device.js 的共用實作。
 *   - 以 _isHomepage() 防護所有生命週期函式。
 *   - 主開關閘控委派 content/feature-toggle.js 的共用管線（本功能無自身開關）。
 *   - MutationObserver 監聽 document.body 子樹變更，即時清除目標元素。
 */
// 共用模組（瀏覽器：由 manifest 於前載入設定 globalThis；Node.js 測試：直接 require）
const __DS_CleanupMobileDevice = globalThis.DSSMobileDevice
    || (typeof require !== 'undefined' ? require('./mobile-device.js') : null);
const __DS_CleanupFeatureToggle = globalThis.DSSFeatureToggle
    || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
if (!__DS_CleanupMobileDevice || !__DS_CleanupFeatureToggle) {
    throw new Error('content/mobile-homepage-cleanup.js 需要 content/mobile-device.js 與 content/feature-toggle.js 先行載入');
}
const MobileHomepageCleanup = {
    // === 狀態 ===
    enabled: false,
    _observer: null,
    _unregisterToggle: null,

    // ─────────────────────────────
    //  Private: Helpers
    // ─────────────────────────────

    /**
     * 判斷目前路徑是否為首頁。
     * @returns {boolean}
     */
    _isHomepage() {
        return window.location.pathname === '/';
    },

    /**
     * 移除頁面中所有帶有 `_9579690` class 的 DOM 元素。
     */
    _removeTargetElements() {
        document.querySelectorAll('._9579690').forEach(el => el.remove());
    },

    // ─────────────────────────────
    //  Private: Observer
    // ─────────────────────────────

    /**
     * 啟動 MutationObserver，監聽 document.body 子樹變更。
     * 每次 DOM 異動後，若模組啟用且在首頁，立即清除目標元素。
     * 若 Observer 已存在則直接返回，避免重複建立。
     */
    _startObserver() {
        if (this._observer) return;

        this._observer = new MutationObserver(() => {
            if (!this.enabled) return;
            if (!this._isHomepage()) return;
            this._removeTargetElements();
        });

        this._observer.observe(document.body, { childList: true, subtree: true });
    },

    /**
     * 停止並清除 MutationObserver。
     * 若 Observer 不存在則直接返回。
     */
    _stopObserver() {
        if (!this._observer) return;

        this._observer.disconnect();
        this._observer = null;
    },

    // ─────────────────────────────
    //  Public: Lifecycle methods
    // ─────────────────────────────

    /**
     * 啟用清理功能：立即移除首頁目標元素，並啟動 MutationObserver。
     * Guard：非行動裝置或已啟用時直接返回。
     */
    enable() {
        if (!__DS_CleanupMobileDevice.isMobileDevice()) return;
        if (this.enabled) return;

        this.enabled = true;

        // 立即清除當前頁面中已存在的目標元素
        if (this._isHomepage()) {
            this._removeTargetElements();
        }

        this._startObserver();
    },

    /**
     * 停用清理功能：停止 MutationObserver。
     * Guard：未啟用時直接返回。
     */
    disable() {
        if (!this.enabled) return;

        this.enabled = false;
        this._stopObserver();
    },

    /**
     * 完整清理：停用模組並解除開關註冊。
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
        if (!__DS_CleanupMobileDevice.isMobileDevice()) return;

        this._unregisterToggle = __DS_CleanupFeatureToggle.registerFeatureToggle({
            onEnable: () => this.enable(),
            onDisable: () => this.disable(),
        });
    }
};

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
MobileHomepageCleanup.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MobileHomepageCleanup;
}

// Expose on window for cross-module access
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.MobileHomepageCleanup = MobileHomepageCleanup;
}
