/**
 * DS studio — Prompt Injector / 送出按鈕辨識部件
 *
 * 單一職責：判定某個 DOM 元素是否為 DeepSeek 的送出按鈕、該按鈕是否可送出，
 * 以及解析該按鈕對應的 textarea。不含任何注入邏輯與事件監聽。
 * 選擇器一律取自 content/ds-selectors.js，本檔不硬編任何 DeepSeek class 字串。
 *
 * 無載入期副作用：載入僅完成 globalThis 指派。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：ds-selectors.js 於前載入；Node.js 測試：直接 require）
    const selectors = root.DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    /**
     * 判斷按鈕是否為編輯視窗的「傳送」按鈕（結構性比對，不比對文字內容）：
     * 同時具備 primary + filled 變體樣式，且含有非空的內容標籤。
     * 主輸入框送出按鈕雖共用 primary/filled，但為純圖示按鈕、無內容標籤，故不符合。
     * @param {Element} button
     * @returns {boolean}
     */
    function isEditWindowSendButton(button) {
        if (!button) return false;

        const hasSendVariant = selectors.EDIT_SEND_BUTTON_VARIANT_CLASSES.every(cls => button.classList.contains(cls));
        if (!hasSendVariant) return false;

        const contentLabel = button.querySelector(selectors.BUTTON_CONTENT_SELECTOR)?.textContent.trim();
        return !!contentLabel;
    }

    /**
     * 判斷按鈕是否為送出按鈕（送出圖示、工具列容器、行動版父層 class，或編輯視窗傳送按鈕）。
     * @param {Element} button
     * @param {boolean} [isEditSendButton] 呼叫端已算出的編輯視窗傳送按鈕判定，避免重複計算
     * @returns {boolean}
     */
    function isSendButtonCandidate(button, isEditSendButton) {
        if (!button) return false;

        // 依成本由低到高短路求值，避免每次指標事件都跑完整條件鏈
        return !!button.querySelector(selectors.SEND_BUTTON_ICON_SELECTOR) ||
               !!button.closest(selectors.SEND_BUTTON_CONTAINER_SELECTOR) ||
               !!button.parentElement?.classList.contains(selectors.SEND_BUTTON_PARENT_CLASS) ||
               (isEditSendButton === undefined ? isEditWindowSendButton(button) : isEditSendButton);
    }

    /**
     * 判斷送出按鈕目前是否處於「可送出」狀態（未被 DeepSeek 自身標記為 disabled）。
     * @param {Element} button
     * @returns {boolean}
     */
    function isSendButtonEnabled(button) {
        if (!button) return false;
        if (button.classList.contains(selectors.BUTTON_DISABLED_CLASS)) return false;
        if (button.getAttribute('aria-disabled') === 'true') return false;
        if (button.disabled) return false;
        return true;
    }

    /**
     * 由 textarea 向上遍歷 DOM，找出同一輸入區內的送出按鈕（供 Enter 鍵路徑使用）。
     * @param {HTMLTextAreaElement} textarea
     * @returns {Element|null}
     */
    function findSendButtonForTextarea(textarea) {
        if (!textarea) return null;

        let el = textarea.parentElement;
        while (el && el !== document.body) {
            const candidate = el.querySelector(selectors.SEND_BUTTON_ROLE_SELECTOR);
            if (candidate && isSendButtonCandidate(candidate)) return candidate;
            el = el.parentElement;
        }
        return null;
    }

    /**
     * 由送出按鈕向上遍歷 DOM，找出最合適的 textarea。
     * 優先序：(1) 向上遍歷找到的非空 textarea；(2) 全域查詢到的非空 textarea；
     * (3) 皆為空時，向上遍歷找到的最近空 textarea 優先，否則採全域查詢結果
     *（例如僅附件/圖片送出的情境）。空 textarea 僅作為最後手段。
     * @param {Element} button
     * @returns {HTMLTextAreaElement|null}
     */
    function findTextareaNearButton(button) {
        let el = button?.parentElement;
        let firstEmptyTextarea = null;

        while (el && el !== document.body) {
            const ta = el.querySelector(selectors.INPUT_TEXTAREA_SELECTOR);
            if (ta) {
                if (ta.value.trim() !== '') return ta;
                if (!firstEmptyTextarea) firstEmptyTextarea = ta;
            }
            el = el.parentElement;
        }

        const globalFallbackTextarea = document.querySelector(selectors.INPUT_TEXTAREA_SELECTOR);
        const isGlobalFallbackNonEmpty = !!globalFallbackTextarea && globalFallbackTextarea.value.trim() !== '';
        if (isGlobalFallbackNonEmpty) return globalFallbackTextarea;
        return firstEmptyTextarea || globalFallbackTextarea;
    }

    /**
     * 解析送出按鈕所對應的 textarea。
     * 編輯視窗：優先取 activeElement（pointerdown 時焦點尚未轉移，最可靠），否則向上遍歷。
     * 主輸入框：頁面僅有一個主 textarea，直接全域查詢。
     * @param {Element} button
     * @param {boolean} isEditSendButton
     * @returns {HTMLTextAreaElement|null}
     */
    function resolveTextareaForButton(button, isEditSendButton) {
        if (!isEditSendButton) return document.querySelector(selectors.INPUT_TEXTAREA_SELECTOR);
        if (document.activeElement?.tagName === 'TEXTAREA') return document.activeElement;
        return findTextareaNearButton(button);
    }

    root.__DS_PromptInjectorSendButton = {
        isEditWindowSendButton,
        isSendButtonCandidate,
        isSendButtonEnabled,
        findSendButtonForTextarea,
        resolveTextareaForButton,
    };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.__DS_PromptInjectorSendButton;
    }

})(globalThis);
