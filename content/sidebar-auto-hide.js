/**
 * DS studio v1.5.3 — Sidebar Auto-Hide
 * Collapses the sidebar to 60px when idle, expands on hover.
 */
const SidebarAutoHide = {
    STYLE_ID: 'ds-sidebar-auto-hide-style',
    STORAGE_KEY: 'dsSidebarAutoHide',
    SIDEBAR_WRAPPER_SELECTOR: 'div.dc04ec1d',
    SIDEBAR_INNER_SELECTOR: 'div.b8812f16.a2f3d50e',
    COLLAPSED_CLASS: 'ds-sidebar-auto-hide-collapsed',
    COLLAPSED_WIDTH: 60,
    ENTER_DELAY_MS: 150,
    LEAVE_DELAY_MS: 400,
    MUTATION_CHECK_INTERVAL_MS: 1000,
    RESIZE_DEBOUNCE_MS: 200,

    NATIVE_COLLAPSED_BAR_SELECTOR: 'div.ca6d4be1',
    NATIVE_COLLAPSED_INNER_SELECTOR: 'div._70b689f',

    enabled: false,
    _masterEnabled: false,
    styleEl: null,
    sidebarEl: null,
    sidebarInnerEl: null,
    originalWidth: null,
    sidebarInnerWidth: null,
    enterTimer: null,
    leaveTimer: null,
    mutationObserver: null,
    sidebarObserver: null,
    resizeTimer: null,
    _hoverMonitorHandler: null,
    _activeDropdownEl: null,

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
        this.sidebarInnerEl = this.sidebarEl.querySelector(this.SIDEBAR_INNER_SELECTOR);
        this.sidebarInnerWidth = this.sidebarInnerEl
            ? this.sidebarInnerEl.getBoundingClientRect().width
            : null;
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
            this.sidebarInnerEl = innerEl;
            this.sidebarInnerWidth = innerWidth;
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

        this.sidebarEl.addEventListener('mouseenter', () => this.handleMouseEnter());
        this.sidebarEl.addEventListener('mouseleave', () => this.handleMouseLeave());
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
            const floatingRoot = el.closest('.ds-floating-position-wrapper') ||
                                  el.closest('.ds-elevated');
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

    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            // Master switch
            if (changes[StorageManager.KEYS.IS_ENABLED]) {
                this._masterEnabled = changes[StorageManager.KEYS.IS_ENABLED].newValue;
                if (this._masterEnabled) {
                    chrome.storage.local.get([this.STORAGE_KEY], (data) => {
                        if (data[this.STORAGE_KEY]) this.enable();
                    });
                } else {
                    this.disable();
                }
            }

            // Own toggle
            if (changes[this.STORAGE_KEY]) {
                if (!this._masterEnabled) return;
                if (changes[this.STORAGE_KEY].newValue) {
                    this.enable();
                } else {
                    this.disable();
                }
            }
        });
    },

    enable() {
        if (this.enabled) return;
        this.enabled = true;

        this.injectStyles();
        this.setupHoverZone();
        const bound = this.bindEvents();
        if (!bound) {
            // Retry shortly in case DOM is not ready
            setTimeout(() => {
                if (this.enabled) {
                    this.bindEvents();
                    this.observeSidebar();
                    this.storeOriginalWidth();
                    this.collapse();
                }
            }, 500);
            return;
        }
        this.observeSidebar();
        this.storeOriginalWidth();
        this.collapse();
    },

    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        this.removeStyles();
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
        if (this._activeDropdownEl) {
            this._activeDropdownEl = null;
        }
        this.originalWidth = null;
        this.sidebarInnerWidth = null;
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
        if (this._hoverMonitorHandler) {
            document.removeEventListener('mouseover', this._hoverMonitorHandler, true);
            this._hoverMonitorHandler = null;
        }
        if (this._activeDropdownEl) {
            this._activeDropdownEl = null;
        }
    },

    async start() {
        const data = await chrome.storage.local.get([
            this.STORAGE_KEY,
            StorageManager.KEYS.IS_ENABLED
        ]);
        const enabled = data[this.STORAGE_KEY] ?? false;
        this._masterEnabled = data[StorageManager.KEYS.IS_ENABLED] ?? false;

        this.setupStorageListener();
        this.setupMutationObserver();
        this.setupResizeHandler();

        if (enabled && this._masterEnabled) {
            this.enable();
        }
    }
};

// Auto-start
SidebarAutoHide.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SidebarAutoHide;
}
