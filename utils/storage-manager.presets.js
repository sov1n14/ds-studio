/**
 * DS Studio — StorageManager Preset CRUD 方法群組
 * 負責 prompt preset 的合併、儲存與順序元資料管理。
 */
(function (root) {
    'use strict';

    // Tombstone 保留期限：超過此天數的刪除記錄視為所有裝置皆已收斂，可安全清除。
    const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

    /**
     * 純函式：將單一 tombstone entry 正規化為 { ts, deleted } 物件形狀。
     * 舊版資料以 bare number（deletedAt 時間戳）表示，且舊版語意上一律代表「已刪除」，
     * 故轉換為 { ts: deletedAt, deleted: true }；已是物件形狀者原樣傳回。
     * @param {number|{ts: number, deleted: boolean}} entry
     * @returns {{ts: number, deleted: boolean}}
     */
    function normalizeTombstoneEntry(entry) {
        if (typeof entry === 'number') return { ts: entry, deleted: true };
        return entry;
    }

    /**
     * 純函式：正規化整個 tombstone map，統一轉換舊版 bare-number 形狀。
     * @param {Object} tombstones - { [id]: number|{ts, deleted} }
     * @returns {Object} { [id]: {ts, deleted} }
     */
    function normalizeTombstoneMap(tombstones) {
        return Object.fromEntries(
            Object.entries(tombstones || {}).map(([id, entry]) => [id, normalizeTombstoneEntry(entry)])
        );
    }

    const bundle = {
        /**
         * 純函式：合併本機與雲端的 tombstone 記錄，同一 id 取較新的 ts（連同其 deleted 值一併採用）。
         * @param {Object} localTombstones - { [id]: {ts, deleted} }（相容舊版 bare number）
         * @param {Object} syncTombstones  - { [id]: {ts, deleted} }（相容舊版 bare number）
         * @returns {Object} 合併後的 tombstone map
         */
        _mergeTombstones(localTombstones, syncTombstones) {
            const merged = normalizeTombstoneMap(localTombstones);
            Object.entries(normalizeTombstoneMap(syncTombstones)).forEach(([id, entry]) => {
                if (!merged[id] || entry.ts > merged[id].ts) merged[id] = entry;
            });
            return merged;
        },

        /**
         * 純函式：清除超過保留期限的 tombstone，避免清單無限成長。
         * 無論 deleted 為 true 或 false，只要超過保留期限即一併清除。
         * @param {Object} tombstones - { [id]: {ts, deleted} }（相容舊版 bare number）
         * @param {number} [now]
         * @returns {Object} 已清理的 tombstone map
         */
        _pruneTombstones(tombstones, now = Date.now()) {
            const pruned = {};
            Object.entries(normalizeTombstoneMap(tombstones)).forEach(([id, entry]) => {
                if (now - entry.ts <= TOMBSTONE_RETENTION_MS) pruned[id] = entry;
            });
            return pruned;
        },

        /**
         * 純函式：判斷某 id 是否應被 tombstone 判定為「已刪除且應排除於合併結果」。
         * 僅當 entry.deleted === true 時才視為刪除標記；deleted === false 代表該 id
         * 已透過 clearPresetTombstones() 明確清除刪除意圖（例如重新匯入備份還原）。
         * 刪除時間戳需不早於（即 >=）該 id 內容目前已知的 updatedAt，才視為有效刪除；
         * 若內容的 updatedAt 較新，代表該 id 在刪除之後於其他裝置被重新編輯／建立，不應被墓碑蓋過。
         * @param {Object} tombstones - { [id]: {ts, deleted} }（相容舊版 bare number）
         * @param {string} id
         * @param {number} referenceUpdatedAt - 該 id 在其中一側的 updatedAt（或 0）
         * @returns {boolean}
         */
        _isTombstonedAway(tombstones, id, referenceUpdatedAt) {
            const entry = normalizeTombstoneEntry((tombstones || {})[id]);
            if (!entry || entry.deleted !== true) return false;
            return entry.ts >= (referenceUpdatedAt || 0);
        },

        /**
         * 記錄刪除 tombstone 並寫入 local + sync（經由既有 _set() 的 8KB 守衛與
         * dsLocalAuth 重試佇列邏輯，不重新實作寫入守衛）。同時順手清理過期記錄。
         * @param {string[]} deletedIds
         */
        async recordPresetTombstones(deletedIds) {
            if (!deletedIds || deletedIds.length === 0) return;

            const data = await this._get([this.KEYS.PRESET_TOMBSTONES]);
            const now = Date.now();
            const tombstones = { ...(data[this.KEYS.PRESET_TOMBSTONES] || {}) };
            deletedIds.forEach(id => { tombstones[id] = { ts: now, deleted: true }; });

            const pruned = this._pruneTombstones(tombstones, now);

            await this._set({ [this.KEYS.PRESET_TOMBSTONES]: pruned });
        },

        /**
         * 清除指定 id 清單的 tombstone 記錄，並寫回 local + sync（經由既有 _set() 的
         * 8KB 守衛與 dsLocalAuth 重試佇列邏輯，不重新實作寫入守衛）。
         * 注意：不會直接刪除 map 中的 key，而是寫入 { ts: now, deleted: false } 的
         * 「已清除」墓碑，確保跨裝置合併（_mergeTombstones 依 ts 取較新者）時，
         * 較新的「已清除」意圖能蓋過陳舊一側仍持有的舊「已刪除」記錄，避免其被誤判復活刪除。
         * 若清單中的 id 已是非刪除狀態的墓碑記錄，則靜默略過，不視為錯誤（no-op 保持不變）。
         * 用途：使用者重新匯入備份還原 preset 時，需清除該 preset 先前的刪除墓碑，
         * 避免下次跨裝置同步時被墓碑判定為「已刪除」而再次遭到清除。
         * @param {string[]} ids - 需清除 tombstone 記錄的 preset id 清單
         */
        async clearPresetTombstones(ids) {
            if (!ids || ids.length === 0) return;

            const data = await this._get([this.KEYS.PRESET_TOMBSTONES]);
            const tombstones = normalizeTombstoneMap(data[this.KEYS.PRESET_TOMBSTONES] || {});
            const now = Date.now();

            let hasChanged = false;
            ids.forEach(id => {
                const existing = tombstones[id];
                if (!existing || existing.deleted !== false) {
                    tombstones[id] = { ts: now, deleted: false };
                    hasChanged = true;
                }
            });

            if (!hasChanged) return;

            await this._set({ [this.KEYS.PRESET_TOMBSTONES]: tombstones });
        },

        /**
         * 依 ID 合併兩個來源的 presets，支援順序元資料決策。
         * 2-param 呼叫（無 meta）與舊版行為相容：base 優先，新 ID 附加於尾。
         *
         * @param {Array} basePresets
         * @param {Array} newPresets
         * @param {Object} [baseOrderMeta] - { order: string[], orderUpdatedAt: number }
         * @param {Object} [incOrderMeta]  - { order: string[], orderUpdatedAt: number }
         * @param {Object} [tombstones] - { [id]: deletedAt } 已合併雙側的刪除墓碑記錄；
         *   任一 id 若被 tombstone 判定為刪除（deletedAt >= 該 id 的 updatedAt），一律排除於合併結果，
         *   避免陳舊一側「仍存在」的資料被當成新增項目而復活已刪除的 preset。
         * @returns {Array} 合併後的 preset 陣列
         */
        mergePresets(basePresets, newPresets, baseOrderMeta, incOrderMeta, tombstones) {
            const mergedMap = new Map();
            const tombstoneMap = tombstones || {};

            // 先加入所有 base presets，但排除已被 tombstone 判定為刪除者
            (basePresets || []).forEach(p => {
                if (this._isTombstonedAway(tombstoneMap, p.id, p.updatedAt)) {
                    return;
                }
                mergedMap.set(p.id, { ...p });
            });

            // 合併 incoming presets — updatedAt 較新者勝；同 updatedAt 但內容不同時 createdAt 較早者勝
            (newPresets || []).forEach(p => {
                if (this._isTombstonedAway(tombstoneMap, p.id, p.updatedAt)) {
                    // tombstone 較新（或同新）：即使 base 側仍留有此 id，也一併移除，墓碑必須蓋過陳舊資料
                    mergedMap.delete(p.id);
                    return;
                }
                if (mergedMap.has(p.id)) {
                    const existing = mergedMap.get(p.id);
                    const incUpdated = p.updatedAt || 0;
                    const baseUpdated = existing.updatedAt || 0;

                    if (incUpdated > baseUpdated) {
                        // incoming 較新，取代
                        mergedMap.set(p.id, { ...p });
                    } else if (incUpdated === baseUpdated) {
                        // 時間戳相同，內容有差異時以 createdAt 較早者為準（穩定 tiebreak）。
                        // 先比 createdAt：不符資格時整包序列化比對就不必做。
                        const isEarlierCreated = (p.createdAt || 0) < (existing.createdAt || 0);
                        if (isEarlierCreated && JSON.stringify(p) !== JSON.stringify(existing)) {
                            mergedMap.set(p.id, { ...p });
                        }
                        // 否則 base 保持不變
                    }
                    // incUpdated < baseUpdated：base 較新，不取代
                } else {
                    // base 中沒有此 preset，直接加入
                    mergedMap.set(p.id, { ...p });
                }
            });

            // 決定輸出順序
            const incTs = (incOrderMeta && incOrderMeta.orderUpdatedAt) || 0;
            const baseTs = (baseOrderMeta && baseOrderMeta.orderUpdatedAt) || 0;
            let chosen;
            if (baseTs > incTs) chosen = baseOrderMeta.order;
            // 時間戳相同或 incoming 較新 → 雲端優先（cloud-on-tie）：平手代表無法判斷新舊，雲端優先可讓多裝置最終收斂到同一順序
            else chosen = incOrderMeta && incOrderMeta.order; // 皆未定義時 incOrderMeta 為 undefined，chosen 維持 undefined → 退回 map 插入順序

            const survivingIds = Array.from(mergedMap.keys());
            const survivingSet = new Set(survivingIds);
            const head = chosen ? chosen.filter(id => survivingSet.has(id)) : [];
            const headSet = new Set(head);
            const tail = survivingIds.filter(id => !headSet.has(id));
            const finalIds = [...head, ...tail];

            return finalIds.map(id => mergedMap.get(id));
        },

        /**
         * 儲存單一 preset 內容而不觸碰 index。
         * 熱路徑：恰好 1 次 sync 寫入操作。
         * @param {Object} preset - 要儲存的 preset 物件
         */
        async saveOnePromptPreset(preset) {
            return this._set({ [this._presetKey(preset.id)]: preset });
        },

        /**
         * 使用獨立金鑰儲存所有 prompt presets，並同步更新順序元資料。
         * @param {Array} presets - preset 物件陣列
         * @param {Object} [orderMeta] - 外部傳入的順序元資料；未傳時自動以當前順序建立
         */
        async savePromptPresets(presets, orderMeta) {
            // 1. 取得當前 index 以識別待刪除項目
            const data = await this._get([this.KEYS.PRESET_INDEX]);
            const oldIds = data[this.KEYS.PRESET_INDEX] || [];
            const newIds = presets.map(p => p.id);
            const newIdSet = new Set(newIds);
            const deletedIds = oldIds.filter(id => !newIdSet.has(id));

            // 2. 直接將 index 寫入兩個 storage — index 很小且必須同步至雲端。
            //    若與 preset 內容合批寫入，單一 preset 超過 per-item 配額時
            //    整批會回退至本機，導致重新安裝衝突偵測失效（雲端會沒有任何記錄）。
            const localStatus = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
            const localAuth = localStatus[this.KEYS.LOCAL_AUTHORITATIVE] || [];
            const isIndexPendingRecovery = localAuth.includes(this.KEYS.PRESET_INDEX);

            if (JSON.stringify(oldIds) !== JSON.stringify(newIds) || isIndexPendingRecovery) {
                await this._set({ [this.KEYS.PRESET_INDEX]: newIds });
                // 同步寫入順序元資料，供跨裝置 sync 衝突解決使用
                const meta = orderMeta ?? { order: newIds, orderUpdatedAt: Date.now() };
                await this._set({ [this.KEYS.PRESET_ORDER_META]: meta });
            }

            // 3. 逐一寫入每個 preset，超大 preset 只落到本機，不拖累其他 preset 或 index
            //    先批次讀取雲端現況，僅在本機版本應該勝出時才寫入，避免結構性操作（排序/刪除/重命名）
            //    無條件覆寫每個 preset 內容，錯誤地覆蓋掉雲端較新的版本。
            const syncPresets = (await this._safeGet('sync', presets.map(p => this._presetKey(p.id)))) || {};
            for (const p of presets) {
                const key = this._presetKey(p.id);
                if (this._shouldPushPreset(p, syncPresets[key])) {
                    await this._set({ [key]: p });
                }
            }

            // 4. 清理已刪除的 presets，並記錄刪除墓碑（tombstone），
            //    確保刪除意圖能跨裝置傳播，而不只是在本機移除 —— 否則其他裝置的
            //    陳舊本機快照仍持有該 id，下次合併時會被當成「新增項目」而復活。
            if (deletedIds.length > 0) {
                const keysToRemove = deletedIds.map(id => this._presetKey(id));
                await this._safeRemove('sync', keysToRemove);
                await this._safeRemove('local', keysToRemove);
                await this.recordPresetTombstones(deletedIds);
            }
        },

        /**
         * 依 orderUpdatedAt 時間戳挑選較新的順序元資料。
         * @param {Object|null} localMeta
         * @param {Object|null} syncMeta
         * @returns {{ order: string[], meta: Object }|null} 較新者；兩者相等時回傳 null
         */
        _pickPresetOrderByRecency(localMeta, syncMeta) {
            const lTs = (localMeta && localMeta.orderUpdatedAt) || 0;
            const sTs = (syncMeta && syncMeta.orderUpdatedAt) || 0;
            if (sTs > lTs) { return { order: syncMeta.order, meta: syncMeta }; }
            if (lTs > sTs) { return { order: localMeta.order, meta: localMeta }; }
            return null;
        },

        /**
         * 純函式：依 updatedAt 挑選較新的單一 preset 版本。
         * 同 updatedAt 時，內容不同則以 createdAt 較早者為準（與 mergePresets 的 tiebreak 規則一致）。
         * @param {Object|null} localPreset
         * @param {Object|null} syncPreset
         * @returns {Object|null} 較新（或應保留）的 preset
         */
        _pickNewerPreset(localPreset, syncPreset) {
            if (syncPreset == null) return localPreset;
            if (localPreset == null) return syncPreset;

            const lTs = localPreset.updatedAt || 0;
            const sTs = syncPreset.updatedAt || 0;
            if (lTs > sTs) return localPreset;
            if (sTs > lTs) return syncPreset;

            // updatedAt 相同：內容相同則維持預設（sync）；內容不同則 createdAt 較早者勝
            if (JSON.stringify(localPreset.content) === JSON.stringify(syncPreset.content)) return syncPreset;
            return (localPreset.createdAt || 0) < (syncPreset.createdAt || 0) ? localPreset : syncPreset;
        },

        /**
         * 純函式：寫入路徑守衛，判斷是否需要將本機 preset 推送至雲端。
         * @param {Object} preset - 本機 preset
         * @param {Object|undefined} syncPreset - 目前雲端上的 preset（若尚未存在則為 undefined）
         * @returns {boolean} true 表示應該推送
         */
        _shouldPushPreset(preset, syncPreset) {
            if (syncPreset === undefined) return true;
            // updatedAt 不同時兩者必然不相等，直接交由 _pickNewerPreset 判定，省下整包序列化
            const isSameTimestamp = (preset.updatedAt || 0) === (syncPreset.updatedAt || 0);
            if (isSameTimestamp && JSON.stringify(preset) === JSON.stringify(syncPreset)) return false;
            return this._pickNewerPreset(preset, syncPreset) === preset;
        },

        /**
         * 純函式：決定「全域提示詞」在目前作用中 preset 底下是否啟用。
         * 若 activePreset 存在，以其自身 globalPromptEnabled 欄位為準（透過 ?? 視 undefined/null 為未設定，
         * 一律回退為 true —— 還原舊版備份時該欄位必然不存在，不應因此靜默關閉全域提示詞）。
         * 若 activePreset 為 null/undefined，直接回傳舊版旗標 legacyGlobalFlag。
         * @param {Object|null|undefined} activePreset - 目前作用中的 preset（可能不含此欄位）
         * @param {boolean} legacyGlobalFlag - 舊版（無 preset 概念時期）的全域提示詞旗標
         * @returns {boolean} 是否啟用全域提示詞
         */
        resolveGlobalPromptEnabled(activePreset, legacyGlobalFlag) {
            if (!activePreset) return legacyGlobalFlag;
            return activePreset.globalPromptEnabled ?? true;
        },
    };

    root.__DS_StorageManager_presets = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
