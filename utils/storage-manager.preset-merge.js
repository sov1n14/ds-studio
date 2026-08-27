/**
 * DS Studio — StorageManager Preset Merge 方法群組
 * 負責雙側 preset 陣列的合併邏輯。
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
         * @param {Object} [baseOrderMeta]
         * @param {Object} [incOrderMeta]
         * @param {Object} [tombstones]
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
                    mergedMap.delete(p.id);
                    return;
                }
                if (mergedMap.has(p.id)) {
                    const existing = mergedMap.get(p.id);
                    const incUpdated = p.updatedAt || 0;
                    const baseUpdated = existing.updatedAt || 0;

                    if (incUpdated > baseUpdated) {
                        mergedMap.set(p.id, { ...p });
                    } else if (incUpdated === baseUpdated) {
                        const isEarlierCreated = (p.createdAt || 0) < (existing.createdAt || 0);
                        if (isEarlierCreated && JSON.stringify(p) !== JSON.stringify(existing)) {
                            mergedMap.set(p.id, { ...p });
                        }
                    }
                } else {
                    mergedMap.set(p.id, { ...p });
                }
            });

            // 決定輸出順序
            const incTs = (incOrderMeta && incOrderMeta.orderUpdatedAt) || 0;
            const baseTs = (baseOrderMeta && baseOrderMeta.orderUpdatedAt) || 0;
            let chosen;
            if (baseTs > incTs) chosen = baseOrderMeta.order;
            // 時間戳相同或 incoming 較新 → 雲端優先（cloud-on-tie）
            else chosen = incOrderMeta && incOrderMeta.order;

            const survivingIds = Array.from(mergedMap.keys());
            const survivingSet = new Set(survivingIds);
            const head = chosen ? chosen.filter(id => survivingSet.has(id)) : [];
            const headSet = new Set(head);
            const tail = survivingIds.filter(id => !headSet.has(id));
            const finalIds = [...head, ...tail];

            return finalIds.map(id => mergedMap.get(id));
        },
    };

    root.__DS_StorageManager_preset_merge = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
