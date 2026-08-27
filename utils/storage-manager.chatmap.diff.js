/**
 * DS Studio — StorageManager ChatPresetMap diff 方法群組
 * 負責 chatPresetMap 的差異計算與套用。
 */
(function (root) {
    'use strict';

    /**
     * chatPresetMap 單一分塊的位元組軟上限。
     * 與 chatmap 主檔共用同一份值，mixin 後可透過 this.CHUNK_SOFT_LIMIT_BYTES 存取。
     */
    const CHUNK_SOFT_LIMIT_BYTES = 7168;

    const bundle = {
        CHUNK_SOFT_LIMIT_BYTES,

        /**
         * 將 deletedKeys/changedKeys/addedKeys 差異套用至 chunks 工作副本與 meta 工作副本，
         * 並同步更新 _chunkIndexCache。供 mutateChatPresetMap 的鎖外快速路徑與鎖內路徑共用，
         * 避免同一段三步驟 diff 邏輯重複兩次。
         *
         * @param {Object[]} chunks - chunk 陣列的工作副本（將被原地修改）
         * @param {Object} meta - meta 工作副本，chunkSizes/chunkCount 將被原地修改
         * @param {string[]} deletedKeys
         * @param {string[]} changedKeys
         * @param {string[]} addedKeys
         * @param {Object} finalMap - mutator 執行後的最終 map，供讀取 changed/added 的值
         * @returns {Set<number>} 被修改過的 chunk 索引
         */
        _applyChatPresetMapDiff(chunks, meta, deletedKeys, changedKeys, addedKeys, finalMap) {
            const modifiedChunks = new Set();

            // 1. 刪除已移除的 uuid
            for (const key of deletedKeys) {
                if (this._chunkIndexCache.has(key)) {
                    const idx = this._chunkIndexCache.get(key);
                    if (idx < chunks.length) {
                        delete chunks[idx][key];
                        modifiedChunks.add(idx);
                    }
                    this._chunkIndexCache.delete(key);
                }
            }

            // 2. 原地更新已變更的 uuid
            for (const key of changedKeys) {
                if (this._chunkIndexCache.has(key)) {
                    const idx = this._chunkIndexCache.get(key);
                    if (idx < chunks.length) {
                        chunks[idx][key] = finalMap[key];
                        modifiedChunks.add(idx);
                    }
                }
            }

            // 3. 新增 uuid：先嘗試填入既有 chunk，否則附加新 chunk
            for (const key of addedKeys) {
                const entrySize = this._byteLen({ [key]: finalMap[key] });
                let isPlaced = false;

                for (let i = 0; i < chunks.length; i++) {
                    const currentSize = i < meta.chunkSizes.length && meta.chunkSizes[i] > 0
                        ? meta.chunkSizes[i]
                        : this._byteLen(chunks[i]);

                    if (currentSize + entrySize < CHUNK_SOFT_LIMIT_BYTES) {
                        chunks[i][key] = finalMap[key];
                        modifiedChunks.add(i);
                        meta.chunkSizes[i] = this._byteLen(chunks[i]);
                        this._chunkIndexCache.set(key, i);
                        isPlaced = true;
                        break;
                    }
                }

                if (!isPlaced) {
                    const newIdx = chunks.length;
                    chunks.push({ [key]: finalMap[key] });
                    meta.chunkSizes.push(this._byteLen(chunks[newIdx]));
                    meta.chunkCount = newIdx + 1;
                    modifiedChunks.add(newIdx);
                    this._chunkIndexCache.set(key, newIdx);
                }
            }

            return modifiedChunks;
        },

        /**
         * 執行 mutator，並將其造成的 map 差異套用至 chunks/meta 的工作副本。涵蓋「快照 → 執行 mutator → 計算 key 差異 → 建立工作副本 → 套用差異」整段流程，供 mutateChatPresetMap 的鎖外快速路徑與鎖內路徑共用。
         *
         * @param {Function} mutator - 接收當前 map，可原地修改或回傳新 map
         * @param {{ map: Object, metaCopy: Object, chunksByIdx: Object[] }} state - _readAllChunks 的結果
         * @returns {Promise<Object>} isNoop 為 true 代表無任何差異，此時 newChunks/newMeta/modifiedChunks 不具意義，呼叫端應直接返回。
         */
        async _computeChatPresetMapDiff(mutator, { map, metaCopy, chunksByIdx }) {
            // 在呼叫 mutator 前快照原始 state，因為 mutator 可能原地修改 map
            const snapshotMap = Object.fromEntries(Object.entries(map));

            const result = await mutator(map);
            // 重新載入快取：async mutator 的 await 可能觸發 onChanged 導致快取失效
            await this._ensureChunkCachesLoaded();

            const finalMap = result === undefined ? map : result;

            // 使用快照計算差異
            const newKeys = Object.keys(finalMap);
            const deletedKeys = Object.keys(snapshotMap).filter(k => !(k in finalMap));
            const addedKeys = newKeys.filter(k => !(k in snapshotMap));
            const changedKeys = newKeys.filter(k => k in snapshotMap && snapshotMap[k] !== finalMap[k]);

            if (deletedKeys.length === 0 && addedKeys.length === 0 && changedKeys.length === 0) {
                return { finalMap, deletedKeys, changedKeys, addedKeys, isNoop: true };
            }

            // 建立工作副本並套用差異
            const newChunks = chunksByIdx.map(c => ({ ...c }));
            const newMeta = this._buildNextMeta(metaCopy, {});
            const modifiedChunks = this._applyChatPresetMapDiff(newChunks, newMeta, deletedKeys, changedKeys, addedKeys, finalMap);

            return { finalMap, deletedKeys, changedKeys, addedKeys, newChunks, newMeta, modifiedChunks, isNoop: false };
        },
    };

    root.__DS_StorageManager_chatmap_diff = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
