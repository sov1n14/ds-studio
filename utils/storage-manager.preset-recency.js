/**
 * DS Studio — StorageManager Preset Recency 方法群組
 * 負責 preset 新舊判定、推送守衛與全域提示詞啟用解析。
 */
(function (root) {
    'use strict';

    const bundle = {
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
         * 同 updatedAt 時，內容不同則以 createdAt 較早者為準。
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
         * @param {Object|undefined} syncPreset - 目前雲端上的 preset
         * @returns {boolean} true 表示應該推送
         */
        _shouldPushPreset(preset, syncPreset) {
            if (syncPreset === undefined) return true;
            const isSameTimestamp = (preset.updatedAt || 0) === (syncPreset.updatedAt || 0);
            if (isSameTimestamp && JSON.stringify(preset) === JSON.stringify(syncPreset)) return false;
            return this._pickNewerPreset(preset, syncPreset) === preset;
        },

        /**
         * 純函式：決定「全域提示詞」在目前作用中 preset 底下是否啟用。
         * @param {Object|null|undefined} activePreset
         * @param {boolean} legacyGlobalFlag
         * @returns {boolean}
         */
        resolveGlobalPromptEnabled(activePreset, legacyGlobalFlag) {
            if (!activePreset) return legacyGlobalFlag;
            return activePreset.globalPromptEnabled ?? true;
        },
    };

    root.__DS_StorageManager_preset_recency = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
