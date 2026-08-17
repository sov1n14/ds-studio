/**
 * DS Studio — Prompt Injector Controller
 * 從 content-script.js 抽離：前綴組裝、textarea 注入、Enter 鍵與送出按鈕攔截。
 * 維持與原檔完全相同的公開行為，確保 content-script.js 與現有 Vitest 測試零改動。
 *
 * 此檔案以 classic script 載入，無 ES import/export。
 */

(function (root) {
    'use strict';

    // 編輯視窗「傳送」按鈕的結構性標記（語言無關，不依賴文字或雜湊類別）：
    // 同時具備 primary + filled 變體樣式，且含有 span.ds-button__content 標籤。
    // 「取消」按鈕使用 outlinedNeutral/outlined 變體，不符合；主輸入框傳送按鈕
    // 雖共用 primary/filled，但為純圖示按鈕、無 content span，故亦不符合。
    const EDIT_SEND_BUTTON_VARIANT_CLASSES = ['ds-button--primary', 'ds-button--filled'];

    // 判斷按鈕是否為編輯視窗的「傳送」按鈕（結構性比對，不比對文字內容）
    function isEditWindowSendButton(button) {
        const hasSendVariant = EDIT_SEND_BUTTON_VARIANT_CLASSES.every(cls => button.classList.contains(cls));
        if (!hasSendVariant) return false;

        const contentLabel = button.querySelector('span.ds-button__content')?.textContent.trim();
        return !!contentLabel;
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
         * @returns {boolean} 注入成功回傳 true，否則 false
         */
        function injectPrefix(textarea) {
            if (!ctx.getIsEnabled()) return false;

            const injectionPrefix = buildInjectionPrefix();
            // 嘗試從已注入內容中提取原始使用者訊息；若無則使用原始值
            const rawVal = textarea.value;
            const userInputMatch = rawVal.match(/<user-input>\n([\s\S]*)\n<\/user-input>$/);
            const currentVal = userInputMatch ? userInputMatch[1] : rawVal;

            if (currentVal.trim() === '') return false;

            // formatSystemTime 由 ctx 提供（不讀取模組層級狀態）
            const systemTimePrefix = ctx.getShowSystemTime() ? `Current Time: ${ctx.formatSystemTime()}\n\n` : '';

            let newVal;
            if (injectionPrefix) {
                newVal = `${systemTimePrefix}${injectionPrefix}\n\n<user-input>\n${currentVal}\n</user-input>`;
            } else {
                newVal = `${systemTimePrefix}<user-input>\n${currentVal}\n</user-input>`;
            }

            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeTextAreaValueSetter.call(textarea, newVal);

            // 觸發 React 16+ 的 input 事件
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));

            return true;
        }

        /**
         * 偵測目前是否為行動裝置或行動裝置模擬器。
         */
        function isMobileDevice() {
            return navigator.maxTouchPoints > 0 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        }

        // 鍵盤事件攔截（Enter 送出）
        document.addEventListener('keydown', (e) => {
            // 僅攔截不含 Shift 的 Enter 鍵
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                if (ctx.getIsInjecting()) return;
                if (isMobileDevice()) return;

                const activeElement = document.activeElement;

                if (activeElement && activeElement.tagName === 'TEXTAREA') {
                    if (activeElement.value.trim() !== '') ctx.markChatCreationAttempt();
                    if (injectPrefix(activeElement)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        requestAnimationFrame(() => {
                            ctx.setIsInjecting(true);
                            const enterEvent = new KeyboardEvent('keydown', {
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13,
                                which: 13,
                                bubbles: true,
                                cancelable: true,
                                composed: true
                            });
                            activeElement.dispatchEvent(enterEvent);
                            ctx.setIsInjecting(false);
                        });
                    }
                }
            }
        }, { capture: true });

        // 滑鼠/指標事件攔截（點擊送出按鈕）
        ['pointerdown', 'mousedown', 'click'].forEach(eventType => {
            document.addEventListener(eventType, (e) => {
                if (ctx.getIsInjecting()) return;

                // 同時比對桌面版（ds-icon-button）與行動版（ds-button）送出按鈕
                const button = e.target.closest('div.ds-icon-button[role="button"], div.ds-button[role="button"]');

                if (button) {
                    const isEditSendButton = isEditWindowSendButton(button);

                    const isSendButton = button.innerHTML.includes('M8.3125') ||
                                         button.closest('.ba4f09d3') ||
                                         button.parentElement.classList.contains('bf38813a') ||
                                         isEditSendButton;

                    if (!isSendButton) return;

                    let textarea;
                    if (isEditSendButton) {
                        // 優先使用 activeElement（在 pointerdown 時焦點尚未轉移，最可靠）
                        if (document.activeElement?.tagName === 'TEXTAREA') {
                            textarea = document.activeElement;
                        } else {
                            // 備援：向上遍歷 DOM 找最近且非空的 textarea
                            let el = button.parentElement;
                            while (el && el !== document.body) {
                                const ta = el.querySelector('textarea');
                                if (ta && ta.value.trim() !== '') { textarea = ta; break; }
                                el = el.parentElement;
                            }
                            if (!textarea) {
                                textarea = document.querySelector('textarea');
                            }
                        }
                    } else {
                        textarea = document.querySelector('textarea');
                    }

                    if (textarea && textarea.value.trim() !== '') {
                        ctx.markChatCreationAttempt();
                        const didInject = injectPrefix(textarea);

                        if (didInject) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();

                            const capturedTextarea = textarea;
                            requestAnimationFrame(() => {
                                const ta = isEditSendButton ? capturedTextarea : document.querySelector('textarea');
                                if (!ta || ta.value.trim() === '') return;
                                ctx.setIsInjecting(true);
                                button.click();
                                ctx.setIsInjecting(false);
                            });
                        }
                    }
                }
            }, { capture: true });
        });

        return { buildInjectionPrefix, injectPrefix };
    }

    // 瀏覽器 classic script 環境：掛至全域命名空間
    root.__DS_PromptInjector = { createPromptInjector };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPromptInjector };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
