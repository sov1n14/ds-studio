/**
 * DS Studio — StorageManager 初始化與資料遷移方法群組
 * 負責 initialize()：預設值補齊、跨版本資料遷移（promptPresets /
 * chatPresetMap 分塊化）、chatPresetMap 孤兒綁定清理與首次同步衝突偵測。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * Initialize default values if not present, migrate old data if needed
         */
        async initialize() {
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

            // 2.5. Migration: legacy chatPresetMap → 分塊式佈局，交由 service worker 單一寫入者執行；僅在任一側仍有 legacy 金鑰時分派，失敗僅告警，不中斷初始化。
            const legacyKey = this.KEYS.CHAT_PRESET_MAP;
            const hasLegacy = (await this._safeGet('sync', [legacyKey]))[legacyKey] !== undefined
                || (await this._safeGet('local', [legacyKey]))[legacyKey] !== undefined;
            if (hasLegacy) {
                try {
                    await this.migrateLegacyChatPresetMap();
                } catch (err) {
                    globalThis.__DS_Logger?.warn('init:migrate-legacy-failed', { error: err?.message ?? String(err) });
                }
            }

            // 3. 若尚未有預設集索引，補上預設值（原 v1.2.x promptPrefix 遷移分支已移除）
            if (data[this.KEYS.PRESET_INDEX] === undefined) {
                updates[this.KEYS.PRESET_INDEX] = this.DEFAULTS.dsPresetIndex;
                updates[this.KEYS.ACTIVE_PRESET_ID] = this.DEFAULTS.activePresetId;
            }

            // 4. Fill other defaults
            // isEnabled / globalPromptEnabled / isReplyNotificationEnabled 為 local-only 金鑰，需另外以本機資料補齊預設值，
            // 不可併入 updates（updates 會經 _set 推送至 sync）。
            const localOnlyUpdates = {};
            const localOnlyKeys = [this.KEYS.IS_ENABLED, this.KEYS.GLOBAL_PROMPT_ENABLED, this.KEYS.REPLY_NOTIFICATION];
            const localOnlyData = await this._safeGet('local', localOnlyKeys);
            for (const key of localOnlyKeys) {
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
                if (localOnlyKeys.includes(key)) continue; // local-only，已於上方處理
                if (data[key] === undefined && this.DEFAULTS[key] !== undefined) {
                    updates[key] = this.DEFAULTS[key];
                }
            }

            if (Object.keys(updates).length > 0) {
                await this._set(updates);
            } else if (syncInitialized) {
                // Ensure sync has what local has (migration push)
                // 一併讀取各 preset 的雲端版本，供下方推送守衛比對新舊（同 savePromptPresets 的單次目標讀取）
                // Stryker disable next-line ArrayDeclaration: 等價變異 — 索引為 undefined 時已由步驟 3 走 _set 分支，此 fallback 僅於索引為 null 等假值時觸發；替換成非空陣列只多讀一個本機不存在的 preset 金鑰，localPreset 為 undefined 而不推送，儲存結果相同
                const localIds = data[this.KEYS.PRESET_INDEX] || [];
                const presetKeys = localIds.map(id => this._presetKey(id));
                const syncData = await this._safeGet('sync', [...keysToFetch, ...presetKeys]);
                const missingInSync = {};
                for (const key of keysToFetch) {
                    if (this._isChatMapKey(key)) continue; // chat-map 金鑰僅由 service worker 單一寫入者寫入
                    if (key === this.KEYS.PROMPT_PRESETS
                     || key === this.KEYS.RESTORED_MESSAGES
                     || localOnlyKeys.includes(key)) continue; // local-only，不推送至 sync
                    if (syncData[key] === undefined && data[key] !== undefined) {
                        missingInSync[key] = data[key];
                    }
                }

                // Also check individual presets：僅在雲端缺少或本機較新時推送，不覆蓋較新的雲端版本
                for (const pKey of presetKeys) {
                    const pData = await this._safeGet('local', pKey);
                    const localPreset = pData[pKey];
                    if (localPreset && this._shouldPushPreset(localPreset, syncData[pKey])) {
                        missingInSync[pKey] = localPreset;
                    }
                }

                if (Object.keys(missingInSync).length > 0) {
                    await this._set(missingInSync);
                }
            }

            // 5. 清除指向已刪除提示詞組的 chatPresetMap 孤兒綁定。
            // 索引為空時一律跳過：空索引代表索引尚未載入或仍在遷移中（並非「使用者刪光提示詞組」），
            // 此時修剪會清空所有綁定，故以資料保全優先。
            const validPresetIds = data[this.KEYS.PRESET_INDEX] || this.DEFAULTS.dsPresetIndex;
            // 修剪交由 service worker 單一寫入者以最新索引執行；失敗僅告警，不中斷初始化。
            if (validPresetIds.length > 0) {
                try {
                    await this.pruneOrphanChatBindings();
                } catch (err) {
                    globalThis.__DS_Logger?.warn('init:prune-orphans-failed', { error: err?.message ?? String(err) });
                }
            }
        },
    };

    root.__DS_StorageManager_init = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
