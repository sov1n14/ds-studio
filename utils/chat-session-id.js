/**
 * DS studio — 對話 session id 擷取共用工具（utils/chat-session-id.js）
 *
 * 單一職責：從 pathname 或完整網址取出 /a/chat/s/<id> 的 id，取不到回傳 null。
 * 未傳入（或傳入 undefined）時於呼叫當下讀取 window.location.pathname，不做快取。
 * 無載入期副作用：載入僅完成 globalThis 指派。
 */
(function () {
    'use strict';

    const SESSION_PATH_PATTERN = /\/a\/chat\/s\/([a-f0-9-]+)/;

    /**
     * @param {string} [input] pathname 或完整網址；省略時取用目前 location.pathname
     * @returns {string|null}
     */
    function extractChatSessionId(input) {
        const defaultPath = typeof window !== 'undefined' ? window.location.pathname : '';
        const source = input === undefined ? defaultPath : input;
        if (typeof source !== 'string' || source === '') return null;

        const match = source.match(SESSION_PATH_PATTERN);
        return match ? match[1] : null;
    }

    globalThis.DSSChatSessionId = { extractChatSessionId };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSChatSessionId;
})();
