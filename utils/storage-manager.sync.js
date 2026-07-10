/**
 * DS Studio — StorageManager 雲端同步方法群組
 * 負責同步衝突解決、設定還原、同步狀態查詢與重試。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * 分析 sync 與 local 的 raw storage 資料，回傳衝突類型。
         * @param {Object} syncRaw - 來自 chrome.storage.sync.get(null) 的完整資料
         * @param {Object} localRaw - 來自 chrome.storage.local.get(null) 的完整資料
         * @returns {'none'|'auto'|'manual'}
         *   'none'  — 無分歧，不需處理
         *   'auto'  — 有分歧但所有衝突可自動解決（updatedAt 嚴格不同）
         *   'manual'— 存在同一 id 雙側 updatedAt 相同但內容不同的衝突，需使用者確認
         */
        _detectSyncConflict(syncRaw, localRaw) {
            const hasCloudData = syncRaw[this.KEYS.PRESET_INDEX] !== undefined;
            if (!hasCloudData) return 'none';

            const syncIds = syncRaw[this.KEYS.PRESET_INDEX] || [];
            const localIds = localRaw[this.KEYS.PRESET_INDEX] || [];
            const allIds = [...new Set([...syncIds, ...localIds])];

            const syncOrderMeta = syncRaw[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            const localOrderMeta = localRaw[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };

            let hasAnyDivergence = false;

            for (const id of allIds) {
                const syncPreset = syncRaw[this._presetKey(id)];
                const localPreset = localRaw[this._presetKey(id)];

                if (!syncPreset || !localPreset) {
                    if (syncPreset || localPreset) hasAnyDivergence = true;
                    continue;
                }

                const syncTs = syncPreset.updatedAt || 0;
                const localTs = localPreset.updatedAt || 0;

                if (syncTs === localTs) {
                    const isSameContent = JSON.stringify(syncPreset) === JSON.stringify(localPreset);
                    globalThis.__DS_Logger?.sync('conflict:preset', { id, syncTs, localTs, sameContent: isSameContent });
                    if (!isSameContent) {
                        globalThis.__DS_Logger?.sync('conflict:result', { type: 'manual', reason: 'same-ts-diff-content' });
                        return 'manual';
                    }
                } else {
                    globalThis.__DS_Logger?.sync('conflict:preset', { id, syncTs, localTs, sameContent: false });
                    hasAnyDivergence = true;
                }
            }

            if (syncOrderMeta.orderUpdatedAt !== localOrderMeta.orderUpdatedAt) {
                hasAnyDivergence = true;
            } else if (JSON.stringify(syncIds) !== JSON.stringify(localIds)) {
                hasAnyDivergence = true;
            }

            const conflictResult = hasAnyDivergence ? 'auto' : 'none';
            globalThis.__DS_Logger?.sync('conflict:result', { type: conflictResult, reason: 'divergence-scan' });
            return conflictResult;
        },

        /**
         * 檢查是否有待處理的同步衝突。
         * @returns {Promise<boolean>}
         */
        async checkSyncConflictPending() {
            const state = await this._safeGet('local', [this.KEYS.SYNC_CONFLICT_PENDING]);
            return state[this.KEYS.SYNC_CONFLICT_PENDING] === true;
        },

        /**
         * 透過合併雲端資料解決同步衝突，並將合併結果寫回 storage。
         */
        async resolveSyncConflict() {
            const syncRaw = await this._safeGet('sync', null);
            const localRaw = await this._safeGet('local', null);

            const syncPresets = this._getPresetsFromRawStorage(syncRaw);
            const localPresets = this._getPresetsFromRawStorage(localRaw);

            const localOrderMeta = localRaw[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            const syncOrderMeta = syncRaw[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };

            const mergedPresets = this.mergePresets(localPresets, syncPresets, localOrderMeta, syncOrderMeta);
            globalThis.__DS_Logger?.sync('merge:summary', { localCount: localPresets.length, syncCount: syncPresets.length, mergedCount: mergedPresets.length, mergedOrderUpdatedAt: Math.max(localOrderMeta.orderUpdatedAt || 0, syncOrderMeta.orderUpdatedAt || 0) });

            // 計算合併後的 order meta：取雙側時間戳最大值，至少為當下時間
            const mergedMeta = {
                order: mergedPresets.map(p => p.id),
                orderUpdatedAt: Math.max(
                    localOrderMeta.orderUpdatedAt || 0,
                    syncOrderMeta.orderUpdatedAt || 0,
                    Date.now()
                ),
            };

            // 1. 儲存合併後的 presets 與解決後的 order meta
            await this.savePromptPresets(mergedPresets, mergedMeta);

            // 2. 解決其他設定：雲端設定覆寫本機 UI 設定
            const updates = { ...localRaw, ...syncRaw };

            // 清理：若舊金鑰存在則移除
            delete updates[this.KEYS.PROMPT_PRESETS];

            // 避免以原始資料覆蓋剛儲存的 presets
            const presetIds = mergedPresets.map(p => p.id);
            delete updates[this.KEYS.PRESET_INDEX];
            delete updates[this.KEYS.PRESET_ORDER_META]; // savePromptPresets 已正確寫入此金鑰
            presetIds.forEach(id => delete updates[this._presetKey(id)]);
            // 同時移除 raw data 中殘留的 dsPreset_ 金鑰
            Object.keys(updates).forEach(k => {
                if (k.startsWith('dsPreset_')) delete updates[k];
            });

            // restored_messages 僅存本機且可能超過 8KB 同步配額，排除以避免失敗
            delete updates[this.KEYS.RESTORED_MESSAGES];

            updates[this.KEYS.SYNC_INITIALIZED] = true;
            updates[this.KEYS.SYNC_CONFLICT_PENDING] = false;

            return this._set(updates);
        },

        /**
         * 回傳 true 表示所有金鑰均已成功同步至雲端（無待重試項目）。
         * @returns {Promise<boolean>}
         */
        async isSyncedWithCloud() {
            const data = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
            const arr = data[this.KEYS.LOCAL_AUTHORITATIVE] || [];
            return arr.length === 0;
        },

        /**
         * 重試將所有本機授權金鑰寫回 sync storage。
         * 推送前先比對雲端時間戳，避免以舊本機資料覆蓋較新的雲端資料。
         * @returns {Promise<{ success: boolean, remainingUnsyncedCount: number }>}
         */
        async retrySync() {
            const data = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
            const pendingKeys = data[this.KEYS.LOCAL_AUTHORITATIVE] || [];

            // 預先讀取雲端快照，避免推送舊本機資料覆蓋較新的雲端資料
            const syncSnapshot = pendingKeys.length > 0
                ? await new Promise(resolve => {
                    try {
                        chrome.storage.sync.get(pendingKeys, d => resolve(d || {}));
                    } catch { resolve({}); }
                })
                : {};

            // 讀取雙側 order meta，供 PRESET_INDEX 比對使用
            let localOrderMeta = { order: [], orderUpdatedAt: 0 };
            let syncOrderMeta = { order: [], orderUpdatedAt: 0 };
            if (pendingKeys.includes(this.KEYS.PRESET_INDEX)) {
                const [lMeta, sMeta] = await Promise.all([
                    this._safeGet('local', [this.KEYS.PRESET_ORDER_META]),
                    new Promise(resolve => {
                        try {
                            chrome.storage.sync.get([this.KEYS.PRESET_ORDER_META], d => resolve(d || {}));
                        } catch { resolve({}); }
                    }),
                ]);
                localOrderMeta = lMeta[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
                syncOrderMeta = sMeta[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            }

            for (const key of pendingKeys) {
                const localData = await this._safeGet('local', [key]);
                if (localData[key] !== undefined) {
                    let shouldPush = true;

                    if (key === this.KEYS.PRESET_INDEX) {
                        // 僅在本機排序至少與雲端同新時才推送
                        const localOrderTs = localOrderMeta.orderUpdatedAt || 0;
                        const syncOrderTs = syncOrderMeta.orderUpdatedAt || 0;
                        shouldPush = localOrderTs >= syncOrderTs;
                        globalThis.__DS_Logger?.sync('push:order-cmp', { localOrderTs, syncOrderTs, shouldPush });
                    } else if (key.startsWith('dsPreset_')) {
                        // 僅在本機 preset 至少與雲端同新時才推送
                        const localPreset = localData[key];
                        const syncPreset = syncSnapshot[key];
                        if (syncPreset && (syncPreset.updatedAt || 0) > (localPreset.updatedAt || 0)) {
                            shouldPush = false;
                        }
                        globalThis.__DS_Logger?.sync('push:preset-cmp', { id: key, localTs: localPreset?.updatedAt || 0, syncTs: syncPreset?.updatedAt || 0, shouldPush });
                    }

                    if (shouldPush) {
                        await this._set({ [key]: localData[key] });
                    }
                } else {
                    // 金鑰在離線期間於本機被刪除：清理 sync 與追蹤記錄
                    await this._safeRemove('sync', [key]);
                    const current = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
                    const newArr = (current[this.KEYS.LOCAL_AUTHORITATIVE] || []).filter(k => k !== key);
                    await this._safeSet('local', { [this.KEYS.LOCAL_AUTHORITATIVE]: newArr });
                }
            }

            // 推送完成後，若雲端有較新變更則從雲端拉取
            const syncRaw = await this._safeGet('sync', null);
            const localRaw = await this._safeGet('local', null);
            const conflictType = this._detectSyncConflict(syncRaw, localRaw);
            if (conflictType === 'auto') {
                await this.resolveSyncConflict();
            }

            const after = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
            const remainingUnsyncedCount = (after[this.KEYS.LOCAL_AUTHORITATIVE] || []).length;
            return { success: remainingUnsyncedCount === 0, remainingUnsyncedCount };
        },

        /**
         * 從匯入的 JSON 物件還原所有設定。
         * @param {Object} importedSettings
         * @param {boolean} mergePresetsOnly - 若為 true，僅合併 presets 而不覆寫 UI 設定
         */
        async restoreSettings(importedSettings, mergePresetsOnly = false) {
            const currentSettings = await this.getSettings();
            const updates = {};

            // 合併 prompt presets
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
        },

        /**
         * Get all settings
         * @returns {Promise<Object>} Object containing all settings
         */
        async getSettings() {
            // 排除非使用者設定的內部金鑰，避免不必要的儲存讀取與記憶體開銷
            const keysToFetch = Object.values(this.KEYS)
                .filter(k => k !== this.KEYS.RESTORED_MESSAGES && k !== this.KEYS.PRESET_ORDER_META);
            const data = await this._get(keysToFetch);

            // Fetch individual presets based on index
            const presetIds = data[this.KEYS.PRESET_INDEX] || [];
            const presetData = await this._get(presetIds.map(id => this._presetKey(id)));
            const presets = presetIds.map(id => presetData[this._presetKey(id)]).filter(Boolean);

            const settings = {};
            for (const [internalKey, storageKey] of Object.entries(this.KEYS)) {
                // 跳過內部專用金鑰，不納入使用者設定回傳值
                if (storageKey === this.KEYS.RESTORED_MESSAGES) continue;
                if (storageKey === this.KEYS.PRESET_ORDER_META) continue;

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
    };

    root.__DS_StorageManager_sync = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
