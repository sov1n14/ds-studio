/**
 * DS Studio — StorageManager Tombstone 方法群組
 * 負責 prompt preset 刪除的墓碑（tombstone）記錄、合併與過期清理，
 * 確保刪除操作能正確跨裝置傳播，不被 mergePresets() 的 id 聯集邏輯復活。
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
    };

    root.__DS_StorageManager_tombstones = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
