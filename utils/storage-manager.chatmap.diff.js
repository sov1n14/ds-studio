/**
 * DS Studio — StorageManager ChatPresetMap diff 方法群組
 * 負責 chatPresetMap 的差異計算與套用；皆為輸入的純函式，不讀寫 storage、不依賴快取。
 */
(function (root) {
    'use strict';

    /**
     * chatPresetMap 單一分塊的位元組軟上限。
     * 與 chatmap 主檔共用同一份值，mixin 後可透過 this.CHUNK_SOFT_LIMIT_BYTES 存取。
     */
    const CHUNK_SOFT_LIMIT_BYTES = 7168;

    /**
     * 由各 chunk 內容建立 uuid → chunk 索引；重複出現時以較後的 chunk 為準（與合併讀取的覆寫順序一致）。
     * @param {Object[]} chunks
     * @returns {Map<string, number>}
     */
    function buildChunkIndex(chunks) {
        const index = new Map();
        chunks.forEach((chunk, idx) => {
            for (const uuid of Object.keys(chunk)) index.set(uuid, idx);
        });
        return index;
    }

    const bundle = {
        CHUNK_SOFT_LIMIT_BYTES,

        /**
         * 將 deletedKeys/changedKeys/addedKeys 差異套用至 chunks 工作副本與 meta 工作副本。
         * 既有 uuid 留在原 chunk；新 uuid 放入第一個仍有空間的 chunk，皆無空間時附加新 chunk。
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
            const index = buildChunkIndex(chunks);

            // 1. 刪除已移除的 uuid（逐 chunk 清除，避免重複條目在刪除後復現）
            for (const key of deletedKeys) {
                chunks.forEach((chunk, idx) => {
                    if (!Object.hasOwn(chunk, key)) return;
                    delete chunk[key];
                    modifiedChunks.add(idx);
                });
            }

            // 2. 原地更新已變更的 uuid
            for (const key of changedKeys) {
                if (!index.has(key)) continue;
                const idx = index.get(key);
                chunks[idx][key] = finalMap[key];
                modifiedChunks.add(idx);
            }

            // 3. 新增 uuid：先嘗試填入既有 chunk，否則附加新 chunk（以實際內容量測大小，不信任可能過期的 meta）
            for (const key of addedKeys) {
                const entrySize = this._byteLen({ [key]: finalMap[key] });
                const targetIdx = chunks.findIndex(chunk => this._byteLen(chunk) + entrySize < CHUNK_SOFT_LIMIT_BYTES);

                if (targetIdx >= 0) {
                    chunks[targetIdx][key] = finalMap[key];
                    modifiedChunks.add(targetIdx);
                } else {
                    chunks.push({ [key]: finalMap[key] });
                    modifiedChunks.add(chunks.length - 1);
                }
            }

            meta.chunkCount = chunks.length;
            meta.chunkSizes = chunks.map(chunk => this._byteLen(chunk));
            return modifiedChunks;
        },

        /**
         * 執行 mutator 一次，並將其造成的 map 差異套用至 chunks/meta 的工作副本。
         *
         * @param {Function} mutator - 接收當前 map，可原地修改或回傳新 map
         * @param {{ map: Object, metaCopy: Object, chunksByIdx: Object[] }} state - _readAllChunks 的結果
         * @returns {Promise<Object>} isNoop 為 true 代表無任何差異，此時 newChunks/newMeta/modifiedChunks 不具意義，呼叫端應直接返回。
         */
        async _computeChatPresetMapDiff(mutator, { map, metaCopy, chunksByIdx }) {
            // 在呼叫 mutator 前快照原始 state，因為 mutator 可能原地修改 map
            const snapshotMap = { ...map };

            const result = await mutator(map);
            const finalMap = result === undefined ? map : result;

            const newKeys = Object.keys(finalMap);
            const deletedKeys = Object.keys(snapshotMap).filter(k => !(k in finalMap));
            const addedKeys = newKeys.filter(k => !(k in snapshotMap));
            const changedKeys = newKeys.filter(k => k in snapshotMap && snapshotMap[k] !== finalMap[k]);

            if (deletedKeys.length === 0 && addedKeys.length === 0 && changedKeys.length === 0) {
                return { finalMap, deletedKeys, changedKeys, addedKeys, isNoop: true };
            }

            // 建立工作副本並套用差異；_buildNextMeta 於此遞增版號
            const newChunks = chunksByIdx.map(c => ({ ...c }));
            const newMeta = this._buildNextMeta(metaCopy, {});
            const modifiedChunks = this._applyChatPresetMapDiff(newChunks, newMeta, deletedKeys, changedKeys, addedKeys, finalMap);

            return { finalMap, deletedKeys, changedKeys, addedKeys, newChunks, newMeta, modifiedChunks, isNoop: false };
        },
    };

    root.__DS_StorageManager_chatmap_diff = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
