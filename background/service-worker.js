'use strict';

// 待刪除對話的 storage 鍵名
const PENDING_DELETES_KEY = 'dss-pending-deletes';
// 重試 alarm 名稱
const RETRY_ALARM_NAME = 'dss-delete-retry';
// 最大嘗試次數（含首次）
const MAX_ATTEMPTS = 3;
// 重試間隔（分鐘），0.5 = 30 秒
const RETRY_DELAY_MINUTES = 0.5;

/**
 * 對 DeepSeek API 發送刪除對話請求。
 * 使用 keepalive: true 確保在分頁關閉情境下請求仍可完成。
 * @param {string} chatUuid - 要刪除的對話 UUID
 * @param {string} authToken - Bearer 授權 Token
 * @returns {Promise<boolean>} 成功回傳 true，任何失敗回傳 false
 */
async function performDeleteFetch(chatUuid, authToken) {
    try {
        const response = await fetch('https://chat.deepseek.com/api/v0/chat_session/delete', {
            method: 'POST',
            keepalive: true,
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
 * 從 chrome.storage.local 讀取待重試的刪除清單。
 * @returns {Promise<Array>} 待刪除項目陣列
 */
async function getPendingDeletes() {
    const result = await chrome.storage.local.get([PENDING_DELETES_KEY]);
    return result[PENDING_DELETES_KEY] || [];
}

/**
 * 將待重試的刪除清單寫入 chrome.storage.local。
 * @param {Array} items - 待刪除項目陣列
 */
async function savePendingDeletes(items) {
    await chrome.storage.local.set({ [PENDING_DELETES_KEY]: items });
}

/**
 * 建立（或重建）重試 alarm，確保同一時間只有一個 alarm 存在。
 */
async function scheduleRetryAlarm() {
    await chrome.alarms.clear(RETRY_ALARM_NAME);
    chrome.alarms.create(RETRY_ALARM_NAME, { delayInMinutes: RETRY_DELAY_MINUTES });
}

// 監聽來自各情境轉發的診斷記錄（__dsSyncLog），在 Service Worker console 統一輸出
// 獨立 listener，與現有刪除訊息處理完全隔離
chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.__dsSyncLog !== true) return false;
    // 根據層級選擇 console 方法，並附加來源標籤
    const printer = message.level === 'warn' ? console.warn : console.log;
    printer('[DS-Sync][' + message.source + ']', message.event, message.data);
    // 同步處理完成，不保持訊息通道開啟
    return false;
});

// 監聽來自 content script 的刪除請求
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'DSS_DELETE_TEMP_CHAT') return false;
    if (!msg.chatUuid || !msg.authToken) return false;

    (async () => {
        const isSuccess = await performDeleteFetch(msg.chatUuid, msg.authToken);
        if (!isSuccess) {
            // 首次失敗：加入待重試清單並排程 alarm
            const pending = await getPendingDeletes();
            pending.push({ chatUuid: msg.chatUuid, authToken: msg.authToken, attemptCount: 1 });
            await savePendingDeletes(pending);
            await scheduleRetryAlarm();
        }
        sendResponse({ success: isSuccess });
    })();

    // 回傳 true 保持訊息通道開啟供非同步 sendResponse 使用
    return true;
});

// 監聽 alarm 觸發以執行重試邏輯
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== RETRY_ALARM_NAME) return;

    (async () => {
        const pending = await getPendingDeletes();
        if (pending.length === 0) return;

        const stillPending = [];
        for (const item of pending) {
            const isSuccess = await performDeleteFetch(item.chatUuid, item.authToken);
            if (!isSuccess && item.attemptCount < MAX_ATTEMPTS) {
                // 尚未達到上限：更新嘗試次數並保留至下一輪
                stillPending.push({ ...item, attemptCount: item.attemptCount + 1 });
            }
            // isSuccess === true：刪除成功，不再加入清單
            // attemptCount >= MAX_ATTEMPTS：已達上限，靜默放棄（分頁已關閉，無法顯示提示）
        }

        await savePendingDeletes(stillPending);
        if (stillPending.length > 0) {
            await scheduleRetryAlarm();
        }
    })();
});
