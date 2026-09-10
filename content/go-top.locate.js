/**
 * DS studio — Go To Top Locate Bundle
 * DOM 查詢輔助、錨點偵測、原生按鈕定位、捲動容器定位與可見性評估。
 */
(function (root) {
    'use strict';

    // 合併共用選擇器常數
    const __DSSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
    const FLOATING_BAR = __DSSelectors.FLOATING_BUTTON_BAR_SELECTOR;
    const GO_TOP_NATIVE_BUTTON_CLASS = __DSSelectors.GO_TOP_NATIVE_BUTTON_CLASS;
    const SCROLL_AREA_CLASS = __DSSelectors.SCROLL_AREA_CLASS;

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

        // ─────────────────────────────
        //  Anchor: 錨點偵測與原生按鈕定位
        // ─────────────────────────────

        /**
         * @returns {Element|null} The conversation-start anchor node.
         */
        _getAnchor() {
            return this._querySelectorWithFallback([
                this.ANCHOR_SELECTOR,
                this.ANCHOR_SELECTOR_FALLBACK1,
                this.ANCHOR_SELECTOR_FALLBACK2,
                this.FIRST_MSG_SELECTOR,
            ]);
        },

        /**
         * @returns {Element|null} The first message element in DOM.
         */
        _getFirstMessage() {
            return this._querySelectorWithFallback([
                this.FIRST_MSG_SELECTOR,
                '[class*="ds-message"]',
            ]);
        },

        /**
         * @returns {Element|null} The native go-bottom button if it exists.
         */
        _getNativeButton() {
            const result = this._querySelectorWithFallback([
                this.NATIVE_BTN_SELECTOR,
                FLOATING_BAR + ' .ds-button--floating.ds-button--circle:not(.dsw-gotop)',
                FLOATING_BAR + ' [role="button"].ds-button--floating.ds-button--circle:not(.dsw-gotop)',
                FLOATING_BAR + ' [role="button"].ds-button--floating[class*="ds-button--circle"]:not(.dsw-gotop)',
            ]);
            if (!result) return null;

            // 後驗證：若匹配來自降級選擇器（非 _0706cde），確認確實為 floating 按鈕
            if (!result.classList.contains(GO_TOP_NATIVE_BUTTON_CLASS)) {
                if (!result.classList.contains('ds-button--floating') ||
                    result.classList.contains('ds-button--primary') ||
                    result.classList.contains('ds-button--filled') ||
                    result.classList.contains('ds-button--disabled')) {
                    return null;
                }
            }

            return result;
        },

        // ─────────────────────────────
        //  Scroll: 捲動容器定位策略
        // ─────────────────────────────

        /**
         * Walk up from anchor to find the scrollable container.
         * 以三段策略定位訊息列表的滾動容器，避免抓到側邊欄的 .ds-scroll-area。
         * @param {Element} anchor - Starting DOM node
         * @returns {Element}
         */
        _findScrollContainer(anchor) {
            // 策略 1：從 anchor 向上走，找到最近的 .ds-scroll-area 且具備可滾動高度
            if (anchor) {
                let el = anchor.parentElement;
                while (el && el !== document.body) {
                    if (el.classList.contains(SCROLL_AREA_CLASS) &&
                        el.scrollHeight > el.clientHeight) {
                        this._scrollContainer = el;
                        return el;
                    }
                    el = el.parentElement;
                }
            }

            // 策略 2：從虛擬列表容器向上找
            const virtualList = document.querySelector(this.VIRTUAL_LIST_SELECTOR) ||
                                document.querySelector(this.VIRTUAL_LIST_FALLBACK);
            if (virtualList) {
                let el = virtualList.parentElement;
                while (el && el !== document.body) {
                    if (el.classList.contains(SCROLL_AREA_CLASS) &&
                        el.scrollHeight > el.clientHeight) {
                        this._scrollContainer = el;
                        return el;
                    }
                    el = el.parentElement;
                }
            }

            // 策略 3：從 anchor 向上探測具有 overflow:auto/scroll 的元素
            if (anchor && anchor.parentElement) {
                let el = anchor.parentElement;
                while (el && el !== document.body) {
                    const style = getComputedStyle(el);
                    const overflowY = style.overflowY;
                    if ((overflowY === 'auto' || overflowY === 'scroll') &&
                        el.scrollHeight > el.clientHeight) {
                        this._scrollContainer = el;
                        return el;
                    }
                    el = el.parentElement;
                }
            }

            // 策略 4：最後回退到 document.scrollingElement
            return document.scrollingElement || document.documentElement;
        },
    };

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    root.__DS_GoToTop_locate = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
