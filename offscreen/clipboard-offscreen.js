/**
 * DS studio — 剪貼簿 offscreen 文件腳本（offscreen/clipboard-offscreen.js）
 *
 * 單一職責：在 offscreen 文件（reason CLIPBOARD）內以 textarea + select + document.execCommand('copy') 代 service worker 寫入剪貼簿（決策 U6-14）。
 * classic script，由 offscreen/clipboard-offscreen.html 載入；該文件不載入 utils 腳本，故訊息型別於此宣告為具名常數。
 * 載入期副作用僅限全域指派與註冊一個 chrome.runtime.onMessage 監聽器：offscreen 文件與 service worker 相同，監聽器須於頂層註冊才能在文件建立後立即收訊。
 */
(() => {
    /** service worker 請 offscreen 文件寫入剪貼簿的訊息型別。 */
    const WRITE_CLIPBOARD_MESSAGE_TYPE = 'DSS_OFFSCREEN_WRITE_CLIPBOARD';

    /**
     * 以暫時 textarea 選取文字後呼叫 execCommand('copy')；無論成功、失敗或拋錯，textarea 一律移除。
     * @param {Document} doc - 執行複製的文件
     * @param {string} text - 要寫入剪貼簿的文字
     * @returns {boolean} execCommand('copy') 的回傳值；拋錯時為 false
     */
    function writeViaExecCommand(doc, text) {
        const textarea = doc.createElement('textarea');
        textarea.value = text;
        (doc.body || doc.documentElement).appendChild(textarea);
        try {
            textarea.select();
            return doc.execCommand('copy') === true;
        } catch (err) {
            console.error('[DSS] clipboard-offscreen.writeViaExecCommand:', err);
            return false;
        } finally {
            textarea.remove();
        }
    }

    /**
     * 處理寫入剪貼簿訊息並同步回覆 { ok }；非本型別訊息回傳 false 且不回覆，讓其他監聽器處理。
     * @param {{type?: string, text?: unknown}} message - 收到的訊息
     * @param {chrome.runtime.MessageSender} _sender - 發送端（未使用）
     * @param {(response: {ok: boolean}) => void} sendResponse - 回覆函式
     * @returns {false} 一律同步回覆或不回覆，無需保留回覆通道
     */
    function handleMessage(message, _sender, sendResponse) {
        if (message?.type !== WRITE_CLIPBOARD_MESSAGE_TYPE) return false;
        if (typeof message.text !== 'string') {
            sendResponse({ ok: false });
            return false;
        }
        sendResponse({ ok: writeViaExecCommand(document, message.text) });
        return false;
    }

    globalThis.DSSClipboardOffscreen = { writeViaExecCommand };
    chrome.runtime.onMessage.addListener(handleMessage);
})();
