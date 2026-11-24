/**
 * DS studio — 編輯視窗存檔請求通道（utils/editor-flush-channel.js）
 *
 * 單一職責：包裝「關窗或導覽前請編輯視窗先存檔」的 chrome.runtime 訊息往返，讓 popup/ 不必直接呼叫 chrome.*，請求端也只保留一份實作。
 *   - listenForFlushRequests(slot, answerFlush)：編輯視窗（popup/editor/editor.js）註冊監聽器，只回應本視窗 slot 的請求，以 { status } 非同步回覆。
 *   - requestEditorFlush(slot)：service worker 關窗（background/editor-window-routes.js）與 popup 導覽（utils/window-control.js）共用的請求端，最多等待約 1 秒。
 * 相依：utils/message-constants.js 需先載入（DSS_EDITOR_WINDOW）。
 * 無載入期副作用：載入僅完成全域指派。
 */
(function () {
    'use strict';

    // 等待編輯視窗回報存檔結果的上限（最多約 1 秒），逾時由呼叫端照常關窗或導覽
    const FLUSH_REPLY_WAIT_MS = 1000;

    /** 於呼叫時解析存檔請求常數，缺失即拋出並指名修法。 */
    function resolveFlushConstants() {
        const constants = globalThis.DSS_EDITOR_WINDOW;
        if (constants?.FLUSH_MESSAGE_TYPE && constants?.FLUSH_STATUS) return constants;
        throw new Error('[DSS] editor-flush-channel: globalThis.DSS_EDITOR_WINDOW.FLUSH_MESSAGE_TYPE / FLUSH_STATUS is missing — load utils/message-constants.js before utils/editor-flush-channel.js');
    }

    /**
     * 請指定 slot 的編輯視窗先存檔，最多等待 FLUSH_REPLY_WAIT_MS。
     * 無接收端（拒絕）、同步拋錯、回應缺漏或逾時一律回傳 undefined，由呼叫端照常關窗或導覽。
     * @param {string} slot - DSS_EDITOR_WINDOW.STORAGE_KEYS 的屬性名稱（'global' / 'preset'）
     * @returns {Promise<string|undefined>} 編輯視窗回報的 status
     */
    async function requestEditorFlush(slot) {
        const { FLUSH_MESSAGE_TYPE } = resolveFlushConstants();
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(resolve, FLUSH_REPLY_WAIT_MS); });
        try {
            const reply = await Promise.race([
                chrome.runtime.sendMessage({ type: FLUSH_MESSAGE_TYPE, slot }),
                timeout,
            ]);
            return reply?.status;
        } catch {
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * 註冊存檔請求監聽器：只回應 slot 相符的請求，以 { status } 非同步回覆；非擴充功能環境（無 chrome.runtime）時不註冊。
     * @param {string} slot - DSS_EDITOR_WINDOW.STORAGE_KEYS 的屬性名稱
     * @param {() => Promise<string>} answerFlush - 執行存檔並回傳 FLUSH_STATUS
     */
    function listenForFlushRequests(slot, answerFlush) {
        if (!globalThis.chrome?.runtime?.onMessage) return;
        const { FLUSH_MESSAGE_TYPE, FLUSH_STATUS } = resolveFlushConstants();
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message?.type !== FLUSH_MESSAGE_TYPE || message.slot !== slot) return false;
            answerFlush()
                .then((status) => sendResponse({ status }))
                .catch((err) => {
                    console.error('[DSS] editor flush request:', err);
                    sendResponse({ status: FLUSH_STATUS.FAILED });
                });
            return true; // 非同步回應
        });
    }

    globalThis.DSSEditorFlushChannel = { requestEditorFlush, listenForFlushRequests };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSEditorFlushChannel;
})();
