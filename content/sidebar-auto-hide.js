/**
 * DS studio — Sidebar Auto-Hide（content/sidebar-auto-hide.js）
 * Collapses the sidebar to 60px when idle, expands on hover.
 *
 * 總開關與自身開關的閘控委派 content/feature-toggle.js 的共用管線
 * （單一 chrome.runtime.onMessage 監聽器，僅 local 區域），
 * 側邊欄 DOM 就緒的輪詢委派 content/retry-until.js。
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
const __DS_SidebarSelectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
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

    getTransitionCSS() {
        return `
#${this.STYLE_ID} { display: none; }
${this.SIDEBAR_WRAPPER_SELECTOR} {
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1) !important;
}
${this.SIDEBAR_INNER_SELECTOR} {
  transition: margin-left 0.22s cubic-bezier(0.4, 0, 0.2, 1) !important;
}`.trim();
    },

    injectStyles() {
        if (document.getElementById(this.STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = this.STYLE_ID;
        style.textContent = this.getTransitionCSS();
        document.head.appendChild(style);
        this.styleEl = style;
    },

    removeStyles() {
        const style = document.getElementById(this.STYLE_ID);
        if (style) style.remove();
        this.styleEl = null;
    },

    getSidebar() {
        return document.querySelector(this.SIDEBAR_WRAPPER_SELECTOR);
    },

    storeOriginalWidth() {
        if (!this.sidebarEl) return;
        // 收合狀態下不安裝原始寬度 — MutationObserver 可能在 collapse() 後
        // 因 React 重新渲染而觸發，此時 getBoundingClientRect().width 為收合寬度
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

    applyOverflow() {
        if (!this.sidebarEl) return;
        const nativelyCollapsed = this.isNativelyCollapsed();
        const ourCollapsed = this.isCollapsed();
        // 僅在我們自己收起側邊欄且非原生摺疊時才隱藏溢出內容，
        // 避免展開過程中 MutationObserver 重新套用 overflow:hidden 導致裁切。
        if (nativelyCollapsed || !ourCollapsed) {
            this.sidebarEl.style.overflow = '';
        } else {
            this.sidebarEl.style.overflow = 'hidden';
        }
    },

    collapse() {
        if (!this.sidebarEl || this.isCollapsed()) return;
        this.sidebarEl.classList.add(this.COLLAPSED_CLASS);
        this.sidebarEl.style.width = this.COLLAPSED_WIDTH + 'px';
        this.applyOverflow();
        // Re-query inner element each time — native collapse/expand may have
        // wiped its style or replaced the DOM node entirely.
        const innerEl = this.sidebarEl.querySelector(this.SIDEBAR_INNER_SELECTOR);
        if (!this.isNativelyCollapsed() && innerEl) {
            const innerWidth = innerEl.getBoundingClientRect().width;
            const shift = -(innerWidth - this.COLLAPSED_WIDTH);
            innerEl.style.marginLeft = shift + 'px';
        }
    },

    expand() {
        if (!this.sidebarEl || !this.isCollapsed()) return;
        this.sidebarEl.classList.remove(this.COLLAPSED_CLASS);
        this.sidebarEl.style.overflow = '';
        // Clear margin-left on the current inner element (re-query in case replaced)
        const innerEl = this.sidebarEl.querySelector(this.SIDEBAR_INNER_SELECTOR);
        if (innerEl) {
            innerEl.style.marginLeft = '';
        }
        if (this.originalWidth && this.originalWidth > this.COLLAPSED_WIDTH) {
            this.sidebarEl.style.width = this.originalWidth + 'px';
        } else {
            // originalWidth 未捕捉或無效 → 清除 inline width，讓 CSS/瀏覽器決定自然寬度
            this.sidebarEl.style.width = '';
        }
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

    bindEvents() {
        this.sidebarEl = this.getSidebar();
        if (!this.sidebarEl) return false;

        // 每個 enable 週期共用一個 AbortController，disable() 一次移除所有 hover 監聽，
        // 避免反覆開關時堆疊重複 handler（每個都會再開一組計時器）
        if (!this._eventAbortController) {
            this._eventAbortController = new AbortController();
        }
        const { signal } = this._eventAbortController;
        this.sidebarEl.addEventListener('mouseenter', () => this.handleMouseEnter(), { signal });
        this.sidebarEl.addEventListener('mouseleave', () => this.handleMouseLeave(), { signal });
        return true;
    },

    setupMutationObserver() {
        if (this.mutationObserver) this.mutationObserver.disconnect();

        this.mutationObserver = new MutationObserver(() => {
            const sidebar = this.getSidebar();
            if (sidebar && sidebar !== this.sidebarEl) {
                this.sidebarEl = sidebar;
                if (this.enabled) {
                    if (this.sidebarObserver) this.sidebarObserver.disconnect();
                    this.bindEvents();
                    this.observeSidebar();
                    this.storeOriginalWidth();
                    this.collapse();
                }
            }
        });

        this.mutationObserver.observe(document.body, { childList: true, subtree: true });
    },

    observeSidebar() {
        if (this.sidebarObserver) this.sidebarObserver.disconnect();
        if (!this.sidebarEl) return;

        this._wasNativelyCollapsed = this.isNativelyCollapsed();

        this.sidebarObserver = new MutationObserver(() => {
            if (!this.enabled) return;

            const nowNativelyCollapsed = this.isNativelyCollapsed();
            const nativeStateChanged = nowNativelyCollapsed !== this._wasNativelyCollapsed;
            this._wasNativelyCollapsed = nowNativelyCollapsed;

            if (nativeStateChanged && !nowNativelyCollapsed && this.isCollapsed()) {
                // Native expand while our collapse is active — DeepSeek may have
                // wiped the inner content's inline style (including our margin-left)
                // or overridden the wrapper width. Re-apply full collapse state.
                this.sidebarEl.style.width = this.COLLAPSED_WIDTH + 'px';
                this.applyOverflow();
                const innerEl = this.sidebarEl.querySelector(this.SIDEBAR_INNER_SELECTOR);
                if (innerEl) {
                    const innerWidth = innerEl.getBoundingClientRect().width;
                    if (innerWidth > 0) {
                        const shift = -(innerWidth - this.COLLAPSED_WIDTH);
                        innerEl.style.marginLeft = shift + 'px';
                    }
                }
            } else {
                this.applyOverflow();
            }
        });

        this.sidebarObserver.observe(this.sidebarEl, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    },

    setupResizeHandler() {
        window.addEventListener('resize', () => {
            if (this.resizeTimer) clearTimeout(this.resizeTimer);
            this.resizeTimer = setTimeout(() => {
                if (this.enabled && !this.isCollapsed()) {
                    this.collapse();
                }
            }, this.RESIZE_DEBOUNCE_MS);
        }, { passive: true });
    },

    setupHoverZone() {
        this._hoverMonitorHandler = (e) => {
            // When sidebar has a pending collapse timer, check if the mouse
            // has entered a floating/dropdown element related to the sidebar.
            // If so, cancel the timer and keep sidebar expanded.
            if (!this.enabled || !this.leaveTimer) return;

            const el = e.target;
            if (!el || !el.classList) return;

            // Ignore if mouse re-entered the sidebar itself
            if (this.sidebarEl && (el === this.sidebarEl || this.sidebarEl.contains(el))) {
                clearTimeout(this.leaveTimer);
                this.leaveTimer = null;
                return;
            }

            // 使用 closest 確保子元素也能正確識別浮動容器根元素
            // .ds-floating-position-wrapper 優先；其次找最近的 .ds-elevated 根節點
            const floatingRoot = el.closest(__DS_SidebarSelectors.FLOATING_POSITION_WRAPPER_SELECTOR) ||
                                  el.closest(__DS_SidebarSelectors.ELEVATED_SURFACE_SELECTOR);
            const isFloating = !!floatingRoot;

            if (isFloating) {
                clearTimeout(this.leaveTimer);
                this.leaveTimer = null;

                // 若已監聽相同根元素，不重複綁定 mouseleave 事件
                if (this._activeDropdownEl === floatingRoot) return;

                this._activeDropdownEl = floatingRoot;

                const onLeave = () => {
                    if (!this._activeDropdownEl) return;
                    this._activeDropdownEl.removeEventListener('mouseleave', onLeave);
                    this._activeDropdownEl = null;
                    // 延遲一個動畫幀，確保 sidebar mouseenter 先觸發
                    requestAnimationFrame(() => {
                        if (this.enterTimer) return; // mouseenter 已觸發展開，無需收合
                        this.collapse();
                    });
                };
                this._activeDropdownEl.addEventListener('mouseleave', onLeave);
            }
        };

        document.addEventListener('mouseover', this._hoverMonitorHandler, true);
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

        // 側邊欄可能尚未掛載：輪詢至就緒後才綁定 hover 與 observer。
        // 已就緒時輪詢同步完成，與原本的直接綁定路徑等價。
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
        // 停用時拆掉兩個 subtree observer：enable() 重建 mutationObserver，
        // sidebarObserver 由後續 observeSidebar() 重建
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

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
SidebarAutoHide.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SidebarAutoHide;
}
