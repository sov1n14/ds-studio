/**
 * DS studio — 臨時對話待刪佇列與裝置本機狀態存取
 * 職責：管理 chrome.storage.sync 的跨裝置待刪佇列，以及 chrome.storage.local 的
 * 本機開啟中 UUID 集合與最近有效 bearer token 快取。
 * 此模組須同時相容 content-script 與 service-worker（classic script／importScripts）
 * 兩種載入情境，因此不 ESM import 常數檔，改在此處自行宣告同值常數。
 */

// 同 content/temporary-chat-constants.js
const DSS_PENDING_STORE_SYNC_KEY = 'dss-pending-deletes-sync';
const DSS_PENDING_STORE_TOKEN_KEY = 'dss-last-auth-token';
const DSS_PENDING_STORE_OPEN_UUIDS_KEY = 'dss-open-temp-uuids';

function logWriteFailure(context, error) {
    // 儲存寫入失敗時僅記錄，絕不拋出以免中斷呼叫端流程
    if (globalThis.__DS_Logger?.warn) {
        globalThis.__DS_Logger.warn('pending-store:write-fail', context, error);
        return;
    }
    console.warn('pending-store:write-fail', context, error);
}

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
        const queue = await getPendingDeletes();
        const hasExisting = queue.some((entry) => entry.chatUuid === chatUuid);
        if (hasExisting) return;
        queue.push({ chatUuid, attemptCount: 0 });
        await savePendingDeletes(queue);
    }

    async function removePendingDelete(chatUuid) {
        if (!chatUuid) return;
        const queue = await getPendingDeletes();
        const filtered = queue.filter((entry) => entry.chatUuid !== chatUuid);
        if (filtered.length === queue.length) return;
        await savePendingDeletes(filtered);
    }

    async function getOpenUuids() {
        try {
            const result = await chrome.storage.local.get(DSS_PENDING_STORE_OPEN_UUIDS_KEY);
            const uuids = result?.[DSS_PENDING_STORE_OPEN_UUIDS_KEY];
            return Array.isArray(uuids) ? uuids : [];
        } catch (error) {
            return [];
        }
    }

    async function addOpenUuid(chatUuid) {
        if (!chatUuid) return;
        const uuids = await getOpenUuids();
        if (uuids.includes(chatUuid)) return;
        uuids.push(chatUuid);
        try {
            await chrome.storage.local.set({ [DSS_PENDING_STORE_OPEN_UUIDS_KEY]: uuids });
        } catch (error) {
            logWriteFailure('addOpenUuid', error);
        }
    }

    async function removeOpenUuid(chatUuid) {
        if (!chatUuid) return;
        const uuids = await getOpenUuids();
        const filtered = uuids.filter((uuid) => uuid !== chatUuid);
        if (filtered.length === uuids.length) return;
        try {
            await chrome.storage.local.set({ [DSS_PENDING_STORE_OPEN_UUIDS_KEY]: filtered });
        } catch (error) {
            logWriteFailure('removeOpenUuid', error);
        }
    }

    async function clearOpenUuids() {
        try {
            await chrome.storage.local.remove(DSS_PENDING_STORE_OPEN_UUIDS_KEY);
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
        getOpenUuids,
        addOpenUuid,
        removeOpenUuid,
        clearOpenUuids,
        getLastAuthToken,
        setLastAuthToken,
        trackForDeletion,
    };
})();

globalThis.TemporaryChatPendingStore = TemporaryChatPendingStore;

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatPendingStore;
}
