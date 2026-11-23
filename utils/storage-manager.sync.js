/**
 * DS Studio — StorageManager 雲端同步方法群組
 * 負責同步衝突解決、同步狀態查詢與重試。
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
         * 透過合併雲端資料解決同步衝突，並將合併結果寫回兩側 storage，使下一次偵測不再分歧。
         * 雲端讀取失敗時以 Error reject 且兩側皆不寫入：以本機單側視圖合併會以僅含本機 id 的 index 與當下時戳覆寫雲端（或排入 dsLocalAuth 待 retrySync() 推送），永久遺失僅存於雲端的提示詞組。
         * @returns {Promise<void>}
         * @throws {Error} chrome.storage.sync 讀取失敗（lastError、Promise reject 或同步拋出）
         */
        async resolveSyncConflict() {
            const syncRaw = await this._strictGet('sync', null);
            const localRaw = await this._safeGet('local', null);

            const syncPresets = this._getPresetsFromRawStorage(syncRaw);
            const localPresets = this._getPresetsFromRawStorage(localRaw);

            const localOrderMeta = localRaw[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            const syncOrderMeta = syncRaw[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };

            // 合併雙側 tombstone（同 id 取較新刪除時間戳）並清除過期記錄，供 mergePresets() 判斷哪些 id 應被視為「已刪除」而排除於合併結果之外。
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

            // 1. 將合併後的排序與 presets 寫入兩側
            await this._writeMergedPresets(mergedPresets, mergedMeta, syncRaw, localRaw);

            // 1.5 持久化合併後的 tombstones 至兩側 storage，供跨裝置刪除傳播使用（經由既有 _set() 的 8KB 守衛與重試佇列邏輯，不重新實作寫入守衛）
            await this._set({ [this.KEYS.PRESET_TOMBSTONES]: mergedTombstones });

            // 2. 解決其他設定：雲端設定覆寫本機 UI 設定。
            // 以 ownership 白名單（KEYS 靜態成員 + dsPreset_ 動態 preset 金鑰）重建 updates，而非展開 get(null) 的完整快照：快照可能內含其他模組自行管理的金鑰（例如 content/temporary-chat-toggle.js 的 dss-temporary-chat-enabled），直接展開會讓某一側的舊值經此寫回而復活、覆蓋另一側裝置剛設定的新值。
            const ownedKeys = new Set(Object.values(this.KEYS));
            // chat-map 金鑰（meta、chunk、legacy）僅由 service worker 單一寫入者寫入：快照寫回會蓋掉其間的提交
            const isOwnedKey = (key) => !this._isChatMapKey(key) && (ownedKeys.has(key) || key.startsWith(this.PRESET_KEY_PREFIX));
            const updates = {};
            for (const key of Object.keys(localRaw)) {
                if (isOwnedKey(key)) updates[key] = localRaw[key];
            }
            for (const key of Object.keys(syncRaw)) {
                if (isOwnedKey(key)) updates[key] = syncRaw[key];
            }

            // 清理：若舊金鑰存在則移除
            delete updates[this.KEYS.PROMPT_PRESETS];

            // presets、排序與 tombstones 已於上方寫入合併版本，避免被 raw data 覆蓋
            delete updates[this.KEYS.PRESET_INDEX];
            delete updates[this.KEYS.PRESET_ORDER_META];
            delete updates[this.KEYS.PRESET_TOMBSTONES];
            Object.keys(updates).forEach(k => {
                if (k.startsWith(this.PRESET_KEY_PREFIX)) delete updates[k];
            });

            // 同步簿記（dsLocalAuth、dsOversizedKeys）與 restored_messages 僅存本機，不寫回 sync
            this.SYNC_EXCLUDED_KEYS.forEach(key => delete updates[key]);

            // isEnabled / globalPromptEnabled / isReplyNotificationEnabled 為裝置層級的本機開關（local-only），不應被雲端版本覆寫，故排除於合併結果之外。
            delete updates[this.KEYS.IS_ENABLED];
            delete updates[this.KEYS.GLOBAL_PROMPT_ENABLED];
            delete updates[this.KEYS.REPLY_NOTIFICATION];

            // 仍排在 dsLocalAuth 重試佇列的金鑰是尚未推送成功的本機較新寫入：保留本機值留待 retrySync() 推送，不以雲端值覆寫
            // Stryker disable next-line ArrayDeclaration: 等價變異 — dsLocalAuth 缺席時的回退陣列僅用於 delete updates[key]，updates 只含 KEYS 與 dsPreset_ 擁有金鑰，刪除任何非擁有金鑰皆無作用
            (localRaw[this.KEYS.LOCAL_AUTHORITATIVE] || []).forEach(key => delete updates[key]);

            updates[this.KEYS.SYNC_INITIALIZED] = true;
            updates[this.KEYS.SYNC_CONFLICT_PENDING] = false;

            return this._set(updates);
        },

        /**
         * 將合併後的排序與 presets 寫入兩側 storage。雲端缺少或較舊的 preset 經 _set() 寫入兩側（sync 寫入失敗時改存本機並排入 dsLocalAuth 重試佇列）；雲端已持有、僅本機缺少或不同者只寫本機；曾列於任一側 index 卻未進入合併結果者（例如被 tombstone 刪除）自兩側移除。
         * @param {Array} mergedPresets - mergePresets() 的合併結果
         * @param {{order: string[], orderUpdatedAt: number}} mergedMeta - 合併後的順序元資料
         * @param {Object} syncRaw - chrome.storage.sync.get(null) 的快照
         * @param {Object} localRaw - chrome.storage.local.get(null) 的快照
         */
        async _writeMergedPresets(mergedPresets, mergedMeta, syncRaw, localRaw) {
            await this._set({ [this.KEYS.PRESET_INDEX]: mergedMeta.order, [this.KEYS.PRESET_ORDER_META]: mergedMeta });

            for (const preset of mergedPresets) {
                const key = this._presetKey(preset.id);
                if (this._shouldPushPreset(preset, syncRaw[key])) {
                    await this._set({ [key]: preset });
                } else if (JSON.stringify(preset) !== JSON.stringify(localRaw[key])) {
                    await this._safeSet('local', { [key]: preset });
                }
            }

            const mergedIdSet = new Set(mergedMeta.order);
            const indexedIds = new Set([...(localRaw[this.KEYS.PRESET_INDEX] || []), ...(syncRaw[this.KEYS.PRESET_INDEX] || [])]);
            const droppedKeys = [...indexedIds].filter(id => !mergedIdSet.has(id)).map(id => this._presetKey(id));
            if (droppedKeys.length > 0) {
                await this._safeRemove('sync', droppedKeys);
                await this._safeRemove('local', droppedKeys);
            }
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
         * 統一同步進入點。
         *
         * 流程：
         *   1. retrySync()：推送因先前暫時性失敗而擱置於 dsLocalAuth 的本機較新項目（依 _shouldPushPreset / orderUpdatedAt 逐項判斷，並尊重既有的同步寫入配額守衛）；推送後若偵測到可自動解決的分歧，由 resolveSyncConflict() 將合併結果寫入兩側，仍排在 dsLocalAuth 的金鑰保留本機值。
         *   2. 從雲端拉取最新設定（getSettings() → _get()，sync-wins 合併後逐項依 updatedAt 收斂，遠端較新的 preset 與排序回寫本機）。
         *
         * 每個項目的決策彼此獨立：同一次呼叫中，項目 A 可能判定為「遠端較新」，項目 B 可能同時判定為「本機較新並已推送」。
         *
         * 設計原則：不重新實作任何比較邏輯，僅重用既有的 retrySync() / getSettings()，避免與既有 tie-break 語意產生分歧。
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
