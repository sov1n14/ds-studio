/**
 * DS studio — Temporary Chat Delete API
 * 單一職責：委派刪除 fetch（utils/deepseek-api.js）、重試邏輯與失敗 toast 通知。
 * auth token 與 UUID 皆以參數傳入，此模組無可變狀態。
 */
const TemporaryChatDeleteApi = (() => {
    'use strict';

    // 最多重試次數（導航觸發刪除失敗時使用）
    const MAX_RETRY_ATTEMPTS = 3;
    // 每次重試間隔（毫秒）
    const RETRY_INTERVAL_MS = 30000;

    /**
     * 呼叫 DeepSeek 刪除 API 一次。
     * 成功（HTTP 2xx）回傳 true，網路錯誤或非 2xx 回傳 false。
     * @param {string} chatUuid
     * @param {string} authToken
     * @param {{ keepalive?: boolean }} [options]
     * @returns {Promise<boolean>}
     */
    async function deleteChatSession(chatUuid, authToken, { keepalive = false } = {}) {
        // 委派至 utils/deepseek-api.js 的共用刪除實作；此檔案於 manifest 中須排在其後載入
        return globalThis.DSSDeepSeekApi.performDeleteFetch(chatUuid, authToken, { keepalive });
    }

    /**
     * 以最多 MAX_RETRY_ATTEMPTS 次、間隔 RETRY_INTERVAL_MS 毫秒重試 deleteChatSession。
     * 全部失敗時顯示 toast 通知使用者。
     * 僅用於導航觸發的刪除（分頁仍開啟，不需要 keepalive）。
     * @param {string} chatUuid
     * @param {string} authToken
     * @returns {Promise<boolean>} 任一次嘗試成功回傳 true；全部失敗回傳 false
     */
    async function deleteChatSessionWithRetry(chatUuid, authToken) {
        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
            const isSuccess = await deleteChatSession(chatUuid, authToken, { keepalive: false });
            if (isSuccess) return true;
            if (attempt < MAX_RETRY_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
            }
        }
        showDeleteFailedToast();
        return false;
    }

    /**
     * 在頁面底部顯示刪除失敗的 toast 提示，6 秒後自動移除。樣式由 temporary-chat-toggle.css 提供。
     * 已存在時不重複建立。
     */
    function showDeleteFailedToast() {
        const existing = document.getElementById('dss-delete-failed-toast');
        if (existing) return;

        const toast = document.createElement('div');
        toast.id = 'dss-delete-failed-toast';
        toast.className = 'dss-temp-chat-delete-failed-toast';
        toast.textContent = dsI18n.t('tempChatDeleteFailedToast');

        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 6000);
    }

    return { deleteChatSession, deleteChatSessionWithRetry, showDeleteFailedToast };
})();

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatDeleteApi;
}
