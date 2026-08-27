/**
 * DS studio — GoToTop Locate Anchor Bundle
 * 錨點偵測與原生按鈕定位。
 */
(function (root) {
    'use strict';

    const __DSSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
    const FLOATING_BAR = __DSSelectors.FLOATING_BUTTON_BAR_SELECTOR;
    const GO_TOP_NATIVE_BUTTON_CLASS = __DSSelectors.GO_TOP_NATIVE_BUTTON_CLASS;

    const bundle = {
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
    };

    root.__DS_GoToTop_locate_anchor = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
