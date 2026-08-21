/**
 * DS Studio — Prompt Injector Controller
 * 從 content-script.js 抽離：前綴組裝、textarea 注入、Enter 鍵與送出按鈕攔截。
 * 維持與原檔完全相同的公開行為，確保 content-script.js 與現有 Vitest 測試零改動。
 *
 * 此檔案以 classic script 載入，無 ES import/export。
 */

(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const selectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // 編輯視窗「傳送」按鈕的結構性標記（語言無關，不依賴文字或雜湊類別）：
    // 同時具備 primary + filled 變體樣式，且含有 span.ds-button__content 標籤。
    // 「取消」按鈕使用 outlinedNeutral/outlined 變體，不符合；主輸入框傳送按鈕
    // 雖共用 primary/filled，但為純圖示按鈕、無 content span，故亦不符合。
    const EDIT_SEND_BUTTON_VARIANT_CLASSES = ['ds-button--primary', 'ds-button--filled'];
    // 桌面版（ds-icon-button）與行動版（ds-button）送出按鈕共用的結構選擇器，
    // 供點擊路徑與 Enter 鍵路徑共用，避免重複硬編字串。
    const SEND_BUTTON_SELECTOR = 'div.ds-icon-button[role="button"], div.ds-button[role="button"]';

    // 判斷按鈕是否為編輯視窗的「傳送」按鈕（結構性比對，不比對文字內容）
    function isEditWindowSendButton(button) {
        const hasSendVariant = EDIT_SEND_BUTTON_VARIANT_CLASSES.every(cls => button.classList.contains(cls));
        if (!hasSendVariant) return false;

        const contentLabel = button.querySelector('span.ds-button__content')?.textContent.trim();
        return !!contentLabel;
    }

    // 判斷按鈕是否為送出按鈕（桌面版圖示、行動版容器 class，或編輯視窗傳送按鈕）
    function isSendButtonCandidate(button) {
        if (!button) return false;
        return button.innerHTML.includes('M8.3125') ||
               !!button.closest(selectors.SEND_BUTTON_CONTAINER_SELECTOR) ||
               button.parentElement.classList.contains(selectors.SEND_BUTTON_PARENT_CLASS) ||
               isEditWindowSendButton(button);
    }

    // 判斷送出按鈕目前是否處於「可送出」狀態（未被 DeepSeek 自身標記為 disabled）。
    // ds-button--disabled 為語意化 BEM class，優先於雜湊 class 作為主要判斷依據。
    function isSendButtonEnabled(button) {
        if (!button) return false;
        if (button.classList.contains('ds-button--disabled')) return false;
        if (button.getAttribute('aria-disabled') === 'true') return false;
        if (button.disabled) return false;
        return true;
    }

    // 由 textarea 向上遍歷 DOM，找出同一輸入區內的送出按鈕（供 Enter 鍵路徑使用，
    // 與點擊路徑共用 isSendButtonCandidate，不重複選擇器字串）。
    function findSendButtonForTextarea(textarea) {
        if (!textarea) return null;
        let el = textarea.parentElement;
        while (el && el !== document.body) {
            const candidate = el.querySelector(SEND_BUTTON_SELECTOR);
            if (candidate && isSendButtonCandidate(candidate)) return candidate;
            el = el.parentElement;
        }
        return null;
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
                    const hasText = activeElement.value.trim() !== '';
                    if (hasText) ctx.markChatCreationAttempt();

                    const sendButton = hasText ? null : findSendButtonForTextarea(activeElement);
                    const isSendableWithoutText = !hasText && isSendButtonEnabled(sendButton);

                    const didInject = injectPrefix(activeElement, isSendableWithoutText);
                    if (didInject) {
                        if (!hasText) ctx.markChatCreationAttempt();

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
                const button = e.target.closest(SEND_BUTTON_SELECTOR);

                if (button) {
                    const isEditSendButton = isEditWindowSendButton(button);

                    if (!isSendButtonCandidate(button)) return;

                    let textarea;
                    if (isEditSendButton) {
                        // 優先使用 activeElement（在 pointerdown 時焦點尚未轉移，最可靠）
                        if (document.activeElement?.tagName === 'TEXTAREA') {
                            textarea = document.activeElement;
                        } else {
                            // 備援優先序：(1) 向上遍歷 DOM 找到的非空 textarea 優先；
                            // (2) 找不到時，改採全域查詢 document.querySelector('textarea')，若其為非空亦優先採用；
                            // (3) 兩者皆無非空 textarea 時，才退回空 textarea（walk-up 找到的最近者優先，否則用全域查詢結果，
                            //     例如僅附件/圖片送出的情境）。空 textarea 僅作為最後手段，絕不能提前短路上述優先序。
                            let el = button.parentElement;
                            let firstEmptyTextarea = null;
                            while (el && el !== document.body) {
                                const ta = el.querySelector('textarea');
                                if (ta) {
                                    if (ta.value.trim() !== '') { textarea = ta; break; }
                                    if (!firstEmptyTextarea) firstEmptyTextarea = ta;
                                }
                                el = el.parentElement;
                            }
                            if (!textarea) {
                                // 全域查詢備援：非空優先於任何空 textarea（包含 walk-up 找到的空 textarea）。
                                const globalFallbackTextarea = document.querySelector('textarea');
                                const isGlobalFallbackNonEmpty = !!globalFallbackTextarea && globalFallbackTextarea.value.trim() !== '';
                                textarea = isGlobalFallbackNonEmpty
                                    ? globalFallbackTextarea
                                    : (firstEmptyTextarea || globalFallbackTextarea);
                            }
                        }
                    } else {
                        textarea = document.querySelector('textarea');
                    }

                    if (textarea) {
                        const hasText = textarea.value.trim() !== '';
                        const isSendableWithoutText = !hasText && isSendButtonEnabled(button);

                        if (hasText) ctx.markChatCreationAttempt();
                        const didInject = injectPrefix(textarea, isSendableWithoutText);

                        if (didInject) {
                            if (!hasText) ctx.markChatCreationAttempt();

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

    root.__DS_PromptInjector = { createPromptInjector };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPromptInjector };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
