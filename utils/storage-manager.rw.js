/**
 * DS Studio — StorageManager 讀寫方法群組
 * 負責 safe wrappers、sync/local 雙層讀取與寫入邏輯。
 */
(function (root) {
    'use strict';

    const bundle = {
    // --- Safe wrappers: resolve/reject gracefully on "Extension context invalidated" ---

    _safeGet(area, keys) {
        return new Promise((resolve) => {
            try {
                chrome.storage[area].get(keys, (data) => {
                    if (chrome.runtime.lastError) { resolve({}); return; }
                    resolve(data || {});
                });
            } catch (e) {
                resolve({});
            }
        });
    },

    _safeSet(area, items) {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage[area].set(items, () => {
                    if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
                    resolve();
                });
            } catch (e) {
                resolve(); // Context invalidated — silently succeed
            }
        });
    },

    _safeRemove(area, keys) {
        return new Promise((resolve) => {
            try {
                chrome.storage[area].remove(keys, () => {
                    if (chrome.runtime.lastError) { resolve(); return; }
                    resolve();
                });
            } catch (e) {
                resolve();
            }
        });
    },

    /**
     * Internal getter that prioritizes sync, then falls back to local.
     * 合併順序為 sync 覆寫 local，逐筆 preset 與 preset 排序再依時間戳收斂；
     * 遠端勝出的項目會由 _reconcileRemoteWins() 回寫本機。
     */
    async _get(keys) {
        const localStatus = await this._safeGet('local', [this.KEYS.SYNC_CONFLICT_PENDING]);
        const isConflictPending = localStatus[this.KEYS.SYNC_CONFLICT_PENDING] === true;

        // 請求 PRESET_INDEX 時一併附帶 PRESET_ORDER_META，確保順序時戳比較資料完整
        let effectiveKeys = Array.isArray(keys) ? [...keys] : keys;
        if (Array.isArray(effectiveKeys)
            && effectiveKeys.includes(this.KEYS.PRESET_INDEX)
            && !effectiveKeys.includes(this.KEYS.PRESET_ORDER_META)) {
            effectiveKeys = [...effectiveKeys, this.KEYS.PRESET_ORDER_META];
        }

        const { sData, hasError } = await new Promise((resolve) => {
            try {
                chrome.storage.sync.get(effectiveKeys, (syncData) => {
                    resolve({ sData: syncData || {}, hasError: chrome.runtime.lastError });
                });
            } catch (e) {
                resolve({ sData: {}, hasError: e });
            }
        });

        const lData = await this._safeGet('local', effectiveKeys);

        if (hasError) return lData;
        if (isConflictPending) return lData;

        const merged = { ...lData, ...sData };

        await this._reconcileRemoteWins({ merged, lData, sData, effectiveKeys });

        return merged;
    },

    /**
     * 收斂 _get() 的合併結果，並將「遠端較新」的項目回寫 chrome.storage.local。
     * 這是讀取路徑中唯一會寫入儲存的步驟，獨立命名以免寫入行為藏在 _get() 之下。
     * merged 會被原地修改。
     * @param {Object} args
     * @param {Object} args.merged - lData 與 sData 的合併結果（原地修改）
     * @param {Object} args.lData - chrome.storage.local 的原始讀取結果
     * @param {Object} args.sData - chrome.storage.sync 的原始讀取結果
     * @param {string[]|string|null} args.effectiveKeys - 本次實際請求的金鑰
     */
    async _reconcileRemoteWins({ merged, lData, sData, effectiveKeys }) {
        // 用於收集本次判定為「遠端較新」的項目，稍後一次性持久化回 chrome.storage.local，
        // 確保回傳值與本機持久化狀態一致（避免僅存在於記憶體中的合併結果）。
        const remoteWinsToPersist = {};

        // === 逐筆 preset 依 updatedAt 挑最新版本，避免 Chrome 同步收斂時以較舊版本覆蓋較新編輯 ===
        for (const key of Object.keys(merged)) {
            if (!key.startsWith(this.PRESET_KEY_PREFIX)) continue;
            const localPreset = lData[key];
            const syncPreset = sData[key];
            if (localPreset === undefined || syncPreset === undefined) continue; // 僅在兩端都存在時比較
            const winner = this._pickNewerPreset(localPreset, syncPreset);
            if (winner === localPreset && merged[key] !== localPreset) {
                merged[key] = localPreset;
            } else if (winner === syncPreset && localPreset !== syncPreset) {
                // 遠端較新：merged[key] 已經是 sData[key]（sync-wins 合併的預設行為），
                // 但本機儲存仍保有舊值，需一併持久化，避免離線讀取或下次啟動時看到過期資料。
                remoteWinsToPersist[key] = syncPreset;
            }
        }

        // === 以 orderUpdatedAt 時戳決定 PRESET_INDEX 勝者 ===
        if (Array.isArray(effectiveKeys) && effectiveKeys.includes(this.KEYS.PRESET_INDEX)) {
            const localOrderMeta = lData[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            const syncOrderMeta = sData[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            const winner = this._pickPresetOrderByRecency(localOrderMeta, syncOrderMeta);
            if (winner) {
                merged[this.KEYS.PRESET_INDEX] = winner.order;
                merged[this.KEYS.PRESET_ORDER_META] = winner.meta;

                // 若 sync 勝出，本機快照仍停留在舊（可能含已刪除 id 的）index，
                // 必須比照上方 dsPreset_* 的做法一併持久化回 local，
                // 否則 popup 重開時 retrySync()/resolveSyncConflict() 會讀到陳舊本機 index，
                // 誤將已刪除項目判定為「本機仍存在」而在合併時復活（見 tombstone 機制）。
                if (winner.meta === syncOrderMeta) {
                    remoteWinsToPersist[this.KEYS.PRESET_INDEX] = winner.order;
                    remoteWinsToPersist[this.KEYS.PRESET_ORDER_META] = winner.meta;
                }
            }
        }

        // 將「遠端較新」的最終結果持久化回 chrome.storage.local。
        const keysToPersist = Object.keys(remoteWinsToPersist).filter((key) => merged[key] === remoteWinsToPersist[key]);
        if (keysToPersist.length > 0) {
            const persistPayload = {};
            keysToPersist.forEach((key) => { persistPayload[key] = remoteWinsToPersist[key]; });
            await this._safeSet('local', persistPayload);
        }
    },

    /**
     * Internal setter that tries sync first, falls back to local if quota exceeded.
     * 寫入前先依 QUOTA_BYTES_PER_ITEM 逐鍵分流：永久超量的項目直接攔截，
     * 只落地本機並標記於 dsOversizedKeys，絕不進入 chrome.storage.sync.set()
     * 或 dsLocalAuth 重試佇列（重試永久超量的項目永遠不會成功）。
     */
    async _set(items) {
        const keysWritten = Object.keys(items);
        // 每個金鑰的位元組長度只序列化一次，超量判定與告警共用同一結果
        const byteLenByKey = new Map(keysWritten.map(k => [k, this._byteLen({ [k]: items[k] })]));
        const oversizedKeys = keysWritten.filter(k => byteLenByKey.get(k) > this.QUOTA_BYTES_PER_ITEM);
        const oversizedKeySet = new Set(oversizedKeys);
        const normalKeys = keysWritten.filter(k => !oversizedKeySet.has(k));
        const normalKeySet = new Set(normalKeys);

        const localStatus = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE, this.KEYS.OVERSIZED_KEYS]);
        let localAuth = (localStatus[this.KEYS.LOCAL_AUTHORITATIVE] || []).filter(k => !oversizedKeySet.has(k));
        const originalOversizedAuth = localStatus[this.KEYS.OVERSIZED_KEYS] || [];
        const oversizedAuth = originalOversizedAuth.filter(k => !normalKeySet.has(k));

        const oversizedAuthSet = new Set(oversizedAuth);
        oversizedKeys.forEach(k => {
            globalThis.__DS_Logger?.warn('push:oversized', { key: k, bytes: byteLenByKey.get(k) });
            if (!oversizedAuthSet.has(k)) { oversizedAuthSet.add(k); oversizedAuth.push(k); }
        });

        const localUpdates = { ...items };
        if (JSON.stringify(oversizedAuth) !== JSON.stringify(originalOversizedAuth)) {
            localUpdates[this.KEYS.OVERSIZED_KEYS] = oversizedAuth;
        }

        if (normalKeys.length === 0) {
            // 整批鍵皆永久超量：完全不呼叫 chrome.storage.sync.set()，只落地本機。
            localUpdates[this.KEYS.LOCAL_AUTHORITATIVE] = localAuth;
            return this._safeSet('local', localUpdates);
        }

        const normalItems = {};
        normalKeys.forEach(k => { normalItems[k] = items[k]; });

        const syncError = await new Promise((resolve) => {
            try {
                chrome.storage.sync.set(normalItems, () => {
                    resolve(chrome.runtime.lastError || null);
                });
            } catch (e) {
                resolve(e); // Context invalidated — fall through to local-write fallback below
            }
        });

        if (syncError) {
            console.warn('Sync storage failed (possibly quota exceeded), falling back to local storage:', syncError?.message ?? 'Unknown error');
            globalThis.__DS_Logger?.warn('push:quota-fail', { keys: normalKeys, error: syncError?.message ?? 'Unknown error' });

            // Add these keys to local authoritative list (transient failure — retry-eligible)
            normalKeys.forEach(k => {
                if (!localAuth.includes(k)) localAuth.push(k);
            });

            localUpdates[this.KEYS.LOCAL_AUTHORITATIVE] = localAuth;
            return this._safeSet('local', localUpdates);
        } else {
            // Sync success: remove these keys from local authoritative list
            const newLocalAuth = localAuth.filter(k => !normalKeySet.has(k));
            if (newLocalAuth.length !== localAuth.length) {
                localUpdates[this.KEYS.LOCAL_AUTHORITATIVE] = newLocalAuth;
            }

            // Backup to local as well for safety
            return this._safeSet('local', localUpdates);
        }
    },

    /**
     * 計算 JSON 序列化後的實際 UTF-8 位元組長度（用於分塊大小估算與 8KB 超量判定）。
     * 使用 TextEncoder 而非 .length，避免中文等多位元組字元被低估位元組數。
     */
    _byteLen(obj) { return new TextEncoder().encode(JSON.stringify(obj)).length; },
    };

    root.__DS_StorageManager_rw = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
