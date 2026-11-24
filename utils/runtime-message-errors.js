/**
 * DS studio — runtime 訊息錯誤分類（utils/runtime-message-errors.js）
 *
 * 單一職責：判斷 chrome.runtime.sendMessage 的拒絕原因是否為「沒有任何 context 在接收」（offscreen 文件已關閉、service worker 尚未就緒）；Chrome 以 `Receiving end does not exist` 拒絕，background/clipboard-routes.js 與 utils/storage-manager.chatmap.client.js 共用此一判斷規則，訊息比對僅此一處定義。
 * 無載入期副作用：載入僅完成全域指派；以 IIFE 包裹，避免與其他腳本共用的全域識別字衝突。
 */
(() => {
    /** Chrome 找不到接收端時，sendMessage 拒絕所帶的錯誤訊息片段（比對不分大小寫）。 */
    const NO_RECEIVER_PATTERN = /Receiving end does not exist/i;

    /**
     * 判斷錯誤是否為「沒有接收端」；Error、含 message 的物件與純字串皆可，其他值一律回傳 false。
     * @param {unknown} err - chrome.runtime.sendMessage 拒絕或同步拋出的值
     * @returns {boolean} 錯誤文字含沒有接收端的訊息片段時為 true
     */
    const isNoReceiverError = (err) => NO_RECEIVER_PATTERN.test(String(err?.message ?? err));

    globalThis.DSSRuntimeMessageErrors = { isNoReceiverError };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSRuntimeMessageErrors;
})();
