/**
 * DS studio — Go To Top Locate Bundle
 * DOM 查詢輔助、捲動容器定位、錨點偵測、包裝容器定位與可見性評估。
 * 透過 Object.assign 合併至 GoToTop 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    const bundle = {
        // ─────────────────────────────
        //  Private: Query helpers
        // ─────────────────────────────

        /**
         * Attempt each CSS selector in order and return the first match.
         * 只有在首次成功解析到 DOM 後（_hasSeenDom = true）才累積失敗計數，
         * 避免在頁面初始化期間 DOM 尚未掛載時誤判為降級模式。
         * @param {string[]} selectors - Array of CSS selector strings
         * @returns {Element|null}
         */
        _querySelectorWithFallback(selectors) {
            if (!selectors || selectors.length === 0) return null;

            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    // 首次成功找到元素，啟動降級計數追蹤
                    this._hasSeenDom = true;
                    this._missCount = 0;
                    return el;
                }
            }

            // 尚未首次見到 DOM（頁面尚未完成掛載）時不計入失敗，避免假性降級
            if (!this._hasSeenDom) return null;

            this._missCount += 1;
            if (this._missCount >= this.DEGRADED_THRESHOLD && !this._degraded) {
                this._degraded = true;
            }
            return null;
        },

        /**
         * Walk up from anchor to find the scrollable container.
         * 以三段策略定位訊息列表的滾動容器，避免抓到側邊欄的 .ds-scroll-area。
         *
         * confirmed in full-page.html line 239: ._765a5cd.ds-scroll-area 包含 line 323 的虛擬列表。
         *
         * @param {Element} anchor - Starting DOM node
         * @returns {Element}
         */
        _findScrollContainer(anchor) {
            // 策略 1：從 anchor 向上走，找到最近的 .ds-scroll-area 且具備可滾動高度
            if (anchor) {
                let el = anchor.parentElement;
                while (el && el !== document.body) {
                    if (el.classList.contains('ds-scroll-area') &&
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
                    if (el.classList.contains('ds-scroll-area') &&
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
            // 主選擇器：以雜湊 class _0706cde 精確匹配，排除自身注入的按鈕
            // 降級鏈：依穩定 ds-* class 組合依序嘗試
            const result = this._querySelectorWithFallback([
                this.NATIVE_BTN_SELECTOR,
                '.aaff8b8f .ds-button--floating.ds-button--circle:not(.dsw-gotop)',
                '.aaff8b8f [role="button"].ds-button--floating.ds-button--circle:not(.dsw-gotop)',
                '.aaff8b8f [role="button"].ds-button--floating[class*="ds-button--circle"]:not(.dsw-gotop)',
            ]);
            if (!result) return null;

            // 後驗證：若匹配來自降級選擇器（非 _0706cde），
            // 確認元素確實為 floating 按鈕，而非 primary/filled/disabled 按鈕
            if (!result.classList.contains('_0706cde')) {
                if (!result.classList.contains('ds-button--floating') ||
                    result.classList.contains('ds-button--primary') ||
                    result.classList.contains('ds-button--filled') ||
                    result.classList.contains('ds-button--disabled')) {
                    return null;
                }
            }

            return result;
        },

        /**
         * 從原生按鈕結構上找到注入用的直接父層容器。
         * 結構定位策略（不依賴雜湊 class）：
         *   nativeBtn.parentElement → aaff8b8f（直接父層，full-page.html line 1015）
         * 若 parentElement 不存在，回傳 null。
         * @param {Element} nativeBtn
         * @returns {{ injectParent: Element, outerWrapper: Element }|null}
         */
        _locateWrapperElements(nativeBtn) {
            if (!nativeBtn) return null;

            // 直接父層即為注入點（aaff8b8f，full-page.html line 1015）
            const injectParent = nativeBtn.parentElement;
            if (!injectParent) {
                return null;
            }

            // 外層包裝（_871cbca，full-page.html line 1013）供 wrapperObserver 監控
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
         *
         * 嚴格策略（避免虛擬列表在中間某條訊息掛載時誤判為到頂）：
         *   1. scrollTop === 0（或 ≤ 1px epsilon）→ 確認到頂，直接回傳 true。
         *   2. 錨點檢查僅在錨點「可驗證為第一則訊息」時有效——
         *      即錨點同時符合 ANCHOR_SELECTOR_FALLBACK2（data-virtual-list-item-key="1"）。
         *      若無可驗證錨點，答案為「尚未到頂」（除非 scrollTop === 0）。
         *
         * 此函式也被 _evaluateVisibility 的隱藏條件使用；
         * 更嚴格的判斷表示「只有真正到頂才隱藏按鈕」，符合期望行為。
         *
         * @returns {boolean}
         */
        _isAtTop() {
            // 條件 1：滾動容器已確實滾至最頂（允許 1px 誤差以防瀏覽器次像素捨入）
            const container = this._scrollContainer;
            if (container && container.scrollTop <= 1) {
                return true;
            }

            // 條件 2：可驗證的第一則訊息錨點已進入視窗
            // 僅信任帶有 data-virtual-list-item-key="1" 的元素，
            // 排除「第一個已掛載訊息」這類模糊選擇器，避免虛擬列表半途掛載時誤判
            const verifiableAnchor = document.querySelector(this.ANCHOR_SELECTOR_FALLBACK2);
            if (verifiableAnchor) {
                const rect = verifiableAnchor.getBoundingClientRect();
                const vpHeight = window.innerHeight;
                // 長訊息回退：錨點高度超過視窗時，僅檢查頂部進入視窗即可
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
         * Applies hysteresis to avoid flickering.
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

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    root.__DS_GoToTop_locate = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
