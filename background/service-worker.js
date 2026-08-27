'use strict';

// 載入 StorageManager（classic service worker，依相依順序載入各儲存分包）
// 注意：service worker 不載入 utils/i18n.js，背景層不輸出任何在地化字串
importScripts(
    '../utils/logger.js',
    '../utils/storage-manager.keys.js',
    '../utils/storage-manager.chunk-lock.js',
    '../utils/storage-manager.rw.js',
    '../utils/storage-manager.sync.js',
    '../utils/storage-manager.tombstone.js',
    '../utils/storage-manager.preset-merge.js',
    '../utils/storage-manager.preset-recency.js',
    '../utils/storage-manager.presets.js',
    '../utils/storage-manager.chatmap.diff.js',
    '../utils/storage-manager.chatmap.js',
    '../utils/storage-manager.local.js',
    '../utils/storage-manager.init.js',
    '../utils/storage-manager.setters.js',
    '../utils/storage-manager.settings-read.js',
    '../utils/storage-manager.js',
    '../utils/deepseek-api.js',
    '../utils/temporary-chat-constants.js',
    'pending-store.js',
    '../utils/settings-message-constants.js',
    '../utils/editor-window-constants.js',
    'service-worker-constants.js',
    '../utils/url-constants.js',
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

// 指數退避上限（分鐘）
const BACKOFF_CAP_MINUTES = 30;
// onChanged 掃描重入防護（記憶體內）
// SW 終止時本旗標歸零；補救流程幂等，代價僅為最多多跑一次結果相同的補救
let isRemediationInFlight = false;

// 雲端同步重試週期（分鐘）
const SYNC_RETRY_PERIOD_MINUTES = 5;

/**
 * 計算指數退避延遲（分鐘）：min(0.5 * 2^attemptCount, 30)
 */
function computeBackoffMinutes(attemptCount) {
    return Math.min(0.5 * Math.pow(2, attemptCount), BACKOFF_CAP_MINUTES);
}

/**
 * 建立週期性重試 alarm，週期為佇列中最短退避延遲。
 * 佇列為空時清除 alarm。
 */
async function scheduleRetryAlarm(pendingItems) {
    if (!pendingItems || pendingItems.length === 0) {
        await chrome.alarms.clear(RETRY_ALARM_NAME);
        return;
    }
    const shortestBackoff = Math.min(
        ...pendingItems.map((item) => computeBackoffMinutes(item.attemptCount ?? 0))
    );
    await chrome.alarms.clear(RETRY_ALARM_NAME);
    chrome.alarms.create(RETRY_ALARM_NAME, { periodInMinutes: shortestBackoff });
}

/**
 * 補救待刪佇列：讀取 sync 佇列，以本機 token 逐筆刪除，僅確認成功才移除。
 * 租約未過期的項目（本機仍活躍的對話）一律跳過並原封保留於佇列。
 * 失敗項目永不丟棄，僅累加 attemptCount 並保留原始 lastActiveAt。
 */
async function remediatePendingDeletes() {
    const pending = await TemporaryChatPendingStore.getPendingDeletes();
    if (pending.length === 0) return;

    const token = await TemporaryChatPendingStore.getLastAuthToken();
    if (!token) return; // 本機無 token → 保留佇列，交由具備 token 的裝置補救

    // 查詢本機所有 DeepSeek 分頁，建立正在檢視中的 uuid 集合（fail-open：查詢失敗時不阻擋刪除）
    let localTabUuids = new Set();
    try {
        const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
        for (const tab of tabs) {
            const uuid = tab.url?.match(/\/a\/chat\/s\/([a-f0-9-]+)/)?.[1] ?? null;
            if (uuid) localTabUuids.add(uuid);
        }
    } catch { /* fail-open：tabs.query 失敗時以空集合繼續 */ }

    const now = Date.now();
    const stillPending = [];
    let hasChanged = false;
    let hasTabGuarded = false;

    for (const item of pending) {
        // 觀察並記錄 lastActiveAt 變更時間點，取得本機觀察時間戳
        const lastSeenChange = await TemporaryChatPendingStore.recordLeaseObservation(item.chatUuid, item.lastActiveAt);
        // 租約未過期 → 本機仍活躍，跳過並原封保留
        if (!TemporaryChatPendingStore.isLeaseExpired(item, now, lastSeenChange)) {
            stillPending.push(item);
            continue;
        }

        // 分頁防護：使用者正在檢視此對話 → 跳過刪除，代為續約，原封保留
        if (localTabUuids.has(item.chatUuid)) {
            await TemporaryChatPendingStore.refreshLease(item.chatUuid);
            stillPending.push(item);
            hasTabGuarded = true;
            continue;
        }

        const isOk = await DSSDeepSeekApi.performDeleteFetch(item.chatUuid, token);
        if (isOk) {
            // 刪除成功 → 清除觀察紀錄 key
            try { await chrome.storage.local.remove(DSS_LAST_SEEN_CHANGE_KEY_PREFIX + item.chatUuid); } catch {}
            hasChanged = true;
            continue;
        }

        // 失敗 → 累加嘗試次數，保留原始 lastActiveAt，永不丟棄
        const nextCount = (item.attemptCount ?? 0) + 1;
        stillPending.push({ ...item, attemptCount: nextCount });
        hasChanged = true;
    }

    if (hasChanged || hasTabGuarded) await TemporaryChatPendingStore.savePendingDeletes(stillPending);
    await scheduleRetryAlarm(stillPending);
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
        // 全新工作階段：先釋放仍在待刪佇列中的本機開啟對話租約，使其立即可刪
        const openUuids = await TemporaryChatPendingStore.getOpenUuids();
        const pending = await TemporaryChatPendingStore.getPendingDeletes();
        const pendingUuids = new Set(pending.map(i => i.chatUuid));
        for (const uuid of openUuids) {
            if (pendingUuids.has(uuid)) await TemporaryChatPendingStore.releaseLease(uuid);
        }
        await TemporaryChatPendingStore.clearOpenUuids(); // 全新工作階段，尚無活動分頁
        await remediatePendingDeletes();
    })();
});

// 安裝／更新時建立定期重試 alarm，並立即嘗試一次補推
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(SYNC_RETRY_ALARM_NAME, { periodInMinutes: SYNC_RETRY_PERIOD_MINUTES });
    retryParkedSync();
});

// 監聯來自 content script 的排程要求：僅排程重試 alarm，不進行即時刪除
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE) return false;
    // 讀取佇列以計算正確退避週期
    TemporaryChatPendingStore.getPendingDeletes().then((items) => scheduleRetryAlarm(items));
    return false;
});

// 單一 alarm 監聽器：依 alarm 名稱分派雲端同步補推與待刪佇列補救
chrome.alarms.onAlarm.addListener((alarm) => {
    switch (alarm.name) {
        case SYNC_RETRY_ALARM_NAME:
            retryParkedSync();
            return;
        case RETRY_ALARM_NAME:
            remediatePendingDeletes();
            return;
    }
});

// 將目前待刪佇列 uuid 廣播給所有 DeepSeek 分頁，讓側邊欄同步隱藏／取消隱藏；未安裝 content script 的分頁 sendMessage 會 reject，逐一 catch 靜默忽略。
// 不新增 tabs 權限、不帶 url 過濾：無過濾查詢加上 best-effort 送訊在既有 host 權限下即可運作。
async function broadcastPendingUuids() {
    const pending = await TemporaryChatPendingStore.getPendingDeletes();
    const uuids = pending.map((item) => item.chatUuid);
    let tabs;
    try {
        tabs = await chrome.tabs.query({});
    } catch (err) {
        console.error('[DSS] broadcastPendingUuids query:', err);
        return;
    }
    if (!Array.isArray(tabs)) return; // 查詢結果非陣列（環境無 tabs API）時視為無分頁可送
    for (const tab of tabs) {
        if (typeof tab.id !== 'number') continue;
        Promise.resolve(chrome.tabs.sendMessage(tab.id, { type: DSS_MSG_PENDING_UUIDS_CHANGED, uuids }))
            .catch(() => {}); // 無 content script 的分頁會 reject，靜默忽略
    }
}

// 同步變更安全網：其他裝置寫入待刪佇列時，本機也嘗試補救
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (!(DSS_PENDING_DELETES_SYNC_KEY in changes)) return;
    if (isRemediationInFlight) return;                       // 重入防護
    (async () => {
        isRemediationInFlight = true;
        try {
            await remediatePendingDeletes();
        } finally {
            isRemediationInFlight = false;
        }
        await broadcastPendingUuids(); // 佇列變更後同步通知各分頁側邊欄
    })();
});
