/**
 * DS studio — GoToTop Locate Scroll Bundle
 * 捲動容器定位策略。
 */
(function (root) {
    'use strict';

    const __DSSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
    const SCROLL_AREA_CLASS = __DSSelectors.SCROLL_AREA_CLASS;

    const bundle = {
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

    root.__DS_GoToTop_locate_scroll = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
