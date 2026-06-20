/**
 * DS studio — Temporary Chat Delete API
 * 單一職責：封裝刪除 fetch、重試邏輯與失敗 toast 通知。
 * auth token 與 UUID 皆以參數傳入，此模組無可變狀態。
 */
const TemporaryChatDeleteApi = (() => {
    'use strict';

    const DELETE_URL = 'https://chat.deepseek.com/api/v0/chat_session/delete';
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
        if (!authToken || !chatUuid) return false;
        try {
            const response = await fetch(DELETE_URL, {
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

    /**
     * 以最多 MAX_RETRY_ATTEMPTS 次、間隔 RETRY_INTERVAL_MS 毫秒重試 deleteChatSession。
     * 全部失敗時顯示 toast 通知使用者。
     * 僅用於導航觸發的刪除（分頁仍開啟，不需要 keepalive）。
     * @param {string} chatUuid
     * @param {string} authToken
     * @returns {Promise<void>}
     */
    async function deleteChatSessionWithRetry(chatUuid, authToken) {
        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
            const isSuccess = await deleteChatSession(chatUuid, authToken, { keepalive: false });
            if (isSuccess) return;
            if (attempt < MAX_RETRY_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
            }
        }
        showDeleteFailedToast();
    }

    /**
     * 在頁面底部顯示刪除失敗的 toast 提示，6 秒後自動移除。
     * 已存在時不重複建立。
     */
    function showDeleteFailedToast() {
        const existing = document.getElementById('dss-delete-failed-toast');
        if (existing) return;

        const toast = document.createElement('div');
        toast.id = 'dss-delete-failed-toast';
        toast.textContent = '臨時對話刪除失敗，請確認網路連線。';
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1e2022',
            color: '#f9fafb',
            fontSize: '14px',
            fontWeight: '500',
            padding: '10px 20px',
            borderRadius: '8px',
            zIndex: '2147483647',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
        });

        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 6000);
    }

    return { deleteChatSession, deleteChatSessionWithRetry, showDeleteFailedToast };
})();

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatDeleteApi;
}
