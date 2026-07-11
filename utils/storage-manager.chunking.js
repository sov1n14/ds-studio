/**
 * DS Studio — StorageManager 分塊式讀寫輔助方法群組
 * 負責 chatPresetMap 的分塊讀取、合併與原子寫入。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * 確保 _metaCache 與 _chunkIndexCache 已從 storage 載入。
         * 若兩者皆已存在則立即返回，避免重複讀取。
         */
        async _ensureChunkCachesLoaded() {
            if (this._metaCache && this._chunkIndexCache) return;
            const metaRaw = await this._safeGet('sync', [StorageManager.KEYS.CHAT_PRESET_MAP_META]);
            const meta = metaRaw[StorageManager.KEYS.CHAT_PRESET_MAP_META]
                ?? { version: 0, chunkCount: 0, chunkSizes: [] };
            const chunkKeys = Array.from({ length: meta.chunkCount }, (_, i) => StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
            const chunks = await this._get(chunkKeys);
            const index = new Map();
            for (let i = 0; i < meta.chunkCount; i++) {
                const chunk = chunks[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i] ?? {};
                for (const uuid of Object.keys(chunk)) {
                    index.set(uuid, i);
                }
            }
            this._metaCache = meta;
            this._chunkIndexCache = index;
        },

        /**
         * 讀取所有 chunk，回傳合併後的 map、meta 副本及各 chunk 陣列。
         * @returns {{ map: Object, metaCopy: Object, chunksByIdx: Object[] }}
         */
        async _readAllChunks() {
            await this._ensureChunkCachesLoaded();
            const metaCopy = { ...this._metaCache, chunkSizes: [...this._metaCache.chunkSizes] };
            const chunkKeys = Array.from({ length: metaCopy.chunkCount }, (_, i) => StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
            const chunks = await this._get(chunkKeys);
            const chunksByIdx = [];
            const map = {};
            for (let i = 0; i < metaCopy.chunkCount; i++) {
                const c = chunks[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i] ?? {};
                chunksByIdx.push(c);
                Object.assign(map, c);
            }
            return { map, metaCopy, chunksByIdx };
        },

        /**
         * 將單一 chunk 與 meta 原子性寫入 storage，並更新 _metaCache。
         * @param {number} chunkIdx - 目標 chunk 索引
         * @param {Object} chunkObj - 完整的 chunk 內容
         * @param {Object} newMeta  - 已遞增版號的新 meta
         */
        async _writeChunkWithMeta(chunkIdx, chunkObj, newMeta) {
            if (this._metaCache && newMeta.version !== this._metaCache.version + 1) {
                console.warn('[StorageManager] meta version did not strictly increment',
                    { prev: this._metaCache.version, next: newMeta.version });
            }
            const items = {};
            items[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx] = chunkObj;
            items[StorageManager.KEYS.CHAT_PRESET_MAP_META] = newMeta;
            await this._set(items);
            this._metaCache = newMeta;
        },
    };

    root.__DS_StorageManager_chunking = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
