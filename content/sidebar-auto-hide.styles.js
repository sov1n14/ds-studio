/**
 * DS studio — Sidebar Auto-Hide Styles Bundle
 * 過渡動畫 CSS 注入、溢出控制、收合／展開視覺狀態管理。 透過 Object.assign 合併至 SidebarAutoHide 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    const bundle = {
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
    };

    // 將 bundle 掛載至全域（供 sidebar-auto-hide.js 的 Object.assign 合併使用）
    root.__DS_SidebarAutoHide_styles = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
