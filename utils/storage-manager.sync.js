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
                    if (!isSameContent) {
                        return 'manual';
                    }
                } else {
                    hasAnyDivergence = true;
                }
            }

            if (syncOrderMeta.orderUpdatedAt !== localOrderMeta.orderUpdatedAt) {
                hasAnyDivergence = true;
            } else if (JSON.stringify(syncIds) !== JSON.stringify(localIds)) {
                hasAnyDivergence = true;
            }

            const conflictResult = hasAnyDivergence ? 'auto' : 'none';
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

            // 合併雙側 tombstone（同 id 取較新刪除時間戳）並清除過期記錄，
            // 供 mergePresets() 判斷哪些 id 應被視為「已刪除」而排除於合併結果之外。
            const localTombstones = localRaw[this.KEYS.PRESET_TOMBSTONES] || {};
            const syncTombstones = syncRaw[this.KEYS.PRESET_TOMBSTONES] || {};
            const mergedTombstones = this._pruneTombstones(this._mergeTombstones(localTombstones, syncTombstones));

            const mergedPresets = this.mergePresets(localPresets, syncPresets, localOrderMeta, syncOrderMeta, mergedTombstones);

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

            // 1.5 持久化合併後的 tombstones 至兩側 storage，供跨裝置刪除傳播使用
            //     （經由既有 _set() 的 8KB 守衛與重試佇列邏輯，不重新實作寫入守衛）
            await this._set({ [this.KEYS.PRESET_TOMBSTONES]: mergedTombstones });

            // 2. 解決其他設定：雲端設定覆寫本機 UI 設定
            // 只保留 StorageManager 實際擁有的金鑰（KEYS 靜態成員 + dsPreset_ 動態 preset 金鑰）。
            // 原因：localRaw/syncRaw 是 chrome.storage.*.get(null) 的完整未過濾快照，
            // 可能內含其他模組自行管理的 chrome.storage.local 金鑰（例如
            // content/temporary-chat-toggle.js 的 dss-temporary-chat-enabled）。
            // 若直接 spread 整包快照，這些「外來金鑰」會被誤判為需調和的資料，
            // 導致某一側的舊值透過此處寫回而復活、覆蓋另一側裝置剛設定的新值。
            // 因此改為以 ownership 白名單重建 updates，而非直接展開原始快照。
            const ownedKeys = new Set(Object.values(this.KEYS));
            const isOwnedKey = (key) => ownedKeys.has(key) || key.startsWith(this.PRESET_KEY_PREFIX);
            const updates = {};
            for (const key of Object.keys(localRaw)) {
                if (isOwnedKey(key)) updates[key] = localRaw[key];
            }
            for (const key of Object.keys(syncRaw)) {
                if (isOwnedKey(key)) updates[key] = syncRaw[key];
            }

            // 清理：若舊金鑰存在則移除
            delete updates[this.KEYS.PROMPT_PRESETS];

            // 避免以原始資料覆蓋剛儲存的 presets
            const presetIds = mergedPresets.map(p => p.id);
            delete updates[this.KEYS.PRESET_INDEX];
            delete updates[this.KEYS.PRESET_ORDER_META]; // savePromptPresets 已正確寫入此金鑰
            delete updates[this.KEYS.PRESET_TOMBSTONES]; // 已於上方寫入合併後的版本，避免被 raw data 覆蓋
            presetIds.forEach(id => delete updates[this._presetKey(id)]);
            // 同時移除 raw data 中殘留的 dsPreset_ 金鑰
            Object.keys(updates).forEach(k => {
                if (k.startsWith(this.PRESET_KEY_PREFIX)) delete updates[k];
            });

            // restored_messages 僅存本機且可能超過 8KB 同步配額，排除以避免失敗
            delete updates[this.KEYS.RESTORED_MESSAGES];

            // isEnabled / globalPromptEnabled 為裝置層級的本機開關（local-only），
            // 不應被雲端版本覆寫，故排除於合併結果之外。
            delete updates[this.KEYS.IS_ENABLED];
            delete updates[this.KEYS.GLOBAL_PROMPT_ENABLED];

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
         * 回傳 true 表示存在因永久超過 8KB 而被攔截、無法同步至雲端的項目。
         * 與 isSyncedWithCloud() 的「待重試」狀態互斥判斷，供 UI 呈現不同的警示。
         * @returns {Promise<boolean>}
         */
        async hasOversizedItems() {
            const data = await this._safeGet('local', [this.KEYS.OVERSIZED_KEYS]);
            const arr = data[this.KEYS.OVERSIZED_KEYS] || [];
            return arr.length > 0;
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
                ? await this._safeGet('sync', pendingKeys)
                : {};

            // 一次讀完所有待推送金鑰的本機值：各金鑰的本機值彼此獨立，
            // 逐鍵重讀只會重複相同結果，卻讓儲存操作次數隨金鑰數線性膨脹。
            const localSnapshot = pendingKeys.length > 0
                ? await this._safeGet('local', pendingKeys)
                : {};

            // 讀取雙側 order meta，供 PRESET_INDEX 比對使用
            let localOrderMeta = { order: [], orderUpdatedAt: 0 };
            let syncOrderMeta = { order: [], orderUpdatedAt: 0 };
            if (pendingKeys.includes(this.KEYS.PRESET_INDEX)) {
                const [lMeta, sMeta] = await Promise.all([
                    this._safeGet('local', [this.KEYS.PRESET_ORDER_META]),
                    this._safeGet('sync', [this.KEYS.PRESET_ORDER_META]),
                ]);
                localOrderMeta = lMeta[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
                syncOrderMeta = sMeta[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            }

            // 收集已與雲端一致（reconciled）的 dsPreset_ 金鑰，供迴圈結束後統一從 dsLocalAuth 移除
            const reconciledPresetKeys = [];
            // 收集離線期間已於本機刪除的金鑰，迴圈結束後一次清理 sync 與追蹤記錄
            const locallyDeletedKeys = [];

            for (const key of pendingKeys) {
                if (localSnapshot[key] === undefined) {
                    // 金鑰在離線期間於本機被刪除：留待迴圈後統一清理 sync 與追蹤記錄
                    locallyDeletedKeys.push(key);
                    continue;
                }

                let canPush = true;
                let pushValue = localSnapshot[key];

                if (key === this.KEYS.PRESET_INDEX) {
                    // 僅在本機排序至少與雲端同新時才推送
                    const localOrderTs = localOrderMeta.orderUpdatedAt || 0;
                    const syncOrderTs = syncOrderMeta.orderUpdatedAt || 0;
                    canPush = localOrderTs >= syncOrderTs;
                } else if (key.startsWith(this.PRESET_KEY_PREFIX)) {
                    // 使用與其他同步流程一致的「較新者優先」共用規則判斷是否推送
                    const localPreset = localSnapshot[key];
                    const syncPreset = syncSnapshot[key];
                    const winner = this._pickNewerPreset(localPreset, syncPreset);
                    if (syncPreset !== undefined && winner !== localPreset) {
                        // 雲端版本已勝出（較新或內容相同），不需推送，且視為已與雲端調和
                        canPush = false;
                        reconciledPresetKeys.push(key);
                    }
                } else if (key === this.KEYS.PRESET_ORDER_META) {
                    // 與 PRESET_INDEX 分支一致：僅在本機排序時間戳至少與雲端同新時才推送
                    const localOrderTs = (localSnapshot[key] || {}).orderUpdatedAt || 0;
                    const syncOrderTs = (syncSnapshot[key] || {}).orderUpdatedAt || 0;
                    canPush = localOrderTs >= syncOrderTs;
                } else if (key === this.KEYS.PRESET_TOMBSTONES) {
                    // 墓碑記錄需逐 id 聯集合併（重用既有 _mergeTombstones），
                    // 避免整包覆寫復活對方裝置已刪除的 preset
                    pushValue = this._mergeTombstones(localSnapshot[key] || {}, syncSnapshot[key] || {});
                }

                // 逐鍵寫入而非整批：chrome.storage.sync.set() 是全有全無的，
                // 合批後任一鍵觸發配額失敗會讓整批一起退回本機授權佇列。
                if (canPush) {
                    await this._set({ [key]: pushValue });
                }
            }

            if (locallyDeletedKeys.length > 0) {
                await this._safeRemove('sync', locallyDeletedKeys);
            }

            // 一次移除本回合所有不再待推送的金鑰（本機已刪除的，以及雲端已勝出而調和完成的），
            // 避免下次重試時再度誤判為待推送
            const resolvedKeys = new Set([...locallyDeletedKeys, ...reconciledPresetKeys]);
            if (resolvedKeys.size > 0) {
                const current = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
                const newArr = (current[this.KEYS.LOCAL_AUTHORITATIVE] || []).filter(k => !resolvedKeys.has(k));
                await this._safeSet('local', { [this.KEYS.LOCAL_AUTHORITATIVE]: newArr });
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

                // 清除匯入 preset 的舊 tombstone 記錄，避免使用者刪除全部 preset 後
                // 重新匯入備份還原時，於下次跨裝置同步遭墓碑機制再次判定為已刪除。
                const importedPresetIds = importedSettings.promptPresets
                    .map(preset => preset && preset.id)
                    .filter(Boolean);
                await this.clearPresetTombstones(importedPresetIds);
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
                if (importedSettings.pinnedPresetId !== undefined) updates[this.KEYS.PINNED_PRESET_ID] = importedSettings.pinnedPresetId;
                // isEnabled / globalPromptEnabled 為裝置層級的本機開關（local-only），
                // 匯入備份不應覆寫當前裝置的開關狀態，故不從 importedSettings 還原。
                if (importedSettings.includeThinking !== undefined) updates[this.KEYS.INCLUDE_THINKING] = importedSettings.includeThinking;
                if (importedSettings.includeReferences !== undefined) updates[this.KEYS.INCLUDE_REFERENCES] = importedSettings.includeReferences;
                if (importedSettings.globalDefaultPrompt !== undefined) updates[this.KEYS.GLOBAL_DEFAULT_PROMPT] = importedSettings.globalDefaultPrompt;
                if (importedSettings.sidebarAutoHide !== undefined) updates[this.KEYS.SIDEBAR_AUTO_HIDE] = importedSettings.sidebarAutoHide;
                if (importedSettings.hideThinking !== undefined) updates[this.KEYS.HIDE_THINKING] = importedSettings.hideThinking;
                if (importedSettings.isShowSystemTime !== undefined) updates[this.KEYS.SHOW_SYSTEM_TIME] = importedSettings.isShowSystemTime;
                if (importedSettings.chatWidth !== undefined) updates[this.KEYS.CHAT_WIDTH] = importedSettings.chatWidth;
                if (importedSettings.chatWidthEnabled !== undefined) updates[this.KEYS.CHAT_WIDTH_ENABLED] = importedSettings.chatWidthEnabled;
                if (importedSettings.inputWidth !== undefined) updates[this.KEYS.INPUT_WIDTH] = importedSettings.inputWidth;
                if (importedSettings.inputWidthEnabled !== undefined) updates[this.KEYS.INPUT_WIDTH_ENABLED] = importedSettings.inputWidthEnabled;
            }

            if (Object.keys(updates).length > 0) {
                return this._set(updates);
            }
        },

        /**
         * 統一同步進入點。
         *
         * 流程：
         *   1. 推送任何因先前暫時性失敗而擱置於 dsLocalAuth 的本機較新項目
         *      （retrySync() 內部已依 _shouldPushPreset / orderUpdatedAt 逐項判斷，
         *      並尊重既有的同步寫入配額守衛）。
         *   2. 從雲端拉取最新設定（getSettings() → _get()，內部已完成
         *      sync-wins 合併 + 逐項 updatedAt 收斂 + dsLocalAuth pin）。
         *
         * 每個項目的決策彼此獨立：同一次呼叫中，項目 A 可能判定為「遠端較新」，
         * 項目 B 可能同時判定為「本機較新並已推送」。
         *
         * 設計原則：不重新實作任何比較邏輯，僅重用既有的 retrySync() / getSettings()，
         * 避免與既有 tie-break 語意產生分歧。
         *
         * @returns {Promise<Object>} 收斂後的最新設定物件（結構同 getSettings()）
         */
        async syncNow() {
            await this.retrySync();
            return this.getSettings();
        },
    };

    root.__DS_StorageManager_sync = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
