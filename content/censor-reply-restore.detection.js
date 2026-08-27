/**
 * DS studio — CensorReplyRestore Detection Bundle
 * 審查偵測相關的純函式：判定審查狀態、工具列定位、前置使用者提示取得。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數
    var __DS_DetectionSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {
        _isCensored(toolbarGroupEl) {
            if (!toolbarGroupEl || !toolbarGroupEl.querySelectorAll) return false;
            // 舊設計系統：.ds-icon-button；新設計系統：.ds-button.ds-button--icon
            let buttons = toolbarGroupEl.querySelectorAll(__DS_DetectionSelectors.ICON_BUTTON_SELECTOR);
            if (buttons.length === 0) {
                buttons = toolbarGroupEl.querySelectorAll(__DS_DetectionSelectors.ICON_BUTTON_ROLE_SELECTOR);
            }
            if (buttons.length < 5) return false;
            const isDisabled = (btn) =>
                (btn.classList.contains(__DS_DetectionSelectors.ICON_BUTTON_DISABLED_CLASS) && btn.getAttribute('aria-disabled') === 'true') ||
                btn.classList.contains(__DS_DetectionSelectors.BUTTON_DISABLED_CLASS);
            return isDisabled(buttons[1]) && isDisabled(buttons[4]);
        },

        _getToolbarGroup(messageEl) {
            // 工具欄是 messageEl 的兄弟元素 — 在虛擬列表項目容器中搜尋
            const container = messageEl.closest(__DS_DetectionSelectors.VIRTUAL_ITEM_KEY_SELECTOR) || messageEl.parentElement;
            if (container) {
                const toolbar = container.querySelector(__DS_DetectionSelectors.MESSAGE_TOOLBAR_SELECTOR);
                if (toolbar) return toolbar;

                // 後備方案：尋找容器中任何有 5 個以上 icon buttons 的 .ds-flex
                const allFlex = container.querySelectorAll(__DS_DetectionSelectors.FLEX_ROW_SELECTOR);
                for (let i = 0; i < allFlex.length; i++) {
                    if (allFlex[i].querySelectorAll(__DS_DetectionSelectors.ICON_BUTTON_ANY_SELECTOR).length >= 5) return allFlex[i];
                }
            }

            return null;
        },

        _getPrecedingUserPromptKey(assistantMsgEl) {
            const virtualItem = assistantMsgEl.closest(__DS_DetectionSelectors.VIRTUAL_ITEM_KEY_SELECTOR);
            if (!virtualItem) return null;
            let prev = virtualItem.previousElementSibling;
            while (prev) {
                const msgEl = prev.querySelector(__DS_DetectionSelectors.MESSAGE_SELECTOR);
                if (msgEl) {
                    const userMsg = msgEl.querySelector(__DS_DetectionSelectors.USER_CONTENT_SELECTOR);
                    if (userMsg) {
                        return this._normalizePrompt(msgEl.textContent);
                    }
                }
                prev = prev.previousElementSibling;
            }
            return null;
        },
    };

    root.__DS_CensorReplyRestore_detection = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
