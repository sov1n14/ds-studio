/**
 * DS studio — Go To Top Locate Bundle
 * DOM 查詢輔助、錨點偵測、原生按鈕定位、捲動容器定位與可見性評估。超過 250 行的理由：五者同屬 GoTop 定位單一關注點，且已是 go-top 多檔 bundle 的一部分，再拆僅產生人為邊界。
 */
(function (root) {
    'use strict';

    // 合併共用選擇器常數
    const __DSSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
    const GO_TOP_NATIVE_BUTTON_CLASS = __DSSelectors.GO_TOP_NATIVE_BUTTON_CLASS;
    const SCROLL_AREA_CLASS = __DSSelectors.SCROLL_AREA_CLASS;
    const DS_BUTTON_FLOATING = __DSSelectors.DS_BUTTON_FLOATING_CLASS;
    const DS_BUTTON_CIRCLE = __DSSelectors.DS_BUTTON_CIRCLE_CLASS;
    const DS_BUTTON_PRIMARY = __DSSelectors.DS_BUTTON_PRIMARY_CLASS;
    const DS_BUTTON_FILLED = __DSSelectors.DS_BUTTON_FILLED_CLASS;
    const BUTTON_DISABLED = __DSSelectors.BUTTON_DISABLED_CLASS;

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
            const injectParent = document.querySelector(this.INJECT_PARENT_SELECTOR);
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
            const container = this._scrollContainer;
            // 距頂部至少一個視窗高度即顯示：長對話底部首則已掛載訊息可能極高而仍跨入視窗；容器缺失或高度為 0 視為未達
            const isViewportAwayFromTop = !!container && container.clientHeight > 0 && container.scrollTop >= container.clientHeight;
            const isShowCondition = (firstMsg && firstMsg.getBoundingClientRect().bottom < 0) || isViewportAwayFromTop;
            const isHideCondition = this._isAtTop();

            // 已在頂部時隱藏優先，其次顯示，兩者皆否則維持現狀
            if (isHideCondition) {
                this._button.style.display = 'none';
            } else if (isShowCondition) {
                this._button.style.display = '';
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
            const result = this._querySelectorWithFallback([this.NATIVE_BTN_SELECTOR])
                || this._queryFloatingButtonOutsideGoTop();
            if (!result) return null;

            // 後驗證：若匹配來自降級選擇器（不帶原生按鈕定位 class），確認確實為 floating 按鈕
            if (!result.classList.contains(GO_TOP_NATIVE_BUTTON_CLASS)) {
                if (!result.classList.contains(DS_BUTTON_FLOATING) ||
                    result.classList.contains(DS_BUTTON_PRIMARY) ||
                    result.classList.contains(DS_BUTTON_FILLED) ||
                    result.classList.contains(BUTTON_DISABLED)) {
                    return null;
                }
            }

            return result;
        },

        // 降級：浮動圓形按鈕（實測頁面中僅原生 go-bottom 按鈕符合），不依賴浮動按鈕列結構；以 closest 排除 GoTop 本身及其內部的原生按鈕副本（不用 :not(.dsw-gotop *)，happy-dom 對其求值錯誤）
        _queryFloatingButtonOutsideGoTop() {
            const candidates = document.querySelectorAll('.' + DS_BUTTON_FLOATING + '.' + DS_BUTTON_CIRCLE + '[role="button"]');
            const match = [...candidates].find(el => !el.closest('.dsw-gotop')) || null;
            if (match) this._hasSeenDom = true;
            return match;
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
            // 策略 1：從 anchor 向上走，找到最近的 .ds-scroll-area
            if (anchor) {
                let el = anchor.parentElement;
                while (el && el !== document.body) {
                    // 不可滾動的容器仍為有效目標：未溢出僅代表內容尚短，容器本身仍然正確，見 harvest.dom.js 同理修正。
                    if (el.classList.contains(SCROLL_AREA_CLASS)) {
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
                    // 不可滾動的容器仍為有效目標：未溢出僅代表內容尚短，容器本身仍然正確。
                    if (el.classList.contains(SCROLL_AREA_CLASS)) {
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
                    // 不可滾動的容器仍為有效目標：未溢出僅代表內容尚短，容器本身仍然正確。
                    if (overflowY === 'auto' || overflowY === 'scroll') {
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
