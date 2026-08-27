/**
 * DS studio — Sidebar Auto-Hide（content/sidebar-auto-hide.js）
 * Collapses the sidebar to 60px when idle, expands on hover.
 *
 * 總開關與自身開關的閘控委派 content/feature-toggle.js 的共用管線（單一 chrome.runtime.onMessage 監聽器，僅 local 區域），側邊欄 DOM 就緒的輪詢委派 content/retry-until.js。
 */
// 共用模組（瀏覽器：由 manifest 於前載入設定 globalThis；Node.js 測試：直接 require）
const __DS_SidebarFeatureToggle = globalThis.DSSFeatureToggle
    || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
const __DS_SidebarRetryUntil = globalThis.DSSRetryUntil
    || (typeof require !== 'undefined' ? require('./retry-until.js') : null);
if (!__DS_SidebarFeatureToggle || !__DS_SidebarRetryUntil) {
    throw new Error('content/sidebar-auto-hide.js 需要 content/feature-toggle.js 與 content/retry-until.js 先行載入');
}

// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DS_SidebarSelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

const SidebarAutoHide = {
    STYLE_ID: 'ds-sidebar-auto-hide-style',
    STORAGE_KEY: StorageManager.KEYS.SIDEBAR_AUTO_HIDE,
    SIDEBAR_WRAPPER_SELECTOR: __DS_SidebarSelectors.SIDEBAR_WRAPPER_SELECTOR,
    SIDEBAR_INNER_SELECTOR: __DS_SidebarSelectors.SIDEBAR_INNER_SELECTOR,
    COLLAPSED_CLASS: 'ds-sidebar-auto-hide-collapsed',
    COLLAPSED_WIDTH: 60,
    ENTER_DELAY_MS: 150,
    LEAVE_DELAY_MS: 400,
    RESIZE_DEBOUNCE_MS: 200,
    // 側邊欄 DOM 就緒輪詢：立即判定一次，未就緒則 500ms 後再試一次
    DOM_RETRY_INTERVAL_MS: 500,
    DOM_MAX_RETRIES: 1,

    NATIVE_COLLAPSED_BAR_SELECTOR: __DS_SidebarSelectors.SIDEBAR_NATIVE_COLLAPSED_SELECTOR,

    enabled: false,
    styleEl: null,
    sidebarEl: null,
    originalWidth: null,
    enterTimer: null,
    leaveTimer: null,
    mutationObserver: null,
    sidebarObserver: null,
    resizeTimer: null,
    _eventAbortController: null,
    _hoverMonitorHandler: null,
    _activeDropdownEl: null,
    _unregisterToggle: null,
    _domRetryCancel: null,

    getSidebar() {
        return document.querySelector(this.SIDEBAR_WRAPPER_SELECTOR);
    },

    storeOriginalWidth() {
        if (!this.sidebarEl) return;
        // 收合狀態下不安裝原始寬度 — MutationObserver 可能在 collapse() 後因 React 重新渲染而觸發，此時 getBoundingClientRect().width 為收合寬度
        if (this.isCollapsed()) return;
        const w = this.sidebarEl.getBoundingClientRect().width;
        if (w <= this.COLLAPSED_WIDTH) return;
        this.originalWidth = w;
    },

    isCollapsed() {
        return this.sidebarEl && this.sidebarEl.classList.contains(this.COLLAPSED_CLASS);
    },

    isNativelyCollapsed() {
        if (!this.sidebarEl) return false;
        return !!this.sidebarEl.querySelector(this.NATIVE_COLLAPSED_BAR_SELECTOR);
    },


    handleMouseEnter() {
        if (!this.enabled) return;
        if (this.leaveTimer) {
            clearTimeout(this.leaveTimer);
            this.leaveTimer = null;
        }
        if (this.enterTimer) clearTimeout(this.enterTimer);
        this.enterTimer = setTimeout(() => {
            this.expand();
            this.enterTimer = null;
        }, this.ENTER_DELAY_MS);
    },

    handleMouseLeave() {
        if (!this.enabled) return;
        if (this.enterTimer) {
            clearTimeout(this.enterTimer);
            this.enterTimer = null;
        }
        if (this.leaveTimer) clearTimeout(this.leaveTimer);
        this.leaveTimer = setTimeout(() => {
            this.collapse();
            this.leaveTimer = null;
        }, this.LEAVE_DELAY_MS);
    },
    /** 取消進行中的 DOM 就緒輪詢（可重複呼叫）。 */
    _cancelDomRetry() {
        if (!this._domRetryCancel) return;
        this._domRetryCancel();
        this._domRetryCancel = null;
    },

    enable() {
        if (this.enabled) return;
        this.enabled = true;

        this.injectStyles();
        // disable() 會拆掉 observer，故每次啟用都重建
        this.setupMutationObserver();
        this.setupHoverZone();

        // 側邊欄可能尚未掛載：輪詢至就緒後才綁定 hover 與 observer。已就緒時輪詢同步完成，與原本的直接綁定路徑等價。
        this._cancelDomRetry();
        this._domRetryCancel = __DS_SidebarRetryUntil(() => this.getSidebar(), {
            intervalMs: this.DOM_RETRY_INTERVAL_MS,
            maxRetries: this.DOM_MAX_RETRIES,
            onReady: () => {
                if (!this.enabled) return;
                this.bindEvents();
                this.observeSidebar();
                this.storeOriginalWidth();
                this.collapse();
            },
        });
    },

    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        this.removeStyles();
        this._cancelDomRetry();
        if (this.sidebarEl) {
            this.sidebarEl.classList.remove(this.COLLAPSED_CLASS);
            this.sidebarEl.style.width = '';
            this.sidebarEl.style.overflow = '';
        }
        // Re-query inner element — native cycle may have replaced it
        const innerEl = this.sidebarEl?.querySelector(this.SIDEBAR_INNER_SELECTOR);
        if (innerEl) {
            innerEl.style.marginLeft = '';
        }
        if (this._hoverMonitorHandler) {
            document.removeEventListener('mouseover', this._hoverMonitorHandler, true);
            this._hoverMonitorHandler = null;
        }
        if (this._eventAbortController) {
            this._eventAbortController.abort();
            this._eventAbortController = null;
        }
        if (this._activeDropdownEl) {
            this._activeDropdownEl = null;
        }
        // 停用時拆掉兩個 subtree observer：enable() 重建 mutationObserver，sidebarObserver 由後續 observeSidebar() 重建
        if (this.sidebarObserver) {
            this.sidebarObserver.disconnect();
            this.sidebarObserver = null;
        }
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = null;
        }
        this.originalWidth = null;
        if (this.enterTimer) {
            clearTimeout(this.enterTimer);
            this.enterTimer = null;
        }
        if (this.leaveTimer) {
            clearTimeout(this.leaveTimer);
            this.leaveTimer = null;
        }
    },

    destroy() {
        this.disable();
        if (this._unregisterToggle) {
            this._unregisterToggle();
            this._unregisterToggle = null;
        }
    },

    start() {
        this.setupResizeHandler();
        this._unregisterToggle = __DS_SidebarFeatureToggle.registerFeatureToggle({
            ownKey: this.STORAGE_KEY,
            onEnable: () => this.enable(),
            onDisable: () => this.disable(),
        });
    }
};

// 合併所有 bundle（bundle 檔案須在 manifest 中先於此檔案載入）
(function (root) {
    Object.assign(SidebarAutoHide, root.__DS_SidebarAutoHide_styles || {}, root.__DS_SidebarAutoHide_observers || {});
})(globalThis);

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
SidebarAutoHide.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SidebarAutoHide;
}
