/**
 * DS studio — Sidebar Auto-Hide Observers Bundle
 * 事件綁定、MutationObserver、側邊欄監控、resize 處理及 hover zone 偵測。 透過 Object.assign 合併至 SidebarAutoHide 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const __DS_Selectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {
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
                    // wiped the inner content's inline style (including our margin-left) or overridden the wrapper width. Re-apply full collapse state.
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
                // has entered a floating/dropdown element related to the sidebar. If so, cancel the timer and keep sidebar expanded.
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
                const floatingRoot = el.closest(__DS_Selectors.FLOATING_POSITION_WRAPPER_SELECTOR) ||
                                      el.closest(__DS_Selectors.ELEVATED_SURFACE_SELECTOR);
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
    };

    // 將 bundle 掛載至全域（供 sidebar-auto-hide.js 的 Object.assign 合併使用）
    root.__DS_SidebarAutoHide_observers = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
