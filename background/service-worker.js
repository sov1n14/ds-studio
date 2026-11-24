// 313 lines: service-worker entry — the pending-delete sweep, its exclusive queue-job chain (in-flight guard, nested grace jobs, closing broadcast, additions seen in flight) and the top-level listeners share module-scope state that both test harnesses load as this one classic script; splitting it out would need a new importScripts file the stubbed harness does not load
'use strict';

// 載入 StorageManager（classic service worker，依相依順序載入各儲存分包）
// 注意：service worker 不載入 utils/i18n.js，背景層不輸出任何在地化字串
importScripts(
    '../utils/logger.js',
    '../utils/storage-manager.keys.js',
    '../utils/storage-manager.rw.js',
    '../utils/storage-manager.sync.js',
    '../utils/storage-manager.sync.retry.js',
    '../utils/storage-manager.restore.js',
    '../utils/storage-manager.tombstone.js',
    '../utils/storage-manager.preset-merge.js',
    '../utils/storage-manager.preset-recency.js',
    '../utils/storage-manager.presets.js',
    '../utils/storage-manager.chatmap.diff.js',
    '../utils/storage-manager.chatmap.ops.js',
    '../utils/storage-manager.chatmap.js',
    '../utils/storage-manager.chatmap.client.js',
    '../utils/storage-manager.local.js',
    '../utils/storage-manager.init.js',
    '../utils/storage-manager.setters.js',
    '../utils/storage-manager.settings-read.js',
    '../utils/storage-manager.js',
    '../utils/deepseek-api.js',
    '../utils/temporary-chat-message-types.js',
    '../utils/temporary-chat-constants.js',
    '../utils/permission-request-errors.js',
    '../utils/permission-module.js',
    '../utils/clipboard-permission.js',
    '../utils/notification-permission.js',
    'pending-store.js',
    '../utils/message-constants.js',
    '../utils/runtime-message-errors.js',
    '../utils/chat-session-id.js',
    '../utils/editor-flush-channel.js',
    'service-worker-constants.js',
    'deepseek-tabs.js',
    'route-dispatch.js',
    'settings-routes.js',
    'pending-store-routes.js',
    'editor-window-routes.js',
    'notification-routes.js',
    'clipboard-routes.js',
    'chat-map-routes.js',
    'permission-intent-routes.js',
    'unload-grace.js'
);

// 依序註冊（頂層呼叫，確保 worker 重啟後仍存活）：設定訊息路由與變更廣播、待刪佇列訊息路由、編輯器視窗關閉訊息路由、桌面通知訊息路由、剪貼簿寫入路由、權限授予監聽器（完成 popup 因權限提示關閉而未完成的設定開啟）
DSSSettingsRoutes.install();
DSSPendingStoreRoutes.install();
DSSEditorWindowRoutes.install();
DSSNotificationRoutes.install();
DSSClipboardRoutes.install();
DSSPermissionIntentRoutes.install();

// 註冊 chat→preset 綁定表路由，並使本 worker 的 StorageManager 成為唯一寫入者（頂層呼叫，確保 worker 重啟後仍存活）
DSSChatMapRoutes.install({ storageManager: StorageManager });

// 註冊分頁卸載寬限路由：寬限期滿且無人認領時於補救重入防護下刪除，失敗走既有重試 alarm（頂層呼叫，確保 worker 重啟後仍存活）
DSSUnloadGrace.install({ runGuardedQueueJob, scheduleRetryAlarm });

// 指數退避上限（分鐘）
const BACKOFF_CAP_MINUTES = 30;
// onChanged 掃描重入防護（記憶體內）：自佇列工作開始設起，直到該工作的結尾廣播結束才清除。SW 終止時本旗標歸零；補救流程幂等，代價僅為最多多跑一次結果相同的補救
let isRemediationInFlight = false;
// 佇列工作鏈的尾端（成敗皆 resolve）：每個新工作接在其後，前一個工作連同結尾廣播結束後才開始
let queueTail = Promise.resolve();
// 在進行中工作內執行的巢狀工作（卸載寬限到期）：外層工作等它們全部結束才廣播並清除旗標。加入次數只增不減，外層比較廣播前後的次數，察覺等候或廣播期間加入（即使已結束）的巢狀工作；結算 promise 在所有已加入者結束（成敗皆可）時 resolve，尚無加入者時為 undefined
let nestedJoinCount = 0;
let nestedJobsSettled;
// 工作進行中收到、新增了待刪項目的同步變更次數（每個工作開始時歸零）：新增可能晚於工作的 alarm 判定與廣播讀取，結尾據此補排 alarm 並重新廣播
let queueAdditionsSeenInFlight = 0;

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
 * 僅在傳入空清單時清除 alarm（例如掃描後佇列已空）；remediatePendingDeletes 遇空佇列直接返回而不呼叫本函式，REMOVE_PENDING_DELETE 也不重排，故 alarm 可能仍存在，觸發一次無作業的掃描（讀取一次儲存，不送刪除請求、不寫入）。
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
 * 本機建立的項目適用 LEASE_TTL_MS；其他裝置建立或無擁有者的項目適用 FOREIGN_LEASE_TTL_MS（已釋放者仍立即可刪）。
 * 失敗項目永不丟棄，僅累加 attemptCount 並保留原始 lastActiveAt。
 * 寫回僅套用本輪差量（於 store 互斥鎖內重讀最新佇列），不以開頭快照覆寫，
 * 以免蓋掉掃描期間的續約或新增項目。
 */
async function remediatePendingDeletes() {
    const pending = await TemporaryChatPendingStore.getPendingDeletes();
    if (pending.length === 0) return;

    // 佇列非空 → 先確保 alarm 存在（冷啟動或無 token 時也需重試）
    await scheduleRetryAlarm(pending);

    const token = await TemporaryChatPendingStore.getLastAuthToken();
    if (!token) return; // 本機無 token → 保留佇列，交由具備 token 的裝置補救

    // 本機所有 DeepSeek 分頁正在檢視中的 uuid 集合（fail-open：查詢失敗時為空集合，不阻擋刪除）
    const localTabUuids = await DSSDeepSeekTabs.listShownChatUuids();

    // 每輪掃描自 storage.local 重讀本機裝置 ID，用以區分本機與外來項目
    const localDeviceId = await TemporaryChatPendingStore.getLocalDeviceId();
    const now = Date.now();
    const deletedUuids = [];
    const failedUuids = [];

    for (const item of pending) {
        // 觀察並記錄 lastActiveAt 變更時間點，取得本機觀察時間戳
        const lastSeenChange = await TemporaryChatPendingStore.recordLeaseObservation(item.chatUuid, item.lastActiveAt);
        // 租約未過期 → 本機仍活躍，跳過並原封保留
        const ttlMs = TemporaryChatPendingStore.resolveLeaseTtl(item, localDeviceId);
        if (!TemporaryChatPendingStore.isLeaseExpired(item, now, lastSeenChange, ttlMs)) continue;

        // 分頁防護：使用者正在檢視此對話 → 跳過刪除，代為續約（refreshLease 自行於鎖內寫入）
        if (localTabUuids.has(item.chatUuid)) {
            await TemporaryChatPendingStore.refreshLease(item.chatUuid);
            continue;
        }

        // 開頭快照可能已過時：送出刪除前於 store 互斥鏈內確認仍在佇列，已完成的移除一律尊重
        if (!(await TemporaryChatPendingStore.hasPendingDelete(item.chatUuid))) continue;

        const isOk = await DSSDeepSeekApi.performDeleteFetch(item.chatUuid, token);
        if (isOk) {
            // 刪除成功 → 清除觀察紀錄 key
            try { await chrome.storage.local.remove(DSS_TEMP_CHAT.DSS_LAST_SEEN_CHANGE_KEY_PREFIX + item.chatUuid); } catch {}
            deletedUuids.push(item.chatUuid);
            continue;
        }

        // 失敗 → 累加嘗試次數，保留原始 lastActiveAt，永不丟棄
        failedUuids.push(item.chatUuid);
    }

    const stillPending = await TemporaryChatPendingStore.applySweepResult({ deletedUuids, failedUuids });
    await scheduleRetryAlarm(stillPending);

    // 掃除孤兒 seen-change key：僅保留仍在佇列中的 UUID
    try {
        const pendingUuids = new Set(stillPending.map(e => e.chatUuid));
        const all = await chrome.storage.local.get(null);
        const orphans = Object.keys(all).filter(k => k.startsWith(DSS_TEMP_CHAT.DSS_LAST_SEEN_CHANGE_KEY_PREFIX) && !pendingUuids.has(k.slice(DSS_TEMP_CHAT.DSS_LAST_SEEN_CHANGE_KEY_PREFIX.length)));
        if (orphans.length > 0) await chrome.storage.local.remove(orphans);
    } catch (err) {
        console.error('[DSS] remediate sweep:', err);
    }
}

// 依目前儲存的佇列重排重試 alarm（佇列為空則清除）
async function scheduleRetryAlarmForStoredQueue() {
    await scheduleRetryAlarm(await TemporaryChatPendingStore.getPendingDeletes());
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
    // 釋放租約與掃描同在防護內：釋放寫入觸發的 onChanged 安全網因此略過，不與本次掃描並行
    runQueuedSweep(async () => {
        // 全新工作階段：先釋放仍在待刪佇列中的本機開啟對話租約，使其立即可刪
        const openUuids = await TemporaryChatPendingStore.getOpenUuids();
        const pending = await TemporaryChatPendingStore.getPendingDeletes();
        const pendingUuids = new Set(pending.map(i => i.chatUuid));
        for (const uuid of openUuids) {
            if (pendingUuids.has(uuid)) await TemporaryChatPendingStore.releaseLease(uuid);
        }
        await TemporaryChatPendingStore.clearOpenUuids(); // 全新工作階段，尚無活動分頁
        await remediatePendingDeletes();
    }, 'startup');
});

// 安裝／更新時建立定期重試 alarm、補救待刪佇列，並立即嘗試一次補推
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(SYNC_RETRY_ALARM_NAME, { periodInMinutes: SYNC_RETRY_PERIOD_MINUTES });
    retryParkedSync();
    runQueuedSweep(remediatePendingDeletes, 'install'); // 重建 alarm 並處理待刪佇列（Chrome 重載/更新會清除所有 alarm）
});

// 監聯來自 content script 的排程要求：僅排程重試 alarm，不進行即時刪除
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== DSS_TEMP_CHAT.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE) return false;
    // 讀取佇列以計算正確退避週期
    scheduleRetryAlarmForStoredQueue();
    return false;
});

// 單一 alarm 監聽器：依 alarm 名稱分派雲端同步補推與待刪佇列補救
chrome.alarms.onAlarm.addListener((alarm) => {
    switch (alarm.name) {
        case SYNC_RETRY_ALARM_NAME:
            retryParkedSync();
            return;
        case RETRY_ALARM_NAME:
            runQueuedSweep(remediatePendingDeletes, 'retry alarm');
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
        Promise.resolve(chrome.tabs.sendMessage(tab.id, { type: DSS_TEMP_CHAT.DSS_MSG_PENDING_UUIDS_CHANGED, uuids }))
            .catch(() => {}); // 無 content script 的分頁會 reject，靜默忽略
    }
}

// 在補救重入防護下獨佔執行一個佇列工作：旗標自工作開始設起，等巢狀工作結束並廣播給各分頁側邊欄後才清除，期間佇列寫入觸發的掃描一律略過。等候或廣播期間又有巢狀工作加入（即使已結束）時，再等候並廣播一次，確保清除旗標前最後一次廣播涵蓋所有佇列寫入；工作期間收到新增待刪項目的同步變更時，廣播前依儲存的佇列補排重試 alarm，廣播讀取之後才收到者再補排並廣播一次，新增的項目因此不會在無 alarm 的情況下滯留佇列；每輪都含廣播的 storage 讀取，不會只靠 microtask 空轉。工作失敗也照樣廣播，讓各分頁的隱藏集合對齊佇列的實際內容，錯誤再交還呼叫端；廣播本身失敗只記錄，不蓋掉工作結果。
async function runExclusiveQueueJob(job) {
    isRemediationInFlight = true;
    queueAdditionsSeenInFlight = 0;
    try {
        await job();
    } finally {
        let seenJoinCount;
        let seenAdditionCount;
        do {
            seenJoinCount = nestedJoinCount;
            await nestedJobsSettled;
            seenAdditionCount = queueAdditionsSeenInFlight;
            if (seenAdditionCount > 0) await scheduleRetryAlarmForStoredQueue().catch((err) => console.error('[DSS] in-flight addition retry alarm:', err));
            await broadcastPendingUuids().catch((err) => console.error('[DSS] broadcastPendingUuids:', err));
        } while (nestedJoinCount > seenJoinCount || queueAdditionsSeenInFlight > seenAdditionCount);
        isRemediationInFlight = false;
    }
}

// 將佇列工作接到工作鏈尾端：依呼叫順序逐一執行、絕不並行；等待靠 promise 鏈而非輪詢旗標，旗標卡住時不會空轉
function enqueueQueueJob(job) {
    const run = queueTail.then(() => runExclusiveQueueJob(job));
    queueTail = run.catch(() => {});
    return run;
}

// 卸載寬限到期的單筆處理（DSSUnloadGrace 注入）：無工作進行中時接到工作鏈尾端；另一工作進行中時立即在其內執行、不等候，外層工作等它結束後才廣播並清除旗標，因此它不會與外層之後排隊的工作並行，其佇列寫入也包含在外層的廣播內
async function runGuardedQueueJob(job) {
    if (!isRemediationInFlight) return enqueueQueueJob(job);
    const run = Promise.resolve().then(job);
    nestedJobsSettled = Promise.all([nestedJobsSettled, run.catch(() => {})]);
    nestedJoinCount += 1;
    return run;
}

// 佇列補救（啟動、安裝更新、重試 alarm、同步變更）：接到工作鏈尾端，掃描依序進行、不並行且請求不遺失；錯誤以觸發來源記錄，不成為未處理的 rejection
async function runQueuedSweep(job, context) {
    try {
        await enqueueQueueJob(job);
    } catch (err) {
        console.error(`[DSS] ${context} remediation:`, err);
    }
}

// 純查詢：此次待刪佇列變更的新值是否含有舊值沒有的項目；首次寫入沒有舊值（new Set(undefined) 為空集合），佇列 key 被移除時沒有新值、視為無新增
function hasAddedPendingEntry({ oldValue, newValue }) {
    const oldUuids = new Set(Array.isArray(oldValue) ? oldValue.map((item) => item.chatUuid) : undefined);
    return Array.isArray(newValue) && newValue.some((item) => !oldUuids.has(item.chatUuid));
}

// 同步變更安全網：其他裝置寫入待刪佇列時，本機也嘗試補救。佇列工作連同其結尾廣播進行中則不另起掃描（工作自身的寫入只移除或更新項目，另起掃描會循環）；其中新增項目的變更記下，交由該工作收尾補排 alarm 並重新廣播
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !(DSS_TEMP_CHAT.DSS_PENDING_DELETES_SYNC_KEY in changes)) return;
    if (!isRemediationInFlight) {
        runQueuedSweep(remediatePendingDeletes, 'sync change');
        return;
    }
    if (hasAddedPendingEntry(changes[DSS_TEMP_CHAT.DSS_PENDING_DELETES_SYNC_KEY])) queueAdditionsSeenInFlight += 1;
});
