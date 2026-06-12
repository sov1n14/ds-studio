/**
 * DS studio v2.5.2 — Storage Manager
 * Wrapper for Chrome Storage API with Sync support and Local fallback
 */
/**
 * 內部 promise-chain 寫入佇列，用於序列化 chatPresetMap 的寫入操作，
 * 避免同 context 內的競爭條件（race condition）。
 */
let _chatPresetMapChainTail = Promise.resolve();

/**
 * 將 taskFn 加入 chatPresetMap 寫入佇列的尾部，確保依序執行。
 * 佇列中的任一任務失敗不會影響後續任務。
 * @param {Function} taskFn - 非同步函式，回傳 Promise
 * @returns {Promise} 該任務的 Promise
 */
function _enqueueChatPresetMapWrite(taskFn) {
    const next = _chatPresetMapChainTail.then(taskFn, taskFn);
    _chatPresetMapChainTail = next.catch(() => {}); // 隔離連鎖失敗
    return next;
}

const CHUNK_SOFT_LIMIT_BYTES = 7168;  // 7KB，留 1KB 安全邊際低於 8KB 硬上限
let _chunkIndexCache = null;   // Map<uuid, chunkIdx> | null = 需要重新載入
let _metaCache = null;         // { version, chunkCount, chunkSizes[] } | null

// === Phase C+D: Cross-Context Concurrency Control (v2.5.0) ===
const LOCK_KEY = 'chatPresetMapLock';
const LOCK_TTL_MS = 3000;
const LOCK_ACQUIRE_TIMEOUT_MS = 5000;
const LOCK_POLL_INTERVAL_MS = 50;
const RECONCILIATION_RETRY_BUDGET = 3;

class LockAcquireTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LockAcquireTimeoutError';
    }
}
class WriteReconciliationExhaustedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WriteReconciliationExhaustedError';
    }
}

/**
 * 單一事實來源 helper：基於前一版 meta 遞增版號並選擇性覆寫 chunkCount / chunkSizes。
 * 所有寫入路徑必須經由此函式建構 newMeta，確保版號單調遞增。
 */
function _buildNextMeta(prevMeta, { chunkCount, chunkSizes }) {
    return {
        version: (prevMeta.version || 0) + 1,
        chunkCount: chunkCount ?? prevMeta.chunkCount,
        chunkSizes: chunkSizes ?? [...prevMeta.chunkSizes],
    };
}

const StorageManager = {
    /**
     * Keys used in the extension
     */
    KEYS: {
        PROMPT_PRESETS: 'promptPresets',       // migration detection only
        PRESET_INDEX: 'dsPresetIndex',         // new: ordered ID list
        LOCAL_AUTHORITATIVE: 'dsLocalAuth',    // new: Plan A tracking
        ACTIVE_PRESET_ID: 'activePresetId',
        IS_ENABLED: 'isEnabled',
        GLOBAL_PROMPT_ENABLED: 'globalPromptEnabled',
        INCLUDE_THINKING: 'includeThinking',
        INCLUDE_REFERENCES: 'includeReferences',
        GLOBAL_DEFAULT_PROMPT: 'globalDefaultPrompt',
        CHAT_PRESET_MAP: 'chatPresetMap',
        CHAT_PRESET_MAP_META: 'chatPresetMapMeta',
        CHAT_PRESET_MAP_CHUNK_PREFIX: 'chatPresetMap_',
        SIDEBAR_AUTO_HIDE: 'dsSidebarAutoHide',
        HIDE_THINKING: 'dsHideThinking',
        SHOW_SYSTEM_TIME: 'dsShowSystemTime',
        CHAT_WIDTH: 'dsChatWidth',
        CHAT_WIDTH_ENABLED: 'dsChatWidthEnabled',
        INPUT_WIDTH: 'dsInputWidth',
        INPUT_WIDTH_ENABLED: 'dsInputWidthEnabled',
        SYNC_INITIALIZED: 'syncInitialized',
        SYNC_CONFLICT_PENDING: 'syncConflictPending',
        RESTORED_MESSAGES: 'restored_messages',
    },

    /**
     * Default values for settings
     */
    DEFAULTS: {
        dsPresetIndex: [],
        activePresetId: '',
        isEnabled: false,
        globalPromptEnabled: true,
        includeThinking: true,
        includeReferences: true,
        globalDefaultPrompt: '',
        chatPresetMap: {},
        dsSidebarAutoHide: false,
        dsHideThinking: false,
        dsShowSystemTime: false,
        dsChatWidth: 70,
        dsChatWidthEnabled: false,
        dsInputWidth: 70,
        dsInputWidthEnabled: false,
        syncInitialized: false,
        syncConflictPending: false,
        restored_messages: {},
    },

    /**
     * Typed error constructors for instanceof checks by callers and tests.
     */
    errors: {
        LockAcquireTimeoutError,
        WriteReconciliationExhaustedError,
    },

    /**
     * Helper to get storage key for a specific preset
     */
    _presetKey(id) {
        return 'dsPreset_' + id;
    },

    /**
     * Reconstruct PromptPreset[] from raw storage data
     */
    _getPresetsFromRawStorage(data) {
        const ids = data[this.KEYS.PRESET_INDEX] || [];
        return ids.map(id => data[this._presetKey(id)]).filter(Boolean);
    },

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
     */
    async _get(keys) {
        const localStatus = await this._safeGet('local', [this.KEYS.SYNC_CONFLICT_PENDING, this.KEYS.LOCAL_AUTHORITATIVE]);
        const isConflictPending = localStatus[this.KEYS.SYNC_CONFLICT_PENDING] === true;
        const localAuth = localStatus[this.KEYS.LOCAL_AUTHORITATIVE] || [];

        // Capture lastError inside the sync callback before it's cleared
        const { sData, hasError } = await new Promise((resolve) => {
            try {
                chrome.storage.sync.get(keys, (syncData) => {
                    resolve({ sData: syncData || {}, hasError: chrome.runtime.lastError });
                });
            } catch (e) {
                resolve({ sData: {}, hasError: e });
            }
        });

        const lData = await this._safeGet('local', keys);

        // If sync failed, just use local
        if (hasError) return lData;

        // If conflict is pending, strictly return local data to avoid silent overwrite
        if (isConflictPending) return lData;

        // Merge: sync overrides local, but if sync is missing a key, local is used
        const merged = { ...lData, ...sData };

        // Plan A: Re-apply local values for keys that failed to sync previously
        if (localAuth.length > 0) {
            for (const key of keys) {
                if (localAuth.includes(key) && lData[key] !== undefined) {
                    merged[key] = lData[key];
                }
            }
        }

        return merged;
    },

    /**
     * Internal setter that tries sync first, falls back to local if quota exceeded.
     */
    async _set(items) {
        const keysWritten = Object.keys(items);

        const syncError = await new Promise((resolve) => {
            try {
                chrome.storage.sync.set(items, () => {
                    resolve(chrome.runtime.lastError || null);
                });
            } catch (e) {
                resolve(null); // Context invalidated — treat as silent success, local backup below
            }
        });

        const localStatus = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
        let localAuth = localStatus[this.KEYS.LOCAL_AUTHORITATIVE] || [];

        if (syncError) {
            console.warn('Sync storage failed (possibly quota exceeded), falling back to local storage:', syncError?.message ?? 'Unknown error');

            // Add these keys to local authoritative list
            keysWritten.forEach(k => {
                if (!localAuth.includes(k)) localAuth.push(k);
            });

            return this._safeSet('local', { ...items, [this.KEYS.LOCAL_AUTHORITATIVE]: localAuth });
        } else {
            // Sync success: remove these keys from local authoritative list
            const newLocalAuth = localAuth.filter(k => !keysWritten.includes(k));

            const localUpdates = { ...items };
            if (newLocalAuth.length !== localAuth.length) {
                localUpdates[this.KEYS.LOCAL_AUTHORITATIVE] = newLocalAuth;
            }

            // Backup to local as well for safety
            return this._safeSet('local', localUpdates);
        }
    },

    // --- 分塊式 chatPresetMap 輔助方法 ---

    _byteLen(obj) { return JSON.stringify(obj).length; },

    async _ensureChunkCachesLoaded() {
        if (_metaCache && _chunkIndexCache) return;
        const metaRaw = await this._safeGet('sync', [StorageManager.KEYS.CHAT_PRESET_MAP_META]);
        const meta = metaRaw[StorageManager.KEYS.CHAT_PRESET_MAP_META] ?? { version: 0, chunkCount: 0, chunkSizes: [] };
        const chunkKeys = [];
        for (let i = 0; i < meta.chunkCount; i++) {
            chunkKeys.push(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
        }
        const chunks = await this._get(chunkKeys);
        const index = new Map();
        for (let i = 0; i < meta.chunkCount; i++) {
            const chunk = chunks[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i] ?? {};
            for (const uuid of Object.keys(chunk)) {
                index.set(uuid, i);
            }
        }
        _metaCache = meta;
        _chunkIndexCache = index;
    },

    async _readAllChunks() {
        await this._ensureChunkCachesLoaded();
        const metaCopy = { ..._metaCache, chunkSizes: [..._metaCache.chunkSizes] };
        const chunkKeys = [];
        for (let i = 0; i < metaCopy.chunkCount; i++) {
            chunkKeys.push(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
        }
        const chunks = await this._get(chunkKeys);
        const chunksByIdx = [];
        const map = {};
        for (let i = 0; i < metaCopy.chunkCount; i++) {
            const c = chunks[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i] ?? {};
            chunksByIdx.push(c);
            Object.assign(map, c);
        }
        return { map, metaCopy, chunksByIdx };
    },

    async _writeChunkWithMeta(chunkIdx, chunkObj, newMeta) {
        if (_metaCache && newMeta.version !== _metaCache.version + 1) {
            console.warn('[StorageManager] meta version did not strictly increment',
                         { prev: _metaCache.version, next: newMeta.version });
        }
        const items = {};
        items[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx] = chunkObj;
        items[StorageManager.KEYS.CHAT_PRESET_MAP_META] = newMeta;
        await this._set(items);
        _metaCache = newMeta;
    },

    // === Phase C+D: Lock Primitives ===

    /**
     * Sleep-poll acquire a scoped advisory lock in chrome.storage.local.
     * TTL-based recovery: if the lock holder crashes, the lock expires after LOCK_TTL_MS
     * and any acquirer may claim it.
     * @returns {Promise<string>} owner token — MUST be passed to _releaseChatPresetMapLock.
     * @throws {LockAcquireTimeoutError} after LOCK_ACQUIRE_TIMEOUT_MS without acquiring.
     */
    async _acquireChatPresetMapLock() {
        const token = Math.random().toString(36).slice(2) + '-' + Date.now();
        const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;

        while (Date.now() < deadline) {
            const raw = await this._safeGet('local', [LOCK_KEY]);
            const cur = raw[LOCK_KEY];
            const isFree = !cur || Date.now() > cur.expiresAt;

            if (isFree) {
                await this._safeSet('local', {
                    [LOCK_KEY]: { owner: token, expiresAt: Date.now() + LOCK_TTL_MS }
                });
                // Post-write verification (best-effort CAS): confirm our token was stored.
                const verify = await this._safeGet('local', [LOCK_KEY]);
                if (verify[LOCK_KEY]?.owner === token) {
                    return token;
                }
                // Someone else wrote in the same window; loop and retry.
            }
            await new Promise(resolve => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
        }
        throw new LockAcquireTimeoutError(
            `Could not acquire chatPresetMap lock within ${LOCK_ACQUIRE_TIMEOUT_MS}ms`
        );
    },

    /**
     * Idempotent lock release. Only removes the lock if the owner token matches.
     * Logs a warning on owner mismatch (e.g., TTL takeover by another context).
     * @param {string} token - The owner token returned by _acquireChatPresetMapLock.
     */
    async _releaseChatPresetMapLock(token) {
        const raw = await this._safeGet('local', [LOCK_KEY]);
        const cur = raw[LOCK_KEY];
        if (cur && cur.owner === token) {
            await this._safeRemove('local', [LOCK_KEY]);
        } else {
            console.warn('[StorageManager] lock owner mismatch on release — TTL takeover likely',
                         { expected: token, actual: cur?.owner });
        }
    },

    /**
     * Convenience wrapper that acquires the lock, executes fn, and releases in finally.
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async _withChatPresetMapLock(fn) {
        const token = await this._acquireChatPresetMapLock();
        try {
            return await fn();
        } finally {
            await this._releaseChatPresetMapLock(token);
        }
    },

    /**
     * Bounded CAS-retry single-chunk writer for hot-path operations.
     * Re-reads the chunk and meta.version before each write attempt;
     * if meta.version advanced (another context committed), invalidates caches
     * and retries up to RECONCILIATION_RETRY_BUDGET times.
     *
     * @param {Object} opts
     * @param {number} opts.chunkIdx - The chunk index to write.
     * @param {(chunk: Object) => void} opts.applyDelta - Idempotent mutator for the chunk.
     * @param {number} [opts.retryBudget=RECONCILIATION_RETRY_BUDGET] - Max retry attempts.
     * @throws {WriteReconciliationExhaustedError} after exhausting retry budget.
     */
    async _writeChunkWithReconciliation({ chunkIdx, applyDelta, retryBudget = RECONCILIATION_RETRY_BUDGET }) {
        let attempt = 0;
        while (attempt <= retryBudget) {
            await this._ensureChunkCachesLoaded();
            const prevVersion = _metaCache.version;
            const chunkKey = StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx;
            const raw = await this._get([chunkKey]);
            const chunk = raw[chunkKey] ?? {};
            applyDelta(chunk);
            const newSize = this._byteLen(chunk);
            const newMeta = _buildNextMeta(_metaCache, { chunkSizes: [..._metaCache.chunkSizes] });
            newMeta.chunkSizes[chunkIdx] = newSize;

            // 樂觀 CAS 檢查：重新讀取 meta 確認版號未前進
            const liveMetaRaw = await this._safeGet('sync', [StorageManager.KEYS.CHAT_PRESET_MAP_META]);
            const liveVersion = liveMetaRaw[StorageManager.KEYS.CHAT_PRESET_MAP_META]?.version ?? prevVersion;
            if (liveVersion !== prevVersion) {
                // Conflict — invalidate caches and retry with fresh state.
                _metaCache = null;
                _chunkIndexCache = null;
                attempt += 1;
                continue;
            }

            await this._writeChunkWithMeta(chunkIdx, chunk, newMeta);
            // 寫入可能觸發 onChanged（經由 _set 的 local backup），導致 _chunkIndexCache 被
            // 快取失效監聽器設為 null（跨模組情境）。若發生此情況，重新載入快取確保正確。
            if (_chunkIndexCache === null) {
                await this._ensureChunkCachesLoaded();
            }
            return;
        }
        throw new WriteReconciliationExhaustedError(
            `chunk ${chunkIdx} write reconciliation exhausted after ${retryBudget + 1} attempts`
        );
    },

    _installChunkCacheInvalidator() {
        chrome.storage.onChanged.addListener((changes) => {
            const keys = Object.keys(changes);
            const touched = keys.some(k =>
                k === StorageManager.KEYS.CHAT_PRESET_MAP_META ||
                k.startsWith(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX)
            );
            if (touched) {
                _chunkIndexCache = null;
                _metaCache = null;
            }
        });
    },

    /**
     * Merge presets from two sources based on ID
     * @param {Array} basePresets
     * @param {Array} newPresets
     * @returns {Array} Merged presets
     */
    mergePresets(basePresets, newPresets) {
        const mergedMap = new Map();

        // Add all base presets first
        (basePresets || []).forEach(p => mergedMap.set(p.id, { ...p }));

        // Merge new presets
        (newPresets || []).forEach(p => {
            if (mergedMap.has(p.id)) {
                const existing = mergedMap.get(p.id);
                // Keep the newer one based on updatedAt
                if ((p.updatedAt || 0) > (existing.updatedAt || 0)) {
                    mergedMap.set(p.id, { ...p });
                }
            } else {
                // Not in base, append it
                mergedMap.set(p.id, { ...p });
            }
        });

        return Array.from(mergedMap.values());
    },

    /**
     * Initialize default values if not present, migrate old data if needed
     */
    async initialize() {
        // Cross-context/re-init defense: 強制清除模組層級快取，避免讀取到過期資料
        _metaCache = null;
        _chunkIndexCache = null;

        const keysToFetch = Object.values(this.KEYS);

        // Check local initialization state
        const localState = await this._safeGet('local', [this.KEYS.SYNC_INITIALIZED, this.KEYS.SYNC_CONFLICT_PENDING]);
        const syncInitialized = localState[this.KEYS.SYNC_INITIALIZED] === true;

        // Fetch current data (including potential old promptPresets for migration)
        const data = await this._get(keysToFetch);
        const updates = {};

        // 1. Migration from v1.6.x (single promptPresets key) to v1.7.0 (per-preset keys)
        if (data[this.KEYS.PROMPT_PRESETS] !== undefined) {
            const oldPresets = data[this.KEYS.PROMPT_PRESETS] || [];
            if (oldPresets.length > 0) {
                await this.savePromptPresets(oldPresets);
            }
            // Remove the old key from both storages
            await this._safeRemove('sync', this.KEYS.PROMPT_PRESETS);
            await this._safeRemove('local', this.KEYS.PROMPT_PRESETS);
            // Refresh data after migration
            return this.initialize();
        }

        // 2. Detect Sync Conflict on first sync run
        if (!syncInitialized) {
            const syncRaw = await this._safeGet('sync', null);
            const localRaw = await this._safeGet('local', null);

            const hasCloudData = syncRaw[this.KEYS.PRESET_INDEX] !== undefined;

            if (hasCloudData) {
                // Compare IDs first — preset content may be local-only (quota fallback),
                // so comparing resolved objects would show both sides as empty and miss the conflict.
                const syncIds = (syncRaw[this.KEYS.PRESET_INDEX] || []).slice().sort();
                const localIds = (localRaw[this.KEYS.PRESET_INDEX] || []).slice().sort();
                const idsDiffer = JSON.stringify(syncIds) !== JSON.stringify(localIds);

                // Also compare content for cases where IDs match but values differ
                const syncPresets = this._getPresetsFromRawStorage(syncRaw);
                const localPresets = this._getPresetsFromRawStorage(localRaw);
                const contentDiffers = JSON.stringify(syncPresets) !== JSON.stringify(localPresets);

                if (idsDiffer || contentDiffers) {
                    await this._safeSet('local', { [this.KEYS.SYNC_CONFLICT_PENDING]: true });
                } else {
                    await this._safeSet('local', { [this.KEYS.SYNC_INITIALIZED]: true });
                }
            } else {
                await this._safeSet('local', { [this.KEYS.SYNC_INITIALIZED]: true });
            }
        }

        // 2.5. Migration: legacy chatPresetMap → 分塊式佈局
        const legacySync = await this._safeGet('sync', [this.KEYS.CHAT_PRESET_MAP]);
        const legacyLocal = await this._safeGet('local', [this.KEYS.CHAT_PRESET_MAP]);
        const legacy = legacySync[this.KEYS.CHAT_PRESET_MAP] ?? legacyLocal[this.KEYS.CHAT_PRESET_MAP];
        const metaCheck = await this._safeGet('sync', [this.KEYS.CHAT_PRESET_MAP_META]);
        const metaExists = metaCheck[this.KEYS.CHAT_PRESET_MAP_META] !== undefined;

        if (legacy !== undefined) {
            await this._withChatPresetMapLock(async () => {
                if (!metaExists) {
                    // 完整遷移：mutator 將 legacy 寫入分塊；鎖由上層保護
                    await this.mutateChatPresetMap(() => legacy);
                }
                // 清除舊金鑰 (崩潰復原：若 meta 已存在則只需清除；idempotent operation)
                await this._safeRemove('sync', this.KEYS.CHAT_PRESET_MAP);
                await this._safeRemove('local', this.KEYS.CHAT_PRESET_MAP);
                delete data[this.KEYS.CHAT_PRESET_MAP];
            });
        }

        // 3. Migration from v1.2.x (promptPrefix) to v1.7.0
        if (data[this.KEYS.PRESET_INDEX] === undefined) {
            const oldData = await this._safeGet('local', 'promptPrefix');
            if (oldData && oldData.promptPrefix !== undefined && oldData.promptPrefix !== '') {
                const migratedPreset = {
                    id: 'preset-migrated-' + Date.now(),
                    name: '我的提示詞',
                    content: oldData.promptPrefix,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                await this.savePromptPresets([migratedPreset]);
                updates[this.KEYS.ACTIVE_PRESET_ID] = migratedPreset.id;
            } else {
                updates[this.KEYS.PRESET_INDEX] = this.DEFAULTS.dsPresetIndex;
                updates[this.KEYS.ACTIVE_PRESET_ID] = this.DEFAULTS.activePresetId;
            }
        }

        // 4. Fill other defaults
        for (const key of keysToFetch) {
            if (key === this.KEYS.PROMPT_PRESETS) continue; // 跳過已退役的金鑰
            if (key === this.KEYS.CHAT_PRESET_MAP) continue; // 跳過已分塊處理的金鑰
            if (data[key] === undefined && this.DEFAULTS[key] !== undefined) {
                updates[key] = this.DEFAULTS[key];
            }
        }

        if (Object.keys(updates).length > 0) {
            await this._set(updates);
        } else if (syncInitialized) {
            // Ensure sync has what local has (migration push)
            const syncData = await this._safeGet('sync', keysToFetch);
            const missingInSync = {};
            for (const key of keysToFetch) {
                if (key === this.KEYS.PROMPT_PRESETS
                 || key === this.KEYS.CHAT_PRESET_MAP
                 || key === this.KEYS.RESTORED_MESSAGES) continue;
                if (syncData[key] === undefined && data[key] !== undefined) {
                    missingInSync[key] = data[key];
                }
            }

            // Also check individual presets
            const localIds = data[this.KEYS.PRESET_INDEX] || [];
            for (const id of localIds) {
                const pKey = this._presetKey(id);
                if (syncData[pKey] === undefined) {
                    const pData = await this._safeGet('local', pKey);
                    if (pData[pKey]) missingInSync[pKey] = pData[pKey];
                }
            }

            if (Object.keys(missingInSync).length > 0) {
                await this._set(missingInSync);
            }
        }

        // 註冊 chunk 快取失效監聽器（此後其他 context 修改分塊時自動重載）
        this._installChunkCacheInvalidator();
    },

    /**
     * Check if there is a pending sync conflict
     * @returns {Promise<boolean>}
     */
    async checkSyncConflictPending() {
        const state = await this._safeGet('local', [this.KEYS.SYNC_CONFLICT_PENDING]);
        return state[this.KEYS.SYNC_CONFLICT_PENDING] === true;
    },

    /**
     * Resolve sync conflict by merging cloud data into local
     */
    async resolveSyncConflict() {
        const syncRaw = await this._safeGet('sync', null);
        const localRaw = await this._safeGet('local', null);

        const syncPresets = this._getPresetsFromRawStorage(syncRaw);
        const localPresets = this._getPresetsFromRawStorage(localRaw);

        const mergedPresets = this.mergePresets(localPresets, syncPresets);

        // 1. Save merged presets (handles per-key storage)
        await this.savePromptPresets(mergedPresets);

        // 2. Resolve other settings: Cloud settings overwrite local UI settings
        const updates = { ...localRaw, ...syncRaw };

        // Cleanup: remove old key if it exists in the raw data
        delete updates[this.KEYS.PROMPT_PRESETS];

        // Ensure we don't overwrite the newly saved presets with raw data
        // (savePromptPresets already updated PRESET_INDEX and individual keys in storage)
        // But since we are calling _set(updates), we should remove preset-related keys from updates
        // to avoid redundant writes or overwriting with old values from localRaw/syncRaw.
        const presetIds = mergedPresets.map(p => p.id);
        delete updates[this.KEYS.PRESET_INDEX];
        presetIds.forEach(id => delete updates[this._presetKey(id)]);
        // Also delete any other dsPreset_ keys that might be in raw data
        Object.keys(updates).forEach(k => {
            if (k.startsWith('dsPreset_')) delete updates[k];
        });

        // restored_messages 是僅存本機的大型資料集，可能超過 8KB 同步配額
        // 排除它以避免 chrome.storage.sync.set 因每項配額限制而失敗
        delete updates[this.KEYS.RESTORED_MESSAGES];

        updates[this.KEYS.SYNC_INITIALIZED] = true;
        updates[this.KEYS.SYNC_CONFLICT_PENDING] = false;

        return this._set(updates);
    },

    /**
     * Get all settings
     * @returns {Promise<Object>} Object containing all settings
     */
    async getSettings() {
        // 排除非使用者設定的內部金鑰（如 restored_messages），避免不必要的儲存讀取與記憶體開銷
        const keysToFetch = Object.values(this.KEYS)
            .filter(k => k !== this.KEYS.RESTORED_MESSAGES);
        const data = await this._get(keysToFetch);

        // Fetch individual presets based on index
        const presetIds = data[this.KEYS.PRESET_INDEX] || [];
        const presetData = await this._get(presetIds.map(id => this._presetKey(id)));
        const presets = presetIds.map(id => presetData[this._presetKey(id)]).filter(Boolean);

        const settings = {};
        for (const [internalKey, storageKey] of Object.entries(this.KEYS)) {
            // 跳過內部專用金鑰，不納入使用者設定回傳值
            if (storageKey === this.KEYS.RESTORED_MESSAGES) continue;

            // Special handling for presets array
            if (storageKey === this.KEYS.PROMPT_PRESETS) {
                settings.promptPresets = presets;
                continue;
            }

            // Use defaults if missing
            const camelKey = internalKey.toLowerCase().replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            // Some keys don't follow the simple camelCase mapping, manually map them
            let settingsKey = camelKey;
            if (internalKey === 'SIDEBAR_AUTO_HIDE') settingsKey = 'sidebarAutoHide';
            if (internalKey === 'HIDE_THINKING') settingsKey = 'hideThinking';
            if (internalKey === 'SHOW_SYSTEM_TIME') settingsKey = 'showSystemTime';
            if (internalKey === 'CHAT_WIDTH') settingsKey = 'chatWidth';
            if (internalKey === 'CHAT_WIDTH_ENABLED') settingsKey = 'chatWidthEnabled';
            if (internalKey === 'INPUT_WIDTH') settingsKey = 'inputWidth';
            if (internalKey === 'INPUT_WIDTH_ENABLED') settingsKey = 'inputWidthEnabled';

            // Special handling for the ones already in DEFAULTS with different names
            const defaultVal = this.DEFAULTS[storageKey];
            settings[settingsKey] = data[storageKey] ?? defaultVal;
        }

        // 以分塊式版本覆寫 chatPresetMap
        settings.chatPresetMap = await this.getChatPresetMap();

        return settings;
    },

    /**
     * Get the content of the currently active preset
     * @returns {Promise<string>} The active preset content
     */
    async getActivePromptContent() {
        const data = await this._get([this.KEYS.PRESET_INDEX, this.KEYS.ACTIVE_PRESET_ID]);
        const ids = data[this.KEYS.PRESET_INDEX] || [];
        const activeId = data[this.KEYS.ACTIVE_PRESET_ID] ?? this.DEFAULTS.activePresetId;

        if (!activeId || !ids.includes(activeId)) return '';

        const presetData = await this._get([this._presetKey(activeId)]);
        const active = presetData[this._presetKey(activeId)];
        return active?.content ?? '';
    },

    /**
     * Save a single preset's content without touching the index.
     * Hot-path for content edits: exactly 1 sync write operation.
     * @param {Object} preset - The preset object to save
     */
    async saveOnePromptPreset(preset) {
        return this._set({ [this._presetKey(preset.id)]: preset });
    },

    /**
     * Save all prompt presets using individual keys
     * @param {Array} presets - Array of preset objects
     */
    async savePromptPresets(presets) {
        // 1. Get current index to identify deletions
        const data = await this._get([this.KEYS.PRESET_INDEX]);
        const oldIds = data[this.KEYS.PRESET_INDEX] || [];
        const newIds = presets.map(p => p.id);
        const deletedIds = oldIds.filter(id => !newIds.includes(id));

        // 2. Write index directly to both storages — it's tiny and must always reach sync.
        //    Bundling it with preset content risks the entire batch falling back to local
        //    when any single preset exceeds the per-item quota, which breaks reinstall
        //    conflict detection (the cloud would have no record that presets ever existed).
        const localStatus = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
        const localAuth = localStatus[this.KEYS.LOCAL_AUTHORITATIVE] || [];
        const isIndexPendingRecovery = localAuth.includes(this.KEYS.PRESET_INDEX);

        if (JSON.stringify(oldIds) !== JSON.stringify(newIds) || isIndexPendingRecovery) {
            await this._set({ [this.KEYS.PRESET_INDEX]: newIds });
        }

        // 3. Write each preset individually so an oversized preset falls back to local
        //    without dragging smaller presets (or the index) down with it.
        for (const p of presets) {
            await this._set({ [this._presetKey(p.id)]: p });
        }

        // 4. Cleanup deleted presets
        if (deletedIds.length > 0) {
            const keysToRemove = deletedIds.map(id => this._presetKey(id));
            await this._safeRemove('sync', keysToRemove);
            await this._safeRemove('local', keysToRemove);
        }
    },

    /**
     * Returns true if no keys are pending a sync retry (all writes reached cloud).
     */
    async isSyncedWithCloud() {
        const data = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
        const arr = data[this.KEYS.LOCAL_AUTHORITATIVE] || [];
        return arr.length === 0;
    },

    /**
     * Retry writing all locally-authoritative keys back to sync storage.
     * Returns { success: boolean, remainingUnsyncedCount: number }
     */
    async retrySync() {
        const data = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
        const pendingKeys = data[this.KEYS.LOCAL_AUTHORITATIVE] || [];

        for (const key of pendingKeys) {
            const localData = await this._safeGet('local', [key]);
            if (localData[key] !== undefined) {
                await this._set({ [key]: localData[key] });
            } else {
                // Key was deleted locally while offline — clean up sync and tracking
                await this._safeRemove('sync', [key]);
                const current = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
                const newArr = (current[this.KEYS.LOCAL_AUTHORITATIVE] || []).filter(k => k !== key);
                await this._safeSet('local', { [this.KEYS.LOCAL_AUTHORITATIVE]: newArr });
            }
        }

        const after = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
        const remainingUnsyncedCount = (after[this.KEYS.LOCAL_AUTHORITATIVE] || []).length;
        return { success: remainingUnsyncedCount === 0, remainingUnsyncedCount };
    },

    /**
     * Save the active preset ID
     * @param {string} id
     */
    async saveActivePresetId(id) {
        return this._set({ [this.KEYS.ACTIVE_PRESET_ID]: id });
    },

    /**
     * Save the enabled state
     * @param {boolean} isEnabled
     */
    async saveEnabledState(isEnabled) {
        return this._set({ [this.KEYS.IS_ENABLED]: isEnabled });
    },

    /**
     * 儲存全域預設提示詞啟用狀態
     * @param {boolean} enabled
     */
    async saveGlobalPromptEnabled(enabled) {
        return this._set({ [this.KEYS.GLOBAL_PROMPT_ENABLED]: enabled });
    },

    /**
     * Save include thinking state
     * @param {boolean} includeThinking
     */
    async saveIncludeThinking(includeThinking) {
        return this._set({ [this.KEYS.INCLUDE_THINKING]: includeThinking });
    },

    /**
     * Save include references state
     * @param {boolean} includeReferences
     */
    async saveIncludeReferences(includeReferences) {
        return this._set({ [this.KEYS.INCLUDE_REFERENCES]: includeReferences });
    },

    async saveGlobalDefaultPrompt(content) {
        return this._set({ [this.KEYS.GLOBAL_DEFAULT_PROMPT]: content });
    },

    /**
     * 透過 mutator 函式安全地讀取-修改-寫入 chatPresetMap，
     * 所有 chatPresetMap 的寫入皆經由內部 promise-chain 佇列序列化，
     * 避免同 context 內的競爭條件。
     *
     * @param {Function} mutator - 非同步或同步函式，接收當前 map 物件，
     *   可原地修改 map，或回傳一個全新的 map 物件來取代。
     *   若回傳值為 undefined，則使用原地修改後的 map。
     *
     *   ⚠️ MUTATOR CONTRACT（所有呼叫者必須遵守）：
     *   - C1 (Idempotent)：對相同輸入 map 必須產生相同結果，不可依賴呼叫次數。
     *   - C2 (No side effects)：不得有外部 I/O、計數器或 map 以外的狀態修改。
     *   - C3 (Respect input map)：必須從傳入的 map 衍生結果（如 map => ({ ...map, [k]: v })），
     *     不可使用盲取代換（() => ({...})），否則會丟棄其他 context 的已提交寫入。
     *   - Double-run caveat：在多 chunk 鎖定路徑下，mutator 會先在外層執行一次
     *     （用於決定單/多 chunk 路徑及計算 diff），然後在鎖定內重新讀取最新 map
     *     後再次執行。因此 C1 和 C2 是強制要求。
     *
     * @returns {Promise<Object>} 最終寫入 storage 的 chatPresetMap
     */
    async mutateChatPresetMap(mutator) {
        return _enqueueChatPresetMapWrite(async () => {
            const { map, metaCopy, chunksByIdx } = await this._readAllChunks();

            // 在呼叫 mutator 前快照原始 state，因為 mutator 可能原地修改 map
            const snapshotEntries = Object.entries(map);
            const snapshotMap = Object.fromEntries(snapshotEntries);

            const result = await mutator(map);
            // 重新載入快取：async mutator 的 await 可能觸發 onChanged 導致快取失效
            await this._ensureChunkCachesLoaded();

            const finalMap = result === undefined ? map : result;

            // 使用快照計算差異
            const oldKeys = Object.keys(snapshotMap);
            const newKeys = Object.keys(finalMap);
            const deletedKeys = oldKeys.filter(k => !(k in finalMap));
            const addedKeys = newKeys.filter(k => !(k in snapshotMap));
            const changedKeys = newKeys.filter(k => k in snapshotMap && snapshotMap[k] !== finalMap[k]);

            if (deletedKeys.length === 0 && addedKeys.length === 0 && changedKeys.length === 0) {
                return map;
            }

            // 建立工作副本
            const newChunks = chunksByIdx.map(c => ({ ...c }));
            let newMeta = _buildNextMeta(metaCopy, {});

            // 追蹤被修改過的 chunk 索引
            const modifiedChunks = new Set();

            // 1. 刪除已移除的 uuid
            for (const key of deletedKeys) {
                if (_chunkIndexCache.has(key)) {
                    const idx = _chunkIndexCache.get(key);
                    if (idx < newChunks.length) {
                        delete newChunks[idx][key];
                        modifiedChunks.add(idx);
                    }
                    _chunkIndexCache.delete(key);
                }
            }

            // 2. 原地更新已變更的 uuid
            for (const key of changedKeys) {
                if (_chunkIndexCache.has(key)) {
                    const idx = _chunkIndexCache.get(key);
                    if (idx < newChunks.length) {
                        newChunks[idx][key] = finalMap[key];
                        modifiedChunks.add(idx);
                    }
                }
            }

            // 3. 新增 uuid：先嘗試填入既有 chunk，否則附加新 chunk
            for (const key of addedKeys) {
                const entrySize = this._byteLen({ [key]: finalMap[key] });
                let placed = false;

                for (let i = 0; i < newChunks.length; i++) {
                    const currentSize = i < newMeta.chunkSizes.length && newMeta.chunkSizes[i] > 0
                        ? newMeta.chunkSizes[i]
                        : this._byteLen(newChunks[i]);

                    if (currentSize + entrySize < CHUNK_SOFT_LIMIT_BYTES) {
                        newChunks[i][key] = finalMap[key];
                        modifiedChunks.add(i);
                        newMeta.chunkSizes[i] = this._byteLen(newChunks[i]);
                        _chunkIndexCache.set(key, i);
                        placed = true;
                        break;
                    }
                }

                if (!placed) {
                    const newIdx = newChunks.length;
                    newChunks.push({ [key]: finalMap[key] });
                    newMeta.chunkSizes.push(this._byteLen(newChunks[newIdx]));
                    newMeta.chunkCount = newIdx + 1;
                    modifiedChunks.add(newIdx);
                    _chunkIndexCache.set(key, newIdx);
                }
            }

            // === Phase C+D: 路徑選擇 — 單 chunk diff vs 多 chunk / 重新平衡 ===
            const isSingleChunkPath = modifiedChunks.size === 1
                && newMeta.chunkCount === metaCopy.chunkCount;

            if (isSingleChunkPath) {
                // 單 chunk diff 路徑：使用樂觀並發控制 + 有界重試 (Method D)
                // 無需鎖 — meta.version CAS 保證正確性
                const onlyChunkIdx = [...modifiedChunks][0];
                await this._writeChunkWithReconciliation({
                    chunkIdx: onlyChunkIdx,
                    applyDelta: (chunk) => {
                        for (const key of deletedKeys) delete chunk[key];
                        for (const key of changedKeys) chunk[key] = finalMap[key];
                        for (const key of addedKeys) chunk[key] = finalMap[key];
                    }
                });
                // 同步 _chunkIndexCache：刪除的 key 已在步驟 1 移除；重試時 _ensureChunkCachesLoaded
                // 會從 storage 重建快取，因此需要重新套用變更
                // 若 _chunkIndexCache 為 null（無重試時的初始狀態或快取失效），則重建
                if (_chunkIndexCache === null) {
                    _chunkIndexCache = new Map();
                }
                for (const key of deletedKeys) _chunkIndexCache.delete(key);
                for (const key of changedKeys) _chunkIndexCache.set(key, onlyChunkIdx);
                for (const key of addedKeys) _chunkIndexCache.set(key, onlyChunkIdx);
                return finalMap;
            }

            // 多 chunk / 重新平衡路徑：取得諮詢鎖 (Method C)
            return this._withChatPresetMapLock(async () => {
                // Bug 3: 在鎖內重新讀取最新 state，避免覆蓋其他 context 的寫入
                // 先清空快取再重新載入，確保不受外層程式碼污染（外層可能已刪除快取項目）
                _chunkIndexCache = null;
                _metaCache = null;
                await this._ensureChunkCachesLoaded();
                const { map: lockMap, metaCopy: lockMetaCopy, chunksByIdx: lockChunksByIdx } = await this._readAllChunks();

                // 在呼叫 mutator 前快照原始 state，因為 mutator 可能原地修改 map
                const lockSnapshotEntries = Object.entries(lockMap);
                const lockSnapshotMap = Object.fromEntries(lockSnapshotEntries);

                // 對最新 state 重新套用 mutator
                const lockResult = await mutator(lockMap);
                const lockFinalMap = lockResult === undefined ? lockMap : lockResult;

                // 使用快照計算差異
                const lockOldKeys = Object.keys(lockSnapshotMap);
                const lockNewKeys = Object.keys(lockFinalMap);
                const lockDeletedKeys = lockOldKeys.filter(k => !(k in lockFinalMap));
                const lockAddedKeys = lockNewKeys.filter(k => !(k in lockSnapshotMap));
                const lockChangedKeys = lockNewKeys.filter(k => k in lockSnapshotMap && lockSnapshotMap[k] !== lockFinalMap[k]);

                if (lockDeletedKeys.length === 0 && lockAddedKeys.length === 0 && lockChangedKeys.length === 0) {
                    return lockFinalMap;
                }

                // 建立工作副本
                const lockNewChunks = lockChunksByIdx.map(c => ({ ...c }));
                let lockNewMeta = _buildNextMeta(lockMetaCopy, {});
                const lockModifiedChunks = new Set();

                // 1. 刪除已移除的 uuid
                for (const key of lockDeletedKeys) {
                    if (_chunkIndexCache.has(key)) {
                        const idx = _chunkIndexCache.get(key);
                        if (idx < lockNewChunks.length) {
                            delete lockNewChunks[idx][key];
                            lockModifiedChunks.add(idx);
                        }
                        _chunkIndexCache.delete(key);
                    }
                }

                // 2. 原地更新已變更的 uuid
                for (const key of lockChangedKeys) {
                    if (_chunkIndexCache.has(key)) {
                        const idx = _chunkIndexCache.get(key);
                        if (idx < lockNewChunks.length) {
                            lockNewChunks[idx][key] = lockFinalMap[key];
                            lockModifiedChunks.add(idx);
                        }
                    }
                }

                // 3. 新增 uuid：先嘗試填入既有 chunk，否則附加新 chunk
                for (const key of lockAddedKeys) {
                    const entrySize = this._byteLen({ [key]: lockFinalMap[key] });
                    let placed = false;

                    for (let i = 0; i < lockNewChunks.length; i++) {
                        const currentSize = i < lockNewMeta.chunkSizes.length && lockNewMeta.chunkSizes[i] > 0
                            ? lockNewMeta.chunkSizes[i]
                            : this._byteLen(lockNewChunks[i]);

                        if (currentSize + entrySize < CHUNK_SOFT_LIMIT_BYTES) {
                            lockNewChunks[i][key] = lockFinalMap[key];
                            lockModifiedChunks.add(i);
                            lockNewMeta.chunkSizes[i] = this._byteLen(lockNewChunks[i]);
                            _chunkIndexCache.set(key, i);
                            placed = true;
                            break;
                        }
                    }

                    if (!placed) {
                        const newIdx = lockNewChunks.length;
                        lockNewChunks.push({ [key]: lockFinalMap[key] });
                        lockNewMeta.chunkSizes.push(this._byteLen(lockNewChunks[newIdx]));
                        lockNewMeta.chunkCount = newIdx + 1;
                        lockModifiedChunks.add(newIdx);
                        _chunkIndexCache.set(key, newIdx);
                    }
                }

                // 4. 重新計算被修改 chunk 的大小
                for (const idx of lockModifiedChunks) {
                    if (idx < lockNewChunks.length) {
                        lockNewMeta.chunkSizes[idx] = this._byteLen(lockNewChunks[idx]);
                    }
                }

                // 5. 移除尾部空 chunk
                while (lockNewMeta.chunkCount > 0) {
                    const lastIdx = lockNewMeta.chunkCount - 1;
                    if (Object.keys(lockNewChunks[lastIdx]).length === 0) {
                        lockNewChunks.pop();
                        lockNewMeta.chunkSizes.pop();
                        lockNewMeta.chunkCount--;
                    } else {
                        break;
                    }
                }

                // 6. 僅寫入有變更的 chunk + meta
                const items = {};
                let hasChanges = false;

                for (const idx of lockModifiedChunks) {
                    if (idx < lockNewChunks.length) {
                        items[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + idx] = lockNewChunks[idx];
                        hasChanges = true;
                    }
                }

                // 若新增了 chunk（超出原始 chunkCount）
                for (let i = lockMetaCopy.chunkCount; i < lockNewMeta.chunkCount; i++) {
                    items[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i] = lockNewChunks[i];
                    hasChanges = true;
                }

                // meta 有變（chunk 數量或大小改變）
                if (hasChanges) {
                    items[StorageManager.KEYS.CHAT_PRESET_MAP_META] = lockNewMeta;
                }

                if (hasChanges) {
                    await this._set(items);
                    _metaCache = lockNewMeta;
                }

                // 7. 清理被裁減的孤兒 chunk key
                if (lockNewMeta.chunkCount < lockMetaCopy.chunkCount) {
                    const orphanedKeys = [];
                    for (let i = lockNewMeta.chunkCount; i < lockMetaCopy.chunkCount; i++) {
                        orphanedKeys.push(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
                    }
                    await this._safeRemove('sync', orphanedKeys);
                    await this._safeRemove('local', orphanedKeys);
                }

                // 8. 重建 chunk 索引快取
                _chunkIndexCache = new Map();
                for (let i = 0; i < lockNewChunks.length; i++) {
                    for (const uuid of Object.keys(lockNewChunks[i])) {
                        _chunkIndexCache.set(uuid, i);
                    }
                }

                _metaCache = lockNewMeta;

                return lockFinalMap;
            });
        });
    },

    async saveChatPresetMap(map) {
        return this.mutateChatPresetMap(() => map);
    },

    async getChatPresetMap() {
        return _enqueueChatPresetMapWrite(async () => {
            const { map } = await this._readAllChunks();
            return map;
        });
    },

    async saveSidebarAutoHide(enabled) {
        return this._set({ [this.KEYS.SIDEBAR_AUTO_HIDE]: enabled });
    },

    async saveHideThinking(enabled) {
        return this._set({ [this.KEYS.HIDE_THINKING]: enabled });
    },

    async saveShowSystemTime(enabled) {
        return this._set({ [this.KEYS.SHOW_SYSTEM_TIME]: enabled });
    },

    getRestoredMessages() {
        return this._safeGet('local', this.KEYS.RESTORED_MESSAGES);
    },

    saveRestoredMessages(messages) {
        return this._safeSet('local', { [this.KEYS.RESTORED_MESSAGES]: messages });
    },

    async saveChatWidth(percent) {
        return this._set({ [this.KEYS.CHAT_WIDTH]: percent });
    },

    async saveChatWidthEnabled(enabled) {
        return this._set({ [this.KEYS.CHAT_WIDTH_ENABLED]: enabled });
    },

    async saveInputWidth(percent) {
        return this._set({ [this.KEYS.INPUT_WIDTH]: percent });
    },

    async saveInputWidthEnabled(enabled) {
        return this._set({ [this.KEYS.INPUT_WIDTH_ENABLED]: enabled });
    },

    async bindChatToPreset(uuid, presetId) {
        return _enqueueChatPresetMapWrite(async () => {
            await this._ensureChunkCachesLoaded();

            if (_chunkIndexCache.has(uuid)) {
                // UUID 已存在 — 原地更新 (Method D: reconciliation)
                const chunkIdx = _chunkIndexCache.get(uuid);
                const chunkKey = StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx;
                const raw = await this._get([chunkKey]);
                const chunk = raw[chunkKey] ?? {};
                if (chunk[uuid] !== presetId) {
                    await this._writeChunkWithReconciliation({
                        chunkIdx,
                        applyDelta: c => { c[uuid] = presetId; }
                    });
                }
                _chunkIndexCache.set(uuid, chunkIdx);
                return true;
            }

            // 新 UUID：使用快取的 meta 決定寫入目標，不讀取所有 chunk
            const entrySize = this._byteLen({ [uuid]: presetId });
            let targetIdx = -1;

            for (let i = 0; i < _metaCache.chunkSizes.length; i++) {
                if (_metaCache.chunkSizes[i] + entrySize < CHUNK_SOFT_LIMIT_BYTES) {
                    targetIdx = i;
                    break;
                }
            }

            if (targetIdx >= 0) {
                // 僅讀取目標 chunk (Method D: reconciliation)
                await this._writeChunkWithReconciliation({
                    chunkIdx: targetIdx,
                    applyDelta: c => { c[uuid] = presetId; }
                });
                _chunkIndexCache.set(uuid, targetIdx);
            } else {
                // 附加新 chunk — 改變 chunkCount，需取得諮詢鎖 (Method C)
                await this._withChatPresetMapLock(async () => {
                    // 在鎖內重新載入快取，避免 onChanged 併發寫入導致 _metaCache 為 null
                    await this._ensureChunkCachesLoaded();

                    const newIdx = _metaCache.chunkCount;
                    const newChunk = { [uuid]: presetId };
                    const newMeta = _buildNextMeta(_metaCache, {
                        chunkCount: newIdx + 1,
                        chunkSizes: [..._metaCache.chunkSizes, this._byteLen(newChunk)],
                    });

                    const items = {
                        [StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + newIdx]: newChunk,
                        [StorageManager.KEYS.CHAT_PRESET_MAP_META]: newMeta,
                    };
                    await this._set(items);
                    _metaCache = newMeta;
                    // 寫入可能觸發 onChanged（經由 _set 的 local backup），導致 _chunkIndexCache 被
                    // 快取失效監聽器設為 null（跨 context 情境）。若發生此情況，重新載入快取。
                    if (_chunkIndexCache === null) {
                        await this._ensureChunkCachesLoaded();
                    }
                    _chunkIndexCache.set(uuid, newIdx);
                });
            }

            return true;
        });
    },

    async unbindChat(uuid) {
        return _enqueueChatPresetMapWrite(async () => {
            await this._ensureChunkCachesLoaded();

            if (!_chunkIndexCache.has(uuid)) return true; // 無此 uuid，不做事

            const chunkIdx = _chunkIndexCache.get(uuid);
            const chunkKey = StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx;
            const raw = await this._get([chunkKey]);
            const chunk = raw[chunkKey] ?? {};

            if (!(uuid in chunk)) return true; // 已被刪除

            delete chunk[uuid];
            // _get 可能觸發 onChanged → 快取失效監聽器將 _chunkIndexCache 設為 null
            if (_chunkIndexCache === null) {
                await this._ensureChunkCachesLoaded();
            }
            _chunkIndexCache.delete(uuid);

            const isEmpty = Object.keys(chunk).length === 0;

            if (isEmpty && chunkIdx === _metaCache.chunkCount - 1) {
                // 尾部空 chunk：階層式清除連續空 chunk — 改變 chunkCount，需取得諮詢鎖 (Method C)
                await this._withChatPresetMapLock(async () => {
                    const { chunksByIdx } = await this._readAllChunks();

                    // 從尾部開始尋找最後一個非空 chunk
                    let lastNonEmptyIdx = -1;
                    for (let i = chunksByIdx.length - 1; i >= 0; i--) {
                        if (Object.keys(chunksByIdx[i]).length > 0) {
                            lastNonEmptyIdx = i;
                            break;
                        }
                    }

                    const newChunkCount = lastNonEmptyIdx + 1;
                    const orphanedKeys = [];
                    for (let i = newChunkCount; i < _metaCache.chunkCount; i++) {
                        orphanedKeys.push(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
                    }

                    const newMeta = _buildNextMeta(_metaCache, { chunkCount: newChunkCount, chunkSizes: _metaCache.chunkSizes.slice(0, newChunkCount) });

                    if (orphanedKeys.length > 0) {
                        await this._safeRemove('sync', orphanedKeys);
                        await this._safeRemove('local', orphanedKeys);
                    }

                    await this._set({ [StorageManager.KEYS.CHAT_PRESET_MAP_META]: newMeta });
                    _metaCache = newMeta;
                });
            } else {
                // 非尾部空 chunk：使用 reconciliation 更新 (Method D)
                await this._writeChunkWithReconciliation({
                    chunkIdx,
                    applyDelta: c => { delete c[uuid]; }
                });
            }

            return true;
        });
    },

    /**
     * Restore all settings from an imported JSON object
     * @param {Object} importedSettings
     * @param {boolean} mergePresetsOnly - If true, only merge presets and don't overwrite UI settings
     */
    async restoreSettings(importedSettings, mergePresetsOnly = false) {
        const currentSettings = await this.getSettings();
        const updates = {};

        // Merge prompt presets
        if (importedSettings.promptPresets) {
            const mergedPresets = this.mergePresets(currentSettings.promptPresets, importedSettings.promptPresets);
            await this.savePromptPresets(mergedPresets);
        }

        // 透過 mutateChatPresetMap 將匯入的 chatPresetMap 合併至現有資料
        if (importedSettings.chatPresetMap) {
            await this.mutateChatPresetMap(map => ({
                ...map,
                ...importedSettings.chatPresetMap
            }));
        }

        // 其餘設定直接覆寫，除非 mergePresetsOnly 為 true
        if (!mergePresetsOnly) {
            if (importedSettings.activePresetId !== undefined) updates[this.KEYS.ACTIVE_PRESET_ID] = importedSettings.activePresetId;
            if (importedSettings.isEnabled !== undefined) updates[this.KEYS.IS_ENABLED] = importedSettings.isEnabled;
            if (importedSettings.includeThinking !== undefined) updates[this.KEYS.INCLUDE_THINKING] = importedSettings.includeThinking;
            if (importedSettings.includeReferences !== undefined) updates[this.KEYS.INCLUDE_REFERENCES] = importedSettings.includeReferences;
            if (importedSettings.globalDefaultPrompt !== undefined) updates[this.KEYS.GLOBAL_DEFAULT_PROMPT] = importedSettings.globalDefaultPrompt;
            if (importedSettings.sidebarAutoHide !== undefined) updates[this.KEYS.SIDEBAR_AUTO_HIDE] = importedSettings.sidebarAutoHide;
            if (importedSettings.hideThinking !== undefined) updates[this.KEYS.HIDE_THINKING] = importedSettings.hideThinking;
            if (importedSettings.showSystemTime !== undefined) updates[this.KEYS.SHOW_SYSTEM_TIME] = importedSettings.showSystemTime;
            if (importedSettings.chatWidth !== undefined) updates[this.KEYS.CHAT_WIDTH] = importedSettings.chatWidth;
            if (importedSettings.chatWidthEnabled !== undefined) updates[this.KEYS.CHAT_WIDTH_ENABLED] = importedSettings.chatWidthEnabled;
            if (importedSettings.inputWidth !== undefined) updates[this.KEYS.INPUT_WIDTH] = importedSettings.inputWidth;
            if (importedSettings.inputWidthEnabled !== undefined) updates[this.KEYS.INPUT_WIDTH_ENABLED] = importedSettings.inputWidthEnabled;
            if (importedSettings.globalPromptEnabled !== undefined) updates[this.KEYS.GLOBAL_PROMPT_ENABLED] = importedSettings.globalPromptEnabled;
        }

        if (Object.keys(updates).length > 0) {
            return this._set(updates);
        }
    }
};

// Make it available globally depending on context
if (typeof window !== 'undefined') {
    window.StorageManager = StorageManager;
}

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
}
