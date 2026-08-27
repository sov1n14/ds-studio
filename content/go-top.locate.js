/**
 * DS studio — Go To Top Locate Bundle (Entry)
 * DOM 查詢輔助、包裝容器定位與可見性評估。
 *
 * 載入順序（manifest.json 中 bundle 必須先於 entry）：
 *   1. go-top.locate.scroll.js → globalThis.__DS_GoToTop_locate_scroll
 *   2. go-top.locate.anchor.js → globalThis.__DS_GoToTop_locate_anchor
 *   3. go-top.locate.js        （本檔，Object.assign 合入以上兩個 bundle）
 */
(function (root) {
    'use strict';

    // 合併共用選擇器常數
    const __DSSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {
        // ─────────────────────────────
        //  Private: Query helpers
        // ─────────────────────────────

        /**
         * Attempt each CSS selector in order and return the first match.
         * @param {string[]} selectors - Array of CSS selector strings
         * @returns {Element|null}
         */
        _querySelectorWithFallback(selectors) {
            if (!selectors || selectors.length === 0) return null;

            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    this._hasSeenDom = true;
                    return el;
                }
            }

            return null;
        },

        // ─────────────────────────────
        //  Private: Wrapper locators
        // ─────────────────────────────

        /**
         * 從原生按鈕結構上找到注入用的直接父層容器。
         * @param {Element} nativeBtn
         * @returns {{ injectParent: Element, outerWrapper: Element }|null}
         */
        _locateWrapperElements(nativeBtn) {
            if (!nativeBtn) return null;

            const injectParent = nativeBtn.parentElement;
            if (!injectParent) {
                return null;
            }

            const outerWrapper = injectParent.parentElement || injectParent;

            return { injectParent, outerWrapper };
        },

        /**
         * Locate { injectParent, outerWrapper } directly from DOM without relying on the native button.
         * @returns {{ injectParent: Element, outerWrapper: Element }|null}
         */
        _locateWrapperDirect() {
            const injectParent = document.querySelector(this.INJECT_PARENT_SELECTOR)
                || document.querySelector(this.INJECT_PARENT_FALLBACK);
            if (!injectParent) {
                return null;
            }
            const outerWrapper = document.querySelector(this.OUTER_WRAPPER_SELECTOR)
                || injectParent.parentElement
                || injectParent;
            return { injectParent, outerWrapper };
        },

        // ─────────────────────────────
        //  Private: Check at-top state
        // ─────────────────────────────

        /**
         * 判斷是否可驗證地到達對話最頂部。
         * @returns {boolean}
         */
        _isAtTop() {
            const container = this._scrollContainer;
            if (container && container.scrollTop <= 1) {
                return true;
            }

            const verifiableAnchor = document.querySelector(this.ANCHOR_SELECTOR_FALLBACK2);
            if (verifiableAnchor) {
                const rect = verifiableAnchor.getBoundingClientRect();
                const vpHeight = window.innerHeight;
                if (rect.height > vpHeight) {
                    if (rect.top >= 0) return true;
                } else if (rect.top >= 0 && rect.bottom <= vpHeight) {
                    return true;
                }
            }

            return false;
        },

        // ─────────────────────────────
        //  Private: Visibility
        // ─────────────────────────────

        /**
         * Evaluate whether the go-top button should be visible.
         */
        _evaluateVisibility() {
            if (!this.enabled || !this._masterEnabled) {
                return;
            }
            if (!this._button) {
                return;
            }

            const firstMsg = this._getFirstMessage();
            const isShowCondition = firstMsg && firstMsg.getBoundingClientRect().bottom < 0;
            const isHideCondition = this._isAtTop();

            if (isShowCondition) {
                this._button.style.display = '';
            } else if (isHideCondition) {
                this._button.style.display = 'none';
            }
        },
    };

    // 合入兩個 sub-bundle
    Object.assign(bundle,
        root.__DS_GoToTop_locate_scroll || {},
        root.__DS_GoToTop_locate_anchor || {}
    );

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    root.__DS_GoToTop_locate = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
