/**
 * DS Studio — StorageManager ChatPresetMap 分塊讀寫方法群組
 * 單一寫入者（service worker）引擎：每次變更皆讀取最新快照、不使用快取與跨 context 鎖；同 context 內由 _enqueueChatPresetMapWrite 依 FIFO 序列化。
 * diff 計算方法由 storage-manager.chatmap.diff.js 提供；公開的 bind/unbind/prune 等方法由 storage-manager.chatmap.client.js 依模式分派。
 */
(function (root) {
    'use strict';

    const diffBundle = root.__DS_StorageManager_chatmap_diff || {};

    const bundle = Object.assign({}, diffBundle, {
        /**
         * 讀取 sync 上最新的 meta，再依 chunkCount 讀取 chunk 0..chunkCount-1；缺漏的 chunk 視為 {}。
         * @returns {Promise<{ map: Object, metaCopy: Object, chunksByIdx: Object[], missingChunkIdx: number[] }>} missingChunkIdx 為 meta 宣告但 storage 中不存在的 chunk 索引
         */
        async _readAllChunks() {
            const { CHAT_PRESET_MAP_META: metaKey, CHAT_PRESET_MAP_CHUNK_PREFIX: prefix } = this.KEYS;
            const metaRaw = await this._safeGet('sync', [metaKey]);
            const meta = metaRaw[metaKey] ?? { version: 0, chunkCount: 0, chunkSizes: [] };
            const metaCopy = { ...meta, chunkSizes: [...(meta.chunkSizes || [])] };

            const chunkKeys = Array.from({ length: metaCopy.chunkCount }, (_, i) => prefix + i);
            const chunks = chunkKeys.length > 0 ? await this._get(chunkKeys) : {};
            const chunksByIdx = chunkKeys.map(key => ({ ...(chunks[key] ?? {}) }));
            const missingChunkIdx = chunkKeys.flatMap((key, i) => (Object.hasOwn(chunks, key) ? [] : [i]));
            const map = Object.assign({}, ...chunksByIdx);
            return { map, metaCopy, chunksByIdx, missingChunkIdx };
        },

        /**
         * 執行單次 chatPresetMap 變更（不排隊，呼叫端負責序列化）。
         * 無差異時不寫入、不遞增版號；否則先移除被裁減的孤兒 chunk，再以單次 _set 寫入變更的 chunk 與 meta。
         * @param {Function} mutator
         * @returns {Promise<Object>} 變更後（或無差異時的目前）chatPresetMap
         */
        async _runChatMapMutation(mutator) {
            const { map, metaCopy, chunksByIdx, missingChunkIdx } = await this._readAllChunks();
            const diff = await this._computeChatPresetMapDiff(mutator, { map, metaCopy, chunksByIdx });
            if (diff.isNoop) return map;

            const { finalMap, newChunks, newMeta, modifiedChunks } = diff;

            // 裁減尾部空 chunk
            while (newChunks.length > 0 && Object.keys(newChunks[newChunks.length - 1]).length === 0) {
                newChunks.pop();
            }
            newMeta.chunkCount = newChunks.length;
            newMeta.chunkSizes = newMeta.chunkSizes.slice(0, newChunks.length);

            const prefix = this.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX;
            const orphanKeys = [];
            for (let i = newMeta.chunkCount; i < metaCopy.chunkCount; i++) orphanKeys.push(prefix + i);

            // 先移除孤兒 chunk：任何持新舊 meta 的讀者都不會讀到已刪除的綁定
            if (orphanKeys.length > 0) {
                await this._safeRemove('sync', orphanKeys);
                await this._safeRemove('local', orphanKeys);
            }

            const items = { [this.KEYS.CHAT_PRESET_MAP_META]: newMeta };
            // 一併補寫 meta 宣告卻缺漏的 chunk（中斷寫入殘留），使 chunk 鍵恢復為 0..chunkCount-1
            for (const idx of new Set([...modifiedChunks, ...missingChunkIdx])) {
                if (idx < newChunks.length) items[prefix + idx] = newChunks[idx];
            }
            // 寫入者直寫 sync：配額等失敗一律拋出，不退回 local（否則會回報成功卻未同步）
            await this._safeSet('sync', items);
            await this._safeSet('local', items);
            // 已成功提交至 sync 的金鑰不再處於擱置狀態
            await this._unparkKeys(Object.keys(items));
            return finalMap;
        },

        /**
         * 自 dsLocalAuth 移除指定金鑰；清單無變化時不寫入。
         * @param {string[]} keys
         */
        async _unparkKeys(keys) {
            const authKey = this.KEYS.LOCAL_AUTHORITATIVE;
            const parked = (await this._safeGet('local', [authKey]))[authKey] || [];
            const remaining = parked.filter(k => !keys.includes(k));
            if (remaining.length !== parked.length) await this._safeSet('local', { [authKey]: remaining });
        },

        /**
         * 以各 chat-map 金鑰目前的本機值重新發布至 sync（本機已無值則自 sync 移除），再解除擱置；非 chat-map 金鑰忽略。
         * 呼叫端負責排入寫入佇列。
         * @param {string[]} keys
         * @returns {Promise<Object>} 目前的 chatPresetMap
         */
        async _republishParkedTask(keys) {
            const chatMapKeys = keys.filter(k => this._isChatMapKey(k));
            if (chatMapKeys.length > 0) {
                const current = await this._safeGet('local', chatMapKeys);
                const absentKeys = chatMapKeys.filter(k => !Object.hasOwn(current, k));
                if (Object.keys(current).length > 0) await this._safeSet('sync', current);
                if (absentKeys.length > 0) await this._safeRemove('sync', absentKeys);
                await this._unparkKeys(chatMapKeys);
            }
            return (await this._readAllChunks()).map;
        },

        /**
         * legacy chatPresetMap → 分塊佈局遷移（可重複執行）：無 meta 且 legacy 有綁定時以一般提交路徑寫入分塊與 meta，
         * 之後自 sync 與 local 移除 legacy 金鑰。直接呼叫不排隊的 _runChatMapMutation，呼叫端負責排入寫入佇列（避免自我等待死結）。
         * @returns {Promise<Object>} 目前的 chatPresetMap
         */
        async _migrateLegacyTask() {
            const { CHAT_PRESET_MAP: legacyKey, CHAT_PRESET_MAP_META: metaKey } = this.KEYS;
            const legacySync = await this._safeGet('sync', [legacyKey]);
            const legacyLocal = await this._safeGet('local', [legacyKey]);
            const legacy = legacySync[legacyKey] ?? legacyLocal[legacyKey];
            if (legacy === undefined) return (await this._readAllChunks()).map;

            const hasMeta = (await this._safeGet('sync', [metaKey]))[metaKey] !== undefined;
            const hasEntries = legacy !== null && typeof legacy === 'object' && Object.keys(legacy).length > 0;
            if (!hasMeta && hasEntries) await this._runChatMapMutation(() => ({ ...legacy }));

            await this._safeRemove('sync', legacyKey);
            await this._safeRemove('local', legacyKey);
            return (await this._readAllChunks()).map;
        },

        /**
         * 透過 mutator 讀取-修改-寫入 chatPresetMap；僅寫入者（service worker）可呼叫。
         * mutator 每次呼叫恰好執行一次，可原地修改 map 或回傳新 map（回傳 undefined 則採用原地修改結果）。
         * @param {Function} mutator
         * @returns {Promise<Object>} 最終寫入 storage 的 chatPresetMap
         */
        async mutateChatPresetMap(mutator) {
            if (!this._isChatMapWriter) {
                throw new Error('[DSS] mutateChatPresetMap: chatPresetMap is writer-only; only the service worker (enableChatMapWriterMode) may mutate it');
            }
            return this._enqueueChatPresetMapWrite(() => this._runChatMapMutation(mutator));
        },

        /**
         * 驗證並套用單一宣告式 chat-map 操作（DSSChatMapOps）；僅寫入者可呼叫。
         * PRUNE_ORPHANS 於佇列內的 mutator 中讀取最新 dsPresetIndex，避免以過期索引修剪。
         * @param {Object} msg - DSS_CHAT_MAP_MSG 訊息
         * @returns {Promise<Object>} 變更後的 chatPresetMap
         */
        async applyChatMapOp(msg) {
            const ops = root.DSSChatMapOps;
            const verdict = ops.validate(msg);
            if (!verdict.ok) throw new this.errors.ChatMapDispatchError(verdict.error);
            const T = root.DSS_CHAT_MAP_MSG;
            if (!this._isChatMapWriter) {
                throw new Error('[DSS] applyChatMapOp: chatPresetMap is writer-only; only the service worker (enableChatMapWriterMode) may apply ops');
            }
            if (msg.type === T.MIGRATE_LEGACY) return this._enqueueChatPresetMapWrite(() => this._migrateLegacyTask());
            if (msg.type === T.REPUBLISH_PARKED) return this._enqueueChatPresetMapWrite(() => this._republishParkedTask(msg.keys));
            const isPrune = msg.type === T.PRUNE_ORPHANS;
            return this.mutateChatPresetMap(async (map) => {
                const ctx = isPrune ? { presetIds: (await this._get([this.KEYS.PRESET_INDEX]))[this.KEYS.PRESET_INDEX] } : undefined;
                return ops.apply(map, msg, ctx);
            });
        },

        /**
         * 讀取完整的 chatPresetMap（經由寫入佇列序列化，確保讀寫順序正確；寫入者與非寫入者皆可呼叫）。
         * @returns {Promise<Object>}
         */
        async getChatPresetMap() {
            return this._enqueueChatPresetMapWrite(async () => (await this._readAllChunks()).map);
        },
    });

    root.__DS_StorageManager_chatmap = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
