/**
 * DS studio — 防護式 runtime 送訊（content/runtime-send.js）
 *
 * 單一職責：content 端「送出即忘」的 chrome.runtime.sendMessage 防護；同步拋錯（擴充功能情境失效）與 Promise 拒絕皆以 console.error 記錄後吞下，不影響呼叫端後續流程。
 * 使用端：content/auto-copy.relay.js、content/reply-notification.js；需要回覆內容的呼叫端不使用本檔。
 * 無載入期副作用，僅指派全域。
 */
(function (root) {
    'use strict';

    /**
     * 送出訊息並隔離失敗：同步拋錯與 Promise 拒絕皆記錄 `[DSS] <failureLabel>:` 後吞下。
     * @param {object} message - 送往 background 的訊息
     * @param {string} failureLabel - 失敗記錄的內容標籤（含模組名稱，例如 reply-notification:送出通知訊息失敗）
     */
    function sendAndLogFailure(message, failureLabel) {
        const logFailure = (error) => console.error(`[DSS] ${failureLabel}:`, error);
        try {
            const pending = chrome.runtime.sendMessage(message);
            if (pending && typeof pending.catch === 'function') pending.catch(logFailure);
        } catch (error) {
            logFailure(error);
        }
    }

    root.DSSRuntimeSend = Object.freeze({ sendAndLogFailure });

    // === Test export (no-op in browser) ===
    if (typeof module !== 'undefined' && module.exports) module.exports = root.DSSRuntimeSend;
})(globalThis);
