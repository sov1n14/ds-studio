'use strict';

// 載入 StorageManager（classic service worker，依相依順序載入各儲存分包）
// 注意：不載入 utils/i18n.js 與 utils/logger.js，避免觸碰 window / 選用性 __DS_Logger 之外的載入期副作用
importScripts(
    '../utils/storage-manager.chunking.js',
    '../utils/storage-manager.lock.js',
    '../utils/storage-manager.sync.js',
    '../utils/storage-manager.presets.js',
    '../utils/storage-manager.chatmap.js',
    '../utils/storage-manager.local.js',
    '../utils/storage-manager.init.js',
    '../utils/storage-manager.syncnow.js',
    '../utils/storage-manager.js',
    '../content/temporary-chat-pending-store.js'
);

// 重試 alarm 名稱
const RETRY_ALARM_NAME = 'dss-delete-retry';
// 最大嘗試次數（含首次）
const MAX_ATTEMPTS = 3;
// 重試間隔（分鐘），0.5 = 30 秒
const RETRY_DELAY_MINUTES = 0.5;
// 舊版本機佇列鍵（僅供一次性清理）
const OLD_PENDING_LOCAL_KEY = 'dss-pending-deletes';
// 同 content/temporary-chat-constants.js
const SCHEDULE_DELETE_RETRY = 'DSS_SCHEDULE_DELETE_RETRY';
// onChanged 掃描重入防護（記憶體內）
let _remediationInFlight = false;

// 雲端同步重試 alarm 名稱
const SYNC_RETRY_ALARM_NAME = 'dss-sync-retry';
// 雲端同步重試週期（分鐘）
const SYNC_RETRY_PERIOD_MINUTES = 5;

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
 * 建立（或重建）重試 alarm，確保同一時間只有一個 alarm 存在。
 */
async function scheduleRetryAlarm() {
    await chrome.alarms.clear(RETRY_ALARM_NAME);
    chrome.alarms.create(RETRY_ALARM_NAME, { delayInMinutes: RETRY_DELAY_MINUTES });
}

/**
 * 補救待刪佇列：讀取 sync 佇列，以本機 token 逐筆刪除，僅確認成功才移除。
 * @param {{excludeUuids?: string[]}} [opts] excludeUuids 內的 UUID 一律跳過（本機仍開啟的對話）
 */
async function remediatePendingDeletes({ excludeUuids = [] } = {}) {
    const pending = await TemporaryChatPendingStore.getPendingDeletes();
    if (pending.length === 0) return;

    const token = await TemporaryChatPendingStore.getLastAuthToken();
    if (!token) return; // 本機無 token → 保留佇列，交由具備 token 的裝置補救

    const exclude = new Set(excludeUuids);
    const stillPending = [];
    let hasChanged = false;

    for (const item of pending) {
        if (exclude.has(item.chatUuid)) { stillPending.push(item); continue; }

        const isOk = await performDeleteFetch(item.chatUuid, token);
        if (isOk) { hasChanged = true; continue; }           // 確認成功 → 移除

        const nextCount = (item.attemptCount ?? 0) + 1;
        if (nextCount < MAX_ATTEMPTS) {
            stillPending.push({ chatUuid: item.chatUuid, attemptCount: nextCount });
        }
        hasChanged = true; // 失敗（累加或達上限丟棄）皆改變了佇列
    }

    if (hasChanged) await TemporaryChatPendingStore.savePendingDeletes(stillPending);
    const hasRetryable = stillPending.some(i => !exclude.has(i.chatUuid));
    if (hasRetryable) await scheduleRetryAlarm();
}

/**
 * 嘗試將停駐於 dsLocalAuth 的預設集寫入重新推送至雲端。
 * 屬於 best-effort 操作，任何錯誤皆靜默吞掉，不影響 Service Worker 存活。
 */
async function retryParkedSync() {
    try {
        if (await StorageManager.isSyncedWithCloud()) return;
        await StorageManager.retrySync();
    } catch {
        // best-effort：靜默吞掉錯誤
    }
}

// Service Worker 啟動時嘗試補推先前停駐的同步內容，並補救待刪佇列
chrome.runtime.onStartup.addListener(() => {
    retryParkedSync(); // 既有：cloud-preset 補推
    (async () => {
        await TemporaryChatPendingStore.clearOpenUuids();    // 全新工作階段，尚無活動分頁
        await remediatePendingDeletes({ excludeUuids: [] });
    })();
});

// 安裝／更新時建立定期重試 alarm，並立即嘗試一次補推；同時清理舊版本機佇列
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(SYNC_RETRY_ALARM_NAME, { periodInMinutes: SYNC_RETRY_PERIOD_MINUTES });
    retryParkedSync();
    chrome.storage.local.remove(OLD_PENDING_LOCAL_KEY);
});

// 監聽雲端同步重試 alarm，與現有刪除重試 alarm 監聽器互不干擾
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_RETRY_ALARM_NAME) retryParkedSync();
});

// 監聽來自 content script 的排程要求：僅排程重試 alarm，不進行即時刪除
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== SCHEDULE_DELETE_RETRY) return false;
    scheduleRetryAlarm();
    return false;
});

// 監聽 alarm 觸發以執行重試邏輯
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== RETRY_ALARM_NAME) return;
    (async () => {
        const openUuids = await TemporaryChatPendingStore.getOpenUuids();
        await remediatePendingDeletes({ excludeUuids: openUuids });
    })();
});

// 同步變更安全網：其他裝置寫入待刪佇列時，本機也嘗試補救
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (!('dss-pending-deletes-sync' in changes)) return; // 同 constants：DSS_PENDING_DELETES_SYNC_KEY
    if (_remediationInFlight) return;                       // 重入防護
    (async () => {
        _remediationInFlight = true;
        try {
            const openUuids = await TemporaryChatPendingStore.getOpenUuids();
            await remediatePendingDeletes({ excludeUuids: openUuids });
        } finally {
            _remediationInFlight = false;
        }
    })();
});
