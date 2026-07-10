/**
 * DS Studio — StorageManager 初始化與資料遷移方法群組
 * 負責 initialize()：預設值補齊、跨版本資料遷移（promptPresets / promptPrefix /
 * chatPresetMap 分塊化）、首次同步衝突偵測，以及 chunk 快取失效監聽器安裝。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * 安裝 chunk 快取失效監聽器。
         * 其他 context 修改分塊時，自動將 _chunkIndexCache 與 _metaCache 設為 null。
         */
        _installChunkCacheInvalidator() {
            // 綁定至呼叫時的 this（即目前 context 自己的 StorageManager 實例），
            // 不可改用裸露的全域識別字 StorageManager —— 拆檔後 StorageManager
            // 已非本模組的區域繫結，裸露參照會經由 window.StorageManager 解析，
            // 而該屬性在多 context 測試情境下永遠指向「最後一次載入」的實例，
            // 導致監聽器誤將另一個 context 的快取清空，自己的快取卻從未失效。
            const self = this;
            chrome.storage.onChanged.addListener((changes) => {
                const keys = Object.keys(changes);
                const touched = keys.some(k =>
                    k === self.KEYS.CHAT_PRESET_MAP_META ||
                    k.startsWith(self.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX)
                );
                if (touched) {
                    self._chunkIndexCache = null;
                    self._metaCache = null;
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
            // isEnabled / globalPromptEnabled 為 local-only 金鑰，需另外以本機資料補齊預設值，
            // 不可併入 updates（updates 會經 _set 推送至 sync）。
            const localOnlyUpdates = {};
            const localOnlyData = await this._safeGet('local', [this.KEYS.IS_ENABLED, this.KEYS.GLOBAL_PROMPT_ENABLED]);
            for (const key of [this.KEYS.IS_ENABLED, this.KEYS.GLOBAL_PROMPT_ENABLED]) {
                if (localOnlyData[key] === undefined && this.DEFAULTS[key] !== undefined) {
                    localOnlyUpdates[key] = this.DEFAULTS[key];
                }
            }
            if (Object.keys(localOnlyUpdates).length > 0) {
                await this._safeSet('local', localOnlyUpdates);
            }

            for (const key of keysToFetch) {
                if (key === this.KEYS.PROMPT_PRESETS) continue; // 跳過已退役的金鑰
                if (key === this.KEYS.CHAT_PRESET_MAP) continue; // 跳過已分塊處理的金鑰
                if (key === this.KEYS.IS_ENABLED || key === this.KEYS.GLOBAL_PROMPT_ENABLED) continue; // local-only，已於上方處理
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
                     || key === this.KEYS.RESTORED_MESSAGES
                     || key === this.KEYS.IS_ENABLED
                     || key === this.KEYS.GLOBAL_PROMPT_ENABLED) continue; // local-only，不推送至 sync
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
    };

    root.__DS_StorageManager_init = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
