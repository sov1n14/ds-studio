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
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // 送出按鈕辨識部件（瀏覽器：prompt-injector.send-button.js 於前載入；Node.js 測試：直接 require）
    const sendButton = root.__DS_PromptInjectorSendButton ||
        (typeof require !== 'undefined' ? require('./prompt-injector.send-button.js') : {});

    const {
        isEditWindowSendButton,
        isSendButtonCandidate,
        isSendButtonEnabled,
        findSendButtonForTextarea,
        resolveTextareaForButton,
    } = sendButton;

    // 行動裝置判定共用工具（瀏覽器：content/mobile-device.js 於前載入；Node.js 測試：直接 require）
    const mobileDevice = root.DSSMobileDevice ||
        (typeof require !== 'undefined' ? require('./mobile-device.js') : {});
    const { isMobileDevice } = mobileDevice;

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
            const rawVal = textarea.value;
            const userInputMatch = rawVal.match(/<user-input>\n([\s\S]*)\n<\/user-input>$/);
            const currentVal = userInputMatch ? userInputMatch[1] : rawVal;
            const hasUserText = currentVal.trim() !== '';

            if (!hasUserText && !isSendableWithoutText) return false;

            const systemTimePrefix = ctx.getShowSystemTime() ? `Current Time: ${ctx.formatSystemTime()}\n\n` : '';

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

        // 攔截原始事件，改由本模組於注入完成後自行重送
        function suppressEvent(e) {
            e.preventDefault();
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
                const ta = isEditSendButton ? capturedTextarea : document.querySelector('textarea');
                if (!ta || ta.value.trim() === '') return;
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
            if (hasText) ctx.markChatCreationAttempt();

            // 僅在無文字時才需確認送出按鈕是否可送出（僅附件/圖片的情境）
            const sendButtonEl = hasText ? null : findSendButtonForTextarea(activeElement);
            const isSendableWithoutText = !hasText && isSendButtonEnabled(sendButtonEl);

            if (!injectPrefix(activeElement, isSendableWithoutText)) return;
            if (!hasText) ctx.markChatCreationAttempt();

            suppressEvent(e);
            redispatchEnter(activeElement);
        }, { capture: true });

        // 滑鼠/指標事件攔截（點擊送出按鈕）
        ['pointerdown', 'mousedown', 'click'].forEach(eventType => {
            document.addEventListener(eventType, (e) => {
                if (ctx.getIsInjecting()) return;

                // 同時比對桌面版（ds-icon-button）與行動版（ds-button）送出按鈕
                const button = e.target.closest(selectors.SEND_BUTTON_ROLE_SELECTOR);
                if (!button) return;

                const isEditSendButton = isEditWindowSendButton(button);
                if (!isSendButtonCandidate(button, isEditSendButton)) return;

                const textarea = resolveTextareaForButton(button, isEditSendButton);
                if (!textarea) return;

                const hasText = textarea.value.trim() !== '';
                const isSendableWithoutText = !hasText && isSendButtonEnabled(button);

                if (hasText) ctx.markChatCreationAttempt();
                if (!injectPrefix(textarea, isSendableWithoutText)) return;
                if (!hasText) ctx.markChatCreationAttempt();

                suppressEvent(e);
                redispatchClick(button, textarea, isEditSendButton);
            }, { capture: true });
        });

        return { buildInjectionPrefix, injectPrefix };
    }

    root.__DS_PromptInjector = { createPromptInjector };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPromptInjector };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
