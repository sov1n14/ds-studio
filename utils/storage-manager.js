/**
 * DS studio v2.5.2 — Storage Manager（入口檔）
 * Wrapper for Chrome Storage API with Sync support and Local fallback.
 *
 * 載入順序（manifest.json / popup.html / editor.html 必須依此順序）：
 *   1. storage-manager.chunking.js
 *   2. storage-manager.lock.js
 *   3. storage-manager.sync.js
 *   4. storage-manager.presets.js
 *   5. storage-manager.js  （本檔）
 */

// === 錯誤類別（供 instanceof 檢查） ===

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

// === 單一事實來源 helper：遞增 meta 版號 ===

/**
 * 基於前一版 meta 遞增版號並選擇性覆寫 chunkCount / chunkSizes。
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
        PRESET_ORDER_META: 'dsPresetOrderMeta',
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
        dsPresetOrderMeta: { order: [], orderUpdatedAt: 0 },
        restored_messages: {},
    },

    /**
     * Typed error constructors for instanceof checks by callers and tests.
     */
    errors: {
        LockAcquireTimeoutError,
        WriteReconciliationExhaustedError,
    },

    // === 提升至物件的私有狀態 ===

    /**
     * 單一事實來源 meta 版號遞增 helper（從模組層級提升，供 bundle 方法存取）。
     */
    _buildNextMeta,

    /**
     * chatPresetMap 分塊索引快取。Map<uuid, chunkIdx> | null 表示需重新載入。
     * 由 bundle 方法透過 this._chunkIndexCache 存取。
     */
    _chunkIndexCache: null,

    /**
     * chatPresetMap meta 快取。{ version, chunkCount, chunkSizes[] } | null 表示需重新載入。
     * 由 bundle 方法透過 this._metaCache 存取。
     */
    _metaCache: null,

    /**
     * 內部 promise-chain 寫入佇列，用於序列化 chatPresetMap 的寫入操作，
     * 避免同 context 內的競爭條件（race condition）。
     */
    _chatPresetMapChainTail: Promise.resolve(),

    /**
     * 將 taskFn 加入 chatPresetMap 寫入佇列的尾部，確保依序執行。
     * 佇列中的任一任務失敗不會影響後續任務。
     * @param {Function} taskFn - 非同步函式，回傳 Promise
     * @returns {Promise} 該任務的 Promise
     */
    _enqueueChatPresetMapWrite(taskFn) {
        const next = this._chatPresetMapChainTail.then(taskFn, taskFn);
        this._chatPresetMapChainTail = next.catch(() => {}); // 隔離連鎖失敗
        return next;
    },

    // --- Helper methods ---

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
     * NOTE: File exceeds 450-line threshold. Net additions kept minimal; see chatmap.js split.
     */
    async _get(keys) {
        const localStatus = await this._safeGet('local', [this.KEYS.SYNC_CONFLICT_PENDING, this.KEYS.LOCAL_AUTHORITATIVE]);
        const isConflictPending = localStatus[this.KEYS.SYNC_CONFLICT_PENDING] === true;
        const localAuth = localStatus[this.KEYS.LOCAL_AUTHORITATIVE] || [];

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
        globalThis.__DS_Logger?.sync('pull:merge', { source: 'sync-wins', keys: Object.keys(sData) });

        // === 逐筆 preset 依 updatedAt 挑最新版本，避免 Chrome 同步收斂時以較舊版本覆蓋較新編輯 ===
        for (const key of Object.keys(merged)) {
            if (!key.startsWith('dsPreset_')) continue;
            const localPreset = lData[key];
            const syncPreset = sData[key];
            if (localPreset === undefined || syncPreset === undefined) continue; // 僅在兩端都存在時比較
            const winner = this._pickNewerPreset(localPreset, syncPreset);
            if (winner === localPreset && merged[key] !== localPreset) {
                merged[key] = localPreset;
                globalThis.__DS_Logger?.sync('pull:recency-local', { key, localTs: localPreset.updatedAt || 0, syncTs: syncPreset.updatedAt || 0 });
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
            }
        }

        // === dsLocalAuth 精確 pinning：依資料類型選擇性覆寫 ===
        if (localAuth.length > 0) {
            const localOrderMeta = lData[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            const syncOrderMeta = sData[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };

            for (const key of (Array.isArray(effectiveKeys) ? effectiveKeys : Object.keys(sData))) {
                if (!localAuth.includes(key) || lData[key] === undefined) continue;

                if (key === this.KEYS.PRESET_INDEX) {
                    // 僅在本地順序至少與同步端同新時才 pin 本地順序
                    if ((localOrderMeta.orderUpdatedAt || 0) >= (syncOrderMeta.orderUpdatedAt || 0)) {
                        merged[key] = lData[key];
                        globalThis.__DS_Logger?.sync('pull:pin-local', { key, localTs: localOrderMeta.orderUpdatedAt, syncTs: syncOrderMeta.orderUpdatedAt });
                    }
                } else if (key.startsWith('dsPreset_')) {
                    // 僅在本地 preset 至少與同步端同新時才 pin
                    const localPreset = lData[key];
                    const syncPreset = sData[key];
                    if (this._shouldPinLocalPreset(localPreset, syncPreset)) {
                        merged[key] = lData[key];
                        globalThis.__DS_Logger?.sync('pull:pin-local', { key, localTs: (localPreset && localPreset.updatedAt) || 0, syncTs: (syncPreset && syncPreset.updatedAt) || 0, reason: syncPreset ? 'local-newer-or-equal' : 'sync-missing' });
                    }
                } else {
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
        globalThis.__DS_Logger?.sync('push:attempt', { keys: keysWritten, bytes: this._byteLen(items) });

        const syncError = await new Promise((resolve) => {
            try {
                chrome.storage.sync.set(items, () => {
                    resolve(chrome.runtime.lastError || null);
                });
            } catch (e) {
                resolve(e); // Context invalidated — fall through to local-write fallback below
            }
        });

        const localStatus = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
        let localAuth = localStatus[this.KEYS.LOCAL_AUTHORITATIVE] || [];

        if (syncError) {
            console.warn('Sync storage failed (possibly quota exceeded), falling back to local storage:', syncError?.message ?? 'Unknown error');
            globalThis.__DS_Logger?.warn('push:quota-fail', { keys: keysWritten, error: syncError?.message ?? 'Unknown error' });

            // Add these keys to local authoritative list
            keysWritten.forEach(k => {
                if (!localAuth.includes(k)) localAuth.push(k);
            });

            return this._safeSet('local', { ...items, [this.KEYS.LOCAL_AUTHORITATIVE]: localAuth });
        } else {
            globalThis.__DS_Logger?.sync('push:ok', { keys: keysWritten });
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

    /**
     * 計算 JSON 序列化後的位元組長度（用於分塊大小估算）。
     */
    _byteLen(obj) { return JSON.stringify(obj).length; },

    /**
     * 安裝 chunk 快取失效監聽器。
     * 其他 context 修改分塊時，自動將 _chunkIndexCache 與 _metaCache 設為 null。
     */
    _installChunkCacheInvalidator() {
        chrome.storage.onChanged.addListener((changes) => {
            const keys = Object.keys(changes);
            const touched = keys.some(k =>
                k === StorageManager.KEYS.CHAT_PRESET_MAP_META ||
                k.startsWith(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX)
            );
            if (touched) {
                StorageManager._chunkIndexCache = null;
                StorageManager._metaCache = null;
            }
        });
    },

    /**
     * Initialize default values if not present, migrate old data if needed
     */
    async initialize() {
        // Cross-context/re-init defense: 強制清除物件層級快取，避免讀取到過期資料
        this._metaCache = null;
        this._chunkIndexCache = null;

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
            const conflictType = this._detectSyncConflict(syncRaw, localRaw);

            if (conflictType === 'manual') {
                await this._safeSet('local', { [this.KEYS.SYNC_CONFLICT_PENDING]: true });
            } else if (conflictType === 'auto') {
                await this.resolveSyncConflict();
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
                    name: dsI18n.t('migratedPresetName'),
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
};

// === Bundle 合併：將各方法群組的方法 mixin 至 StorageManager ===
(function (root) {
    Object.assign(StorageManager,
        root.__DS_StorageManager_chunking || {},
        root.__DS_StorageManager_lock     || {},
        root.__DS_StorageManager_sync     || {},
        root.__DS_StorageManager_presets  || {},
        root.__DS_StorageManager_chatmap  || {}
    );
})(typeof globalThis !== 'undefined' ? globalThis : window);

// Make it available globally depending on context
if (typeof window !== 'undefined') {
    window.StorageManager = StorageManager;
}

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageManager;
}
