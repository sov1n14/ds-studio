/**
 * DS studio — Mobile Homepage Cleanup
 * 在行動裝置上，當路徑為首頁（'/'）時，永久移除所有帶有 CSS class `_9579690`
 * 的 DOM 元素。使用 MutationObserver 應對 DeepSeek SPA 動態插入的元素。
 *
 * 架構決策：
 *   - 僅在行動裝置（觸控或行動 UA）上啟動，桌面端零開銷。
 *   - 使用 _isMobileDevice() 與 _isHomepage() 防護所有生命週期函式。
 *   - 透過 StorageManager.KEYS.IS_ENABLED 追蹤擴充功能主開關。
 *   - MutationObserver 監聽 document.body 子樹變更，即時清除目標元素。
 */
const MobileHomepageCleanup = {
    // === 狀態 ===
    enabled: false,
    _masterEnabled: false,
    _observer: null,

    // ─────────────────────────────
    //  Private: Helpers
    // ─────────────────────────────

    /**
     * 判斷是否為行動裝置。
     * 涵蓋實體觸控裝置（maxTouchPoints）與 Chrome DevTools 行動模擬（User-Agent）。
     * @returns {boolean}
     */
    _isMobileDevice() {
        return navigator.maxTouchPoints > 0 ||
               /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    },

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
    //  Private: Storage listener
    // ─────────────────────────────

    /**
     * 監聽 chrome.storage.onChanged，僅追蹤擴充功能主開關（IS_ENABLED）。
     * 無各別功能切換 — 完全跟隨主開關啟用/停用。
     */
    _setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            if (changes[StorageManager.KEYS.IS_ENABLED]) {
                this._masterEnabled = changes[StorageManager.KEYS.IS_ENABLED].newValue;
                if (this._masterEnabled) {
                    this.enable();
                } else {
                    this.disable();
                }
            }
        });
    },

    // ─────────────────────────────
    //  Public: Lifecycle methods
    // ─────────────────────────────

    /**
     * 啟用清理功能：立即移除首頁目標元素，並啟動 MutationObserver。
     * Guard：非行動裝置或已啟用時直接返回。
     */
    enable() {
        if (!this._isMobileDevice()) return;
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
     * 完整清理：停用模組並移除所有監聽器。
     */
    destroy() {
        this.disable();
    },

    /**
     * 初始化模組：確認行動裝置、從 storage 讀取主開關，
     * 設置 storage 變更監聽器，並在條件滿足時啟用。
     */
    async start() {
        if (!this._isMobileDevice()) return;

        const data = await new Promise((resolve) => {
            chrome.storage.local.get([StorageManager.KEYS.IS_ENABLED], resolve);
        });
        this._masterEnabled = data[StorageManager.KEYS.IS_ENABLED] ?? false;

        this._setupStorageListener();

        if (this._masterEnabled) {
            this.enable();
        }
    }
};

// Auto-start
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
