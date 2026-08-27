/**
 * DS Studio — StorageManager Preset CRUD 方法群組（Entry）
 * 負責 prompt preset 的儲存與 index 管理。
 *
 * 載入順序（各 loader 中 bundle 必須先於 entry）：
 *   1. storage-manager.tombstone.js       → globalThis.__DS_StorageManager_tombstone
 *   2. storage-manager.preset-merge.js    → globalThis.__DS_StorageManager_preset_merge
 *   3. storage-manager.preset-recency.js  → globalThis.__DS_StorageManager_preset_recency
 *   4. storage-manager.presets.js         （本檔，Object.assign 合入以上三個 bundle）
 */
(function (root) {
    'use strict';

    const bundle = {
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

            // 2. 直接將 index 寫入兩個 storage
            const localStatus = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
            const localAuth = localStatus[this.KEYS.LOCAL_AUTHORITATIVE] || [];
            const isIndexPendingRecovery = localAuth.includes(this.KEYS.PRESET_INDEX);

            if (JSON.stringify(oldIds) !== JSON.stringify(newIds) || isIndexPendingRecovery) {
                await this._set({ [this.KEYS.PRESET_INDEX]: newIds });
                const meta = orderMeta ?? { order: newIds, orderUpdatedAt: Date.now() };
                await this._set({ [this.KEYS.PRESET_ORDER_META]: meta });
            }

            // 3. 逐一寫入每個 preset
            const syncPresets = (await this._safeGet('sync', presets.map(p => this._presetKey(p.id)))) || {};
            for (const p of presets) {
                const key = this._presetKey(p.id);
                if (this._shouldPushPreset(p, syncPresets[key])) {
                    await this._set({ [key]: p });
                }
            }

            // 4. 清理已刪除的 presets，並記錄刪除墓碑
            if (deletedIds.length > 0) {
                const keysToRemove = deletedIds.map(id => this._presetKey(id));
                await this._safeRemove('sync', keysToRemove);
                await this._safeRemove('local', keysToRemove);
                await this.recordPresetTombstones(deletedIds);
            }
        },
    };

    // 合入三個 sub-bundle
    Object.assign(bundle,
        root.__DS_StorageManager_tombstone || {},
        root.__DS_StorageManager_preset_merge || {},
        root.__DS_StorageManager_preset_recency || {}
    );

    root.__DS_StorageManager_presets = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
