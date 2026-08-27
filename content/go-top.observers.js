/**
 * DS studio — Go To Top Observers Bundle
 * DOM 變動監控、滾動監聽及路由偵測。 透過 Object.assign 合併至 GoToTop 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    const bundle = {
        // ─────────────────────────────
        //  Private: Observers & listeners
        // ─────────────────────────────

        /**
         * Watch the DOM for structural changes (new messages, SPA re-renders).
         * Debounces route detection and _evaluateVisibility onto one observer.
         * 刻意不監聽 attributes：可見性僅取決於節點結構與滾動位置， 且本功能自身會改寫按鈕 style，監聽屬性會造成回呼自我觸發。
         */
        _startObserver() {
            if (this._observer) return;
            this._observer = new MutationObserver(() => {
                clearTimeout(this._observerTimer);
                this._observerTimer = setTimeout(() => {
                    // 路由切換與可見性判斷共用同一組去抖動的 DOM 變動事件
                    if (this._handlePathChange()) return;
                    this._evaluateVisibility();
                }, this.OBSERVER_DEBOUNCE);
            });
            this._observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        },

        _stopObserver() {
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            clearTimeout(this._observerTimer);
            this._observerTimer = null;
        },

        /**
         * Listen for scroll events on the container (throttled to 100ms).
         * 每次呼叫前先確認快取容器仍有效；若容器已變換則先解除舊監聽再重新附加。 */
        _startScrollListener() {
            if (this._scrollListener && this._scrollContainer) return;

            if (!this._scrollContainer ||
                this._scrollContainer.scrollHeight <= this._scrollContainer.clientHeight) {
                return;
            }

            let lastCall = 0;
            this._scrollListener = () => {
                const now = Date.now();
                if (now - lastCall < 100) return;
                lastCall = now;
                this._evaluateVisibility();
            };
            this._scrollContainer.addEventListener('scroll', this._scrollListener, { passive: true });
        },

        _stopScrollListener() {
            if (this._scrollListener && this._scrollContainer) {
                this._scrollContainer.removeEventListener('scroll', this._scrollListener);
            }
            this._scrollListener = null;
        },

        /**
         * 比對 pathname 判斷是否發生 SPA 路由切換；已切換則觸發 _onRouteChange。
         * @returns {boolean} 是否偵測到路由切換
         */
        _handlePathChange() {
            const currentPath = window.location.pathname;
            if (currentPath === this._lastPath) return false;

            // 首次比對（_lastPath 尚未初始化）只記錄基準，不視為路由切換
            const isFirstSample = !this._lastPath;
            this._lastPath = currentPath;
            if (isFirstSample) return false;

            this._onRouteChange();
            return true;
        },

        /**
         * Watch for SPA route changes via popstate.
         * DOM 變動路徑的路由偵測已併入 _startObserver 的去抖動回呼。
         */
        _startRouteListener() {
            if (this._popstateHandler) return;
            this._lastPath = window.location.pathname;

            this._popstateHandler = () => {
                this._handlePathChange();
            };
            window.addEventListener('popstate', this._popstateHandler);
        },

        _stopRouteListener() {
            if (this._popstateHandler) {
                window.removeEventListener('popstate', this._popstateHandler);
                this._popstateHandler = null;
            }
        },
    };

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    root.__DS_GoToTop_observers = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
