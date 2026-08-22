'use strict';

// 載入 StorageManager（classic service worker，依相依順序載入各儲存分包）
// 注意：service worker 不載入 utils/i18n.js，背景層不輸出任何在地化字串
importScripts(
    '../utils/logger.js',
    '../utils/storage-manager.chunk-lock.js',
    '../utils/storage-manager.sync.js',
    '../utils/storage-manager.presets.js',
    '../utils/storage-manager.chatmap.js',
    '../utils/storage-manager.local.js',
    '../utils/storage-manager.init.js',
    '../utils/storage-manager.setters.js',
    '../utils/storage-manager.settings-read.js',
    '../utils/storage-manager.js',
    '../utils/deepseek-api.js',
    '../content/temporary-chat-constants.js',
    '../content/temporary-chat-pending-store.js',
    '../utils/settings-message-constants.js',
    '../utils/editor-window-constants.js',
    'settings-routes.js',
    'pending-store-routes.js',
    'editor-window-routes.js'
);

// 註冊設定訊息路由與變更廣播（頂層呼叫，確保 worker 重啟後仍存活）
DSSSettingsRoutes.install();

// 註冊待刪佇列訊息路由（頂層呼叫，確保 worker 重啟後仍存活）
DSSPendingStoreRoutes.install();

// 註冊編輯器視窗關閉訊息路由（頂層呼叫，確保 worker 重啟後仍存活）
DSSEditorWindowRoutes.install();

// 重試 alarm 名稱
const RETRY_ALARM_NAME = 'dss-delete-retry';
// 最大嘗試次數（含首次）
const MAX_ATTEMPTS = 3;
// 重試間隔（分鐘），0.5 = 30 秒
const RETRY_DELAY_MINUTES = 0.5;
// onChanged 掃描重入防護（記憶體內）
// SW 終止時本旗標歸零；補救流程幂等，代價僅為最多多跑一次結果相同的補救
let _remediationInFlight = false;

// 雲端同步重試 alarm 名稱
const SYNC_RETRY_ALARM_NAME = 'dss-sync-retry';
// 雲端同步重試週期（分鐘）
const SYNC_RETRY_PERIOD_MINUTES = 5;

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

        const isOk = await DSSDeepSeekApi.performDeleteFetch(item.chatUuid, token);
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

// 安裝／更新時建立定期重試 alarm，並立即嘗試一次補推
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(SYNC_RETRY_ALARM_NAME, { periodInMinutes: SYNC_RETRY_PERIOD_MINUTES });
    retryParkedSync();
});

// 監聽來自 content script 的排程要求：僅排程重試 alarm，不進行即時刪除
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE) return false;
    scheduleRetryAlarm();
    return false;
});

// 單一 alarm 監聽器：依 alarm 名稱分派雲端同步補推與待刪佇列補救
chrome.alarms.onAlarm.addListener((alarm) => {
    switch (alarm.name) {
        case SYNC_RETRY_ALARM_NAME:
            retryParkedSync();
            return;
        case RETRY_ALARM_NAME:
            (async () => {
                const openUuids = await TemporaryChatPendingStore.getOpenUuids();
                await remediatePendingDeletes({ excludeUuids: openUuids });
            })();
            return;
    }
});

// 同步變更安全網：其他裝置寫入待刪佇列時，本機也嘗試補救
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (!(DSS_PENDING_DELETES_SYNC_KEY in changes)) return;
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
