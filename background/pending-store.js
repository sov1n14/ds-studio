/**
 * DS studio — 臨時對話待刪佇列與裝置本機狀態存取（background/pending-store.js）
 * 職責：管理 chrome.storage.sync 的跨裝置待刪佇列，以及 chrome.storage.local 的
 * 本機開啟中 UUID 集合與最近有效 bearer token 快取。
 * 僅由 background service-worker 以 importScripts 載入；常數由
 * utils/temporary-chat-constants.js 先行掛載至 globalThis，本檔直接讀取。
 */

// 常數來源：utils/temporary-chat-constants.js（載入順序早於本檔，已掛載至 globalThis）
const DSS_PENDING_STORE_SYNC_KEY = globalThis.DSS_PENDING_DELETES_SYNC_KEY;
const DSS_PENDING_STORE_TOKEN_KEY = globalThis.DSS_LAST_AUTH_TOKEN_KEY;
// 舊版共用陣列 key —— 僅允許讀取（相容升級中裝置尚未轉移的資料），永不再寫入
const DSS_LEGACY_OPEN_UUIDS_ARRAY_KEY = globalThis.DSS_OPEN_TEMP_UUIDS_KEY;
// 新版：每個 uuid 各自一把獨立 key，任何呼叫端都不會讀改寫到其他 uuid 擁有的資料，
// 因此不再需要跨 context 鎖 —— 沒有共用結構就沒有讀改寫競態可言。
const DSS_OPEN_UUID_KEY_PREFIX = 'dss-open-temp-uuid:';
const DSS_LEASE_TTL_MS = globalThis.LEASE_TTL_MS;
const DSS_HEARTBEAT_INTERVAL_MS = globalThis.HEARTBEAT_INTERVAL_MS;
const DSS_SEEN_CHANGE_KEY_PREFIX = globalThis.DSS_LAST_SEEN_CHANGE_KEY_PREFIX;

// 讀改寫互斥鏈：所有對同步佇列的讀改寫依序排隊，避免並行覆蓋彼此結果。
// 單一 job 拒絕不污染後續 job（鏈以 catch 收斂），呼叫端仍取得原始結果 Promise。
let pendingWriteChain = Promise.resolve();
function runExclusive(job) {
    const result = pendingWriteChain.then(job);
    pendingWriteChain = result.catch(() => {});
    return result;
}

function logWriteFailure(context, error) {
    // 儲存寫入失敗時以 error 等級記錄，絕不拋出以免中斷呼叫端流程
    console.error('[DSS]', 'pending-store:write-fail', context, error);
}

// 記憶體快取：追蹤每個 uuid 上次觀察到的 lastActiveAt 值
const _lastActiveAtCache = new Map();

const TemporaryChatPendingStore = (() => {
    async function getPendingDeletes() {
        try {
            const result = await chrome.storage.sync.get(DSS_PENDING_STORE_SYNC_KEY);
            const items = result?.[DSS_PENDING_STORE_SYNC_KEY];
            return Array.isArray(items) ? items : [];
        } catch (error) {
            return [];
        }
    }

    async function savePendingDeletes(items) {
        try {
            await chrome.storage.sync.set({ [DSS_PENDING_STORE_SYNC_KEY]: items });
        } catch (error) {
            logWriteFailure('savePendingDeletes', error);
        }
    }

    async function addPendingDelete(chatUuid) {
        if (!chatUuid) return;
        return runExclusive(async () => {
            const queue = await getPendingDeletes();
            const hasExisting = queue.some((entry) => entry.chatUuid === chatUuid);
            if (hasExisting) return;
            queue.push({ chatUuid, attemptCount: 0, lastActiveAt: Date.now() });
            await savePendingDeletes(queue);
        });
    }

    async function removePendingDelete(chatUuid) {
        if (!chatUuid) return;
        return runExclusive(async () => {
            const queue = await getPendingDeletes();
            const filtered = queue.filter((entry) => entry.chatUuid !== chatUuid);
            if (filtered.length === queue.length) return;
            await savePendingDeletes(filtered);
            _lastActiveAtCache.delete(chatUuid);
            await chrome.storage.local.remove(DSS_SEEN_CHANGE_KEY_PREFIX + chatUuid);
        });
    }

    // 續約：將目標 entry 的 lastActiveAt 更新為現在；未知 uuid 不寫入
    // 髒檢查：lastActiveAt 距今未超過 HEARTBEAT_INTERVAL_MS 則跳過寫入，避免重複更新
    async function refreshLease(chatUuid) {
        if (!chatUuid) return;
        return runExclusive(async () => {
            const queue = await getPendingDeletes();
            const entry = queue.find((item) => item.chatUuid === chatUuid);
            if (!entry) return;
            const now = Date.now();
            if (now - entry.lastActiveAt < DSS_HEARTBEAT_INTERVAL_MS) return;
            entry.lastActiveAt = now;
            await savePendingDeletes(queue);
        });
    }

    // 釋放：將目標 entry 的 lastActiveAt 歸零（保留於佇列）；未知 uuid 不寫入
    async function releaseLease(chatUuid) {
        if (!chatUuid) return;
        return runExclusive(async () => {
            const queue = await getPendingDeletes();
            const entry = queue.find((item) => item.chatUuid === chatUuid);
            if (!entry) return;
            entry.lastActiveAt = 0;
            await savePendingDeletes(queue);
        });
    }

    // 純函式判定：優先以 lastSeenChange 判斷過期；缺失或非有限數時一律視為過期
    function isLeaseExpired(entry, now, lastSeenChange) {
        if (lastSeenChange === undefined || lastSeenChange === null || !Number.isFinite(lastSeenChange)) return true;
        return now - lastSeenChange > DSS_LEASE_TTL_MS;
    }

    // 觀察並記錄 lastActiveAt 變更時間點；回傳本機觀察到的最後變更時間戳
    async function recordLeaseObservation(chatUuid, currentLastActiveAt) {
        const storageKey = DSS_SEEN_CHANGE_KEY_PREFIX + chatUuid;
        const cached = _lastActiveAtCache.get(chatUuid);
        if (cached === currentLastActiveAt) {
            const result = await chrome.storage.local.get(storageKey);
            return result?.[storageKey] ?? undefined;
        }
        const observedAt = Date.now();
        _lastActiveAtCache.set(chatUuid, currentLastActiveAt);
        await chrome.storage.local.set({ [storageKey]: observedAt });
        return observedAt;
    }

    // 讀取舊版共用陣列 key（唯讀，永不寫回）
    async function getLegacyOpenUuids() {
        try {
            const result = await chrome.storage.local.get(DSS_LEGACY_OPEN_UUIDS_ARRAY_KEY);
            const uuids = result?.[DSS_LEGACY_OPEN_UUIDS_ARRAY_KEY];
            return Array.isArray(uuids) ? uuids : [];
        } catch (error) {
            return [];
        }
    }

    async function getOpenUuids() {
        let prefixedUuids = [];
        try {
            const allLocal = await chrome.storage.local.get(null);
            prefixedUuids = Object.keys(allLocal)
                .filter((key) => key.startsWith(DSS_OPEN_UUID_KEY_PREFIX))
                .map((key) => key.slice(DSS_OPEN_UUID_KEY_PREFIX.length));
        } catch (error) {
            prefixedUuids = [];
        }
        const legacyUuids = await getLegacyOpenUuids();
        // 聯集去重：升級中裝置可能同時存在舊陣列與新 key
        return Array.from(new Set([...prefixedUuids, ...legacyUuids]));
    }

    async function addOpenUuid(chatUuid) {
        if (!chatUuid) return;
        const key = DSS_OPEN_UUID_KEY_PREFIX + chatUuid;
        try {
            await chrome.storage.local.set({ [key]: true });
        } catch (error) {
            logWriteFailure('addOpenUuid', error);
        }
    }

    async function removeOpenUuid(chatUuid) {
        if (!chatUuid) return;
        const key = DSS_OPEN_UUID_KEY_PREFIX + chatUuid;
        try {
            await chrome.storage.local.remove(key);
        } catch (error) {
            logWriteFailure('removeOpenUuid', error);
        }
    }

    async function clearOpenUuids() {
        try {
            const allLocal = await chrome.storage.local.get(null);
            const prefixedKeys = Object.keys(allLocal).filter((key) => key.startsWith(DSS_OPEN_UUID_KEY_PREFIX));
            await chrome.storage.local.remove([...prefixedKeys, DSS_LEGACY_OPEN_UUIDS_ARRAY_KEY]);
        } catch (error) {
            logWriteFailure('clearOpenUuids', error);
        }
    }

    async function getLastAuthToken() {
        try {
            const result = await chrome.storage.local.get(DSS_PENDING_STORE_TOKEN_KEY);
            const token = result?.[DSS_PENDING_STORE_TOKEN_KEY];
            return typeof token === 'string' ? token : null;
        } catch (error) {
            return null;
        }
    }

    async function setLastAuthToken(token) {
        if (!token) return;
        try {
            await chrome.storage.local.set({ [DSS_PENDING_STORE_TOKEN_KEY]: token });
        } catch (error) {
            logWriteFailure('setLastAuthToken', error);
        }
    }

    async function trackForDeletion(chatUuid) {
        if (!chatUuid) return;
        // 順序關鍵：必須先完成本機開啟集合寫入，再寫入同步佇列。
        // 本機 open-set 寫入會早於觸發 chrome.storage.onChanged(sync) 的佇列寫入完成，
        // 因此發起裝置的 SW 掃描永遠能看到剛開啟的 UUID，不會誤刪正在使用中的對話。
        await addOpenUuid(chatUuid);
        await addPendingDelete(chatUuid);
    }

    return {
        getPendingDeletes,
        savePendingDeletes,
        addPendingDelete,
        removePendingDelete,
        refreshLease,
        releaseLease,
        isLeaseExpired,
        getOpenUuids,
        addOpenUuid,
        removeOpenUuid,
        clearOpenUuids,
        getLastAuthToken,
        setLastAuthToken,
        trackForDeletion,
        recordLeaseObservation,
    };
})();

globalThis.TemporaryChatPendingStore = TemporaryChatPendingStore;

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatPendingStore;
}
