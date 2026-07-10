/**
 * DS Studio — StorageManager Tombstone 方法群組
 * 負責 prompt preset 刪除的墓碑（tombstone）記錄、合併與過期清理，
 * 確保刪除操作能正確跨裝置傳播，不被 mergePresets() 的 id 聯集邏輯復活。
 */
(function (root) {
    'use strict';

    // Tombstone 保留期限：超過此天數的刪除記錄視為所有裝置皆已收斂，可安全清除。
    const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

    const bundle = {
        /**
         * 純函式：合併本機與雲端的 tombstone 記錄，同一 id 取較新的刪除時間戳。
         * @param {Object} localTombstones - { [id]: deletedAt }
         * @param {Object} syncTombstones  - { [id]: deletedAt }
         * @returns {Object} 合併後的 tombstone map
         */
        _mergeTombstones(localTombstones, syncTombstones) {
            const merged = { ...(localTombstones || {}) };
            Object.entries(syncTombstones || {}).forEach(([id, deletedAt]) => {
                if (!merged[id] || deletedAt > merged[id]) merged[id] = deletedAt;
            });
            return merged;
        },

        /**
         * 純函式：清除超過保留期限的 tombstone，避免清單無限成長。
         * @param {Object} tombstones - { [id]: deletedAt }
         * @param {number} [now]
         * @returns {Object} 已清理的 tombstone map
         */
        _pruneTombstones(tombstones, now = Date.now()) {
            const pruned = {};
            Object.entries(tombstones || {}).forEach(([id, deletedAt]) => {
                if (now - deletedAt <= TOMBSTONE_RETENTION_MS) pruned[id] = deletedAt;
            });
            return pruned;
        },

        /**
         * 純函式：判斷某 id 是否應被 tombstone 判定為「已刪除且應排除於合併結果」。
         * 刪除時間戳需不早於（即 >=）該 id 內容目前已知的 updatedAt，才視為有效刪除；
         * 若內容的 updatedAt 較新，代表該 id 在刪除之後於其他裝置被重新編輯／建立，不應被墓碑蓋過。
         * @param {Object} tombstones - { [id]: deletedAt }
         * @param {string} id
         * @param {number} referenceUpdatedAt - 該 id 在其中一側的 updatedAt（或 0）
         * @returns {boolean}
         */
        _isTombstonedAway(tombstones, id, referenceUpdatedAt) {
            const deletedAt = (tombstones || {})[id];
            if (deletedAt === undefined) return false;
            return deletedAt >= (referenceUpdatedAt || 0);
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
            deletedIds.forEach(id => { tombstones[id] = now; });

            const pruned = this._pruneTombstones(tombstones, now);
            globalThis.__DS_Logger?.sync('tombstone:create', {
                ids: deletedIds,
                deletedAt: now,
                totalCount: Object.keys(pruned).length,
            });

            await this._set({ [this.KEYS.PRESET_TOMBSTONES]: pruned });
        },
    };

    root.__DS_StorageManager_tombstones = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
