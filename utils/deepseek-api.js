/**
 * DS studio — DeepSeek 官方 API 呼叫封裝
 * 單一職責：對 DeepSeek REST 端點發送請求並回報成敗。
 * 層級無關（不觸碰 window / document），可由 service worker 或任一層以 classic script 載入。
 */
const DSSDeepSeekApi = (() => {
    'use strict';

    // 刪除對話端點；utils 層不得相依 content 層，故在此自行宣告同值常數
    const DELETE_ENDPOINT_URL = 'https://chat.deepseek.com/api/v0/chat_session/delete';

    /**
     * 對 DeepSeek API 發送刪除對話請求。
     * keepalive 預設為 true，確保在分頁關閉情境下請求仍可完成；導航情境可傳 false。
     * @param {string} chatUuid - 要刪除的對話 UUID
     * @param {string} authToken - Bearer 授權 Token
     * @param {{ keepalive?: boolean }} [options]
     * @returns {Promise<boolean>} 成功回傳 true，任何失敗回傳 false
     */
    async function performDeleteFetch(chatUuid, authToken, { keepalive = true } = {}) {
        if (!authToken || !chatUuid) return false;
        try {
            const response = await fetch(DELETE_ENDPOINT_URL, {
                method: 'POST',
                keepalive,
                headers: {
                    'authorization': authToken,
                    'content-type': 'application/json',
                    'x-app-version': '2.0.0',
                    'x-client-bundle-id': 'com.deepseek.chat',
                    'x-client-locale': 'zh_Hant',
                    'x-client-platform': 'web',
                    'x-client-timezone-offset': '28800',
                    'x-client-version': '2.0.0',
                },
                body: JSON.stringify({ chat_session_id: chatUuid }),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    return { performDeleteFetch };
})();

globalThis.DSSDeepSeekApi = DSSDeepSeekApi;

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DSSDeepSeekApi;
}
