/**
 * DS Studio — StorageManager Preset CRUD 方法群組
 * 負責 prompt preset 的合併、儲存與順序元資料管理。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * 依 ID 合併兩個來源的 presets，支援順序元資料決策。
         * 2-param 呼叫（無 meta）與舊版行為相容：base 優先，新 ID 附加於尾。
         *
         * @param {Array} basePresets
         * @param {Array} newPresets
         * @param {Object} [baseOrderMeta] - { order: string[], orderUpdatedAt: number }
         * @param {Object} [incOrderMeta]  - { order: string[], orderUpdatedAt: number }
         * @returns {Array} 合併後的 preset 陣列
         */
        mergePresets(basePresets, newPresets, baseOrderMeta, incOrderMeta) {
            const mergedMap = new Map();

            // 先加入所有 base presets
            (basePresets || []).forEach(p => mergedMap.set(p.id, { ...p }));

            // 合併 incoming presets — updatedAt 較新者勝；同 updatedAt 但內容不同時 createdAt 較早者勝
            (newPresets || []).forEach(p => {
                if (mergedMap.has(p.id)) {
                    const existing = mergedMap.get(p.id);
                    const incUpdated = p.updatedAt || 0;
                    const baseUpdated = existing.updatedAt || 0;

                    if (incUpdated > baseUpdated) {
                        // incoming 較新，取代
                        mergedMap.set(p.id, { ...p });
                        window.__DS_Logger?.sync('merge:preset', { id: p.id, decision: 'use-sync', localTs: baseUpdated, syncTs: incUpdated });
                    } else if (incUpdated === baseUpdated) {
                        // 時間戳相同，內容有差異時以 createdAt 較早者為準（穩定 tiebreak）
                        const contentDiffers = JSON.stringify(p) !== JSON.stringify(existing);
                        if (contentDiffers && (p.createdAt || 0) < (existing.createdAt || 0)) {
                            mergedMap.set(p.id, { ...p });
                            window.__DS_Logger?.sync('merge:preset', { id: p.id, decision: 'tiebreak', localTs: baseUpdated, syncTs: incUpdated });
                        } else {
                            window.__DS_Logger?.sync('merge:preset', { id: p.id, decision: 'keep-local', localTs: baseUpdated, syncTs: incUpdated });
                        }
                        // 否則 base 保持不變
                    } else {
                        window.__DS_Logger?.sync('merge:preset', { id: p.id, decision: 'keep-local', localTs: baseUpdated, syncTs: incUpdated });
                    }
                    // incUpdated < baseUpdated：base 較新，不取代
                } else {
                    // base 中沒有此 preset，直接加入
                    mergedMap.set(p.id, { ...p });
                    window.__DS_Logger?.sync('merge:preset', { id: p.id, decision: 'add-new', localTs: 0, syncTs: p.updatedAt || 0 });
                }
            });

            // 決定輸出順序
            const incTs = (incOrderMeta && incOrderMeta.orderUpdatedAt) || 0;
            const baseTs = (baseOrderMeta && baseOrderMeta.orderUpdatedAt) || 0;
            let chosen;
            if (incTs > baseTs) chosen = incOrderMeta.order;
            else if (baseTs > incTs) chosen = baseOrderMeta.order;
            // 兩者相等或皆未定義 → chosen 保持 undefined → 使用 map 插入順序

            const survivingIds = Array.from(mergedMap.keys());
            const survivingSet = new Set(survivingIds);
            const head = chosen ? chosen.filter(id => survivingSet.has(id)) : [];
            const headSet = new Set(head);
            const tail = survivingIds.filter(id => !headSet.has(id));
            const finalIds = [...head, ...tail];
            window.__DS_Logger?.sync('merge:order', { winner: incTs > baseTs ? 'sync' : baseTs > incTs ? 'local' : 'insertion-order', finalIds });

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
            const deletedIds = oldIds.filter(id => !newIds.includes(id));

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
            for (const p of presets) {
                await this._set({ [this._presetKey(p.id)]: p });
            }

            // 4. 清理已刪除的 presets
            if (deletedIds.length > 0) {
                const keysToRemove = deletedIds.map(id => this._presetKey(id));
                await this._safeRemove('sync', keysToRemove);
                await this._safeRemove('local', keysToRemove);
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
            if (sTs > lTs) { window.__DS_Logger?.sync('order:pick', { localTs: lTs, syncTs: sTs, winner: 'sync' }); return { order: syncMeta.order, meta: syncMeta }; }
            if (lTs > sTs) { window.__DS_Logger?.sync('order:pick', { localTs: lTs, syncTs: sTs, winner: 'local' }); return { order: localMeta.order, meta: localMeta }; }
            return null;
        },
    };

    root.__DS_StorageManager_presets = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
