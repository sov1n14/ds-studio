/**
 * DS Studio — Prompt Injector Controller
 * 從 content-script.js 抽離：前綴組裝、textarea 注入、Enter 鍵與送出按鈕攔截。
 * 維持與原檔完全相同的公開行為，確保 content-script.js 與現有 Vitest 測試零改動。
 *
 * 送出按鈕的辨識與 textarea 解析由 prompt-injector.send-button.js 負責；
 * DeepSeek 頁面選擇器一律取自 content/ds-selectors.js。
 *
 * 此檔案以 classic script 載入，無 ES import/export。
 */

(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const selectors = root.DSstudio?.Selectors ||
    // Stryker disable next-line all: equivalent mutant — conditional require always resolves in Node test env
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // 送出按鈕辨識部件（瀏覽器：prompt-injector.send-button.js 於前載入；Node.js 測試：直接 require）
    const sendButton = root.__DS_PromptInjectorSendButton ||
    // Stryker disable next-line all: equivalent mutant — conditional require always resolves in Node test env
        (typeof require !== 'undefined' ? require('./prompt-injector.send-button.js') : {});

    const {
        isEditWindowSendButton,
        isSendButtonCandidate,
        isSendButtonEnabled,
        findSendButtonForTextarea,
        resolveTextareaForButton,
        hasComposerAttachment,
    } = sendButton;

    // 行動裝置判定共用工具（瀏覽器：content/mobile-device.js 於前載入；Node.js 測試：直接 require）
    const mobileDevice = root.DSSMobileDevice ||
    // Stryker disable next-line all: equivalent mutant — conditional require always resolves in Node test env
        (typeof require !== 'undefined' ? require('./mobile-device.js') : {});
    const { isMobileDevice } = mobileDevice;

    // 使用者文字開頭的「Current Time: ...」行（含其後的空白行）；系統時間開啟時剝除，改由注入補上最新時間戳
    const LEADING_SYSTEM_TIME_LINE_PATTERN = /^Current Time:[^\n]*(?:\n|$)(?:[ \t]*\n)*/;

    /**
     * 剝除使用者文字最開頭的舊時間戳行，避免重複注入時間。僅比對文字開頭，其他位置不動。
     * @param {string} text
     * @returns {string}
     */
    function stripLeadingSystemTimeLine(text) {
        return text.replace(LEADING_SYSTEM_TIME_LINE_PATTERN, '');
    }

    // 取出 <user-input> 包裝內的使用者文字；未包裝時原樣回傳
    function unwrapUserInput(text) {
        const userInputMatch = text.match(/<user-input>\n([\s\S]*)\n<\/user-input>$/);
        return userInputMatch ? userInputMatch[1] : text;
    }

    /**
     * 建立 PromptInjector 實例。ctx 的 getter/setter 直接讀寫 content-script.js
     * 模組層級的 let 變數，確保狀態異動對本模組即時可見，反之亦然。
     * @param {object} ctx
     */
    function createPromptInjector(ctx) {
        // 前綴組裝與注入
        function buildInjectionPrefix() {
            const parts = [];
            if (ctx.getIsGlobalPromptEnabled() && ctx.getGlobalDefaultPrompt()) parts.push(ctx.getGlobalDefaultPrompt());
            if (ctx.getPromptPrefix()) parts.push(ctx.getPromptPrefix());
            const combined = parts.join('\n\n');
            if (!combined) return '';
            return `<system-reminder>\n${combined}\n</system-reminder>`;
        }

        /**
         * 將組合後的提示前綴注入 textarea，並觸發 React 狀態更新。
         * @param {HTMLTextAreaElement} textarea
         * @param {boolean} [isSendableWithoutText=false] 是否在文字為空時仍可送出（例如僅附件/圖片）
         * @returns {boolean} 注入成功回傳 true，否則 false
         */
        function injectPrefix(textarea, isSendableWithoutText = false) {
            if (!ctx.getIsEnabled()) return false;

            const injectionPrefix = buildInjectionPrefix();
            const isShowSystemTime = ctx.getIsShowSystemTime();
            const unwrappedVal = unwrapUserInput(textarea.value);
            // 系統時間開啟時剝除開頭的舊時間戳，確保送出內容僅有一行 Current Time
            const currentVal = isShowSystemTime ? stripLeadingSystemTimeLine(unwrappedVal) : unwrappedVal;
            const hasUserText = currentVal.trim() !== '';

            if (!hasUserText && !isSendableWithoutText) return false;

            const systemTimePrefix = isShowSystemTime ? `Current Time: ${ctx.formatSystemTime()}\n\n` : '';

            let newVal;
            // 無文字但可送出（僅附件/圖片）：僅注入時間戳與提示前綴，不包裝 <user-input>
            if (!hasUserText) {
                newVal = `${systemTimePrefix}${injectionPrefix}`;
            } else if (injectionPrefix) {
                newVal = `${systemTimePrefix}${injectionPrefix}\n\n<user-input>\n${currentVal}\n</user-input>`;
            } else {
                newVal = `${systemTimePrefix}<user-input>\n${currentVal}\n</user-input>`;
            }

            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeTextAreaValueSetter.call(textarea, newVal);

            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));

            return true;
        }

        // 輸入框是否只剩開頭的舊時間戳行（擴充功能啟用且系統時間開啟時；與 injectPrefix 採同一剝除規則）
        function isStaleTimeLineOnly(textarea) {
            if (!ctx.getIsEnabled() || !ctx.getIsShowSystemTime()) return false;
            const unwrappedVal = unwrapUserInput(textarea.value);
            const strippedVal = stripLeadingSystemTimeLine(unwrappedVal);
            return strippedVal !== unwrappedVal &&
                // Stryker disable next-line ConditionalExpression: 等價變異 — 舊時間行後接使用者文字時，injectPrefix 依同一段去除後的文字判定有內容，送出結果與原式相同
                strippedVal.trim() === '';
        }

        // 攔截原始事件，改由本模組於注入完成後自行重送
        function suppressEvent(e) {
            e.preventDefault();
            // Stryker disable next-line CallExpression: equivalent — stopImmediatePropagation on next line is a superset
            e.stopPropagation();
            e.stopImmediatePropagation();
        }

        /**
         * 注入完成後於下一個影格重送原生 Enter 鍵，讓 DeepSeek 依既有流程送出。
         * @param {HTMLTextAreaElement} textarea
         */
        function redispatchEnter(textarea) {
            requestAnimationFrame(() => {
                ctx.setIsInjecting(true);
                textarea.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true,
                    composed: true
                }));
                ctx.setIsInjecting(false);
            });
        }

        /**
         * 注入完成後於下一個影格重送按鈕點擊。
         * 主輸入框需重新查詢 textarea（React 可能已重建節點），編輯視窗則沿用注入時的節點。
         * @param {Element} button
         * @param {HTMLTextAreaElement} capturedTextarea
         * @param {boolean} isEditSendButton
         */
        function redispatchClick(button, capturedTextarea, isEditSendButton) {
            requestAnimationFrame(() => {
                const ta = isEditSendButton ? capturedTextarea : document.querySelector(selectors.INPUT_TEXTAREA_SELECTOR);
                if (!ta || ta.value.trim() === '') { ctx.setIsInjecting(false); return; }
                ctx.setIsInjecting(true);
                button.click();
                ctx.setIsInjecting(false);
            });
        }

        // 鍵盤事件攔截（Enter 送出）
        document.addEventListener('keydown', (e) => {
            // 僅攔截不含 Shift 的 Enter 鍵
            if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
            if (ctx.getIsInjecting()) return;
            if (isMobileDevice()) return;

            const activeElement = document.activeElement;
            if (!activeElement || activeElement.tagName !== 'TEXTAREA') return;

            const hasText = activeElement.value.trim() !== '';
            const isStaleOnly = isStaleTimeLineOnly(activeElement);
            if (hasText && !isStaleOnly) ctx.markChatCreationAttempt();

            // 只剩舊時間戳時以附件判斷可否送出（按鈕此時必為啟用）；無文字時才確認送出按鈕狀態（僅附件/圖片的情境）
            const isSendableWithoutText = isStaleOnly
                ? hasComposerAttachment(activeElement)
                : !hasText && isSendButtonEnabled(findSendButtonForTextarea(activeElement));

            if (!injectPrefix(activeElement, isSendableWithoutText)) {
                // 只剩舊時間戳且無附件：攔下送出，輸入框維持原狀
                if (isStaleOnly) suppressEvent(e);
                return;
            }
            if (!hasText || isStaleOnly) ctx.markChatCreationAttempt();

            suppressEvent(e);
            redispatchEnter(activeElement);
        }, { capture: true });

        // 滑鼠/指標事件攔截（點擊送出按鈕）
        ['pointerdown', 'mousedown', 'click'].forEach(eventType => {
            document.addEventListener(eventType, (e) => {
                if (ctx.getIsInjecting()) return;

                // 比對送出按鈕（ds-button）
                const button = e.target.closest(selectors.SEND_BUTTON_ROLE_SELECTOR);
                if (!button) return;

                const isEditSendButton = isEditWindowSendButton(button);
                if (!isSendButtonCandidate(button, isEditSendButton)) return;

                const textarea = resolveTextareaForButton(button, isEditSendButton);
                if (!textarea) return;

                const hasText = textarea.value.trim() !== '';
                const isStaleOnly = isStaleTimeLineOnly(textarea);
                // 只剩舊時間戳時以附件判斷可否送出，否則沿用送出按鈕狀態
                const isSendableWithoutText = isStaleOnly
                    ? hasComposerAttachment(textarea)
                    : !hasText && isSendButtonEnabled(button);

                if (hasText && !isStaleOnly) ctx.markChatCreationAttempt();
                if (!injectPrefix(textarea, isSendableWithoutText)) {
                    // 只剩舊時間戳且無附件：攔下點擊，輸入框維持原狀
                    if (isStaleOnly) suppressEvent(e);
                    return;
                }
                if (!hasText || isStaleOnly) ctx.markChatCreationAttempt();

                // 同步設定注入旗標，防止同一次實體點擊的後續事件（mousedown/click）重複注入
                ctx.setIsInjecting(true);
                suppressEvent(e);
                redispatchClick(button, textarea, isEditSendButton);
            }, { capture: true });
        });

        return { buildInjectionPrefix, injectPrefix };
    }

    // Stryker disable all: equivalent mutants — module/globalThis export boilerplate, untestable in Node
    root.__DS_PromptInjector = { createPromptInjector };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPromptInjector };
    }

})(globalThis);
// Stryker restore all
