/**
 * DS Studio — StorageManager ChatPresetMap 分塊讀寫方法群組
 * 負責 chatPresetMap 的 mutate/bind/unbind 操作與分塊存取。
 * diff 計算方法由 storage-manager.chatmap.diff.js 提供。
 */
(function (root) {
    'use strict';

    // 合併 diff 子包提供的方法（含 CHUNK_SOFT_LIMIT_BYTES）
    const diffBundle = root.__DS_StorageManager_chatmap_diff || {};
    const CHUNK_SOFT_LIMIT_BYTES = diffBundle.CHUNK_SOFT_LIMIT_BYTES || 7168;

    const bundle = Object.assign({}, diffBundle, {
        /**
         * 透過 mutator 函式安全地讀取-修改-寫入 chatPresetMap。
         * 所有 chatPresetMap 的寫入皆經由內部 promise-chain 佇列序列化，
         * 避免同 context 內的競爭條件。
         *
         * @param {Function} mutator - 非同步或同步函式，接收當前 map 物件，
         *   可原地修改 map，或回傳一個全新的 map 物件來取代。
         *   若回傳值為 undefined，則使用原地修改後的 map。
         *
         *   ⚠️ MUTATOR CONTRACT（所有呼叫者必須遵守）：
         *   - C1 (Idempotent)：對相同輸入 map 必須產生相同結果，不可依賴呼叫次數。
         *   - C2 (No side effects)：不得有外部 I/O、計數器或 map 以外的狀態修改。
         *   - C3 (Respect input map)：必須從傳入的 map 衍生結果，不可盲目取代。
         *   - Double-run caveat：多 chunk 路徑下 mutator 會執行兩次（鎖外與鎖內各一次）。
         *
         * @returns {Promise<Object>} 最終寫入 storage 的 chatPresetMap
         */
        async mutateChatPresetMap(mutator) {
            return this._enqueueChatPresetMapWrite(async () => {
                const { map, metaCopy, chunksByIdx } = await this._readAllChunks();

                const { finalMap, deletedKeys, changedKeys, addedKeys, newMeta, modifiedChunks, isNoop } = await this._computeChatPresetMapDiff(mutator, { map, metaCopy, chunksByIdx });

                if (isNoop) return map;

                // === Phase C+D: 路徑選擇 — 單 chunk diff vs 多 chunk / 重新平衡 ===
                const isSingleChunkPath = modifiedChunks.size === 1
                    && newMeta.chunkCount === metaCopy.chunkCount;

                if (isSingleChunkPath) {
                    // 單 chunk diff 路徑：使用樂觀並發控制 + 有界重試 (Method D)
                    const onlyChunkIdx = [...modifiedChunks][0];
                    await this._writeChunkWithReconciliation({
                        chunkIdx: onlyChunkIdx,
                        applyDelta: (chunk) => {
                            for (const key of deletedKeys) delete chunk[key];
                            for (const key of changedKeys) chunk[key] = finalMap[key];
                            for (const key of addedKeys) chunk[key] = finalMap[key];
                        }
                    });
                    // 同步 _chunkIndexCache
                    if (this._chunkIndexCache === null) {
                        this._chunkIndexCache = new Map();
                    }
                    for (const key of deletedKeys) this._chunkIndexCache.delete(key);
                    for (const key of changedKeys) this._chunkIndexCache.set(key, onlyChunkIdx);
                    for (const key of addedKeys) this._chunkIndexCache.set(key, onlyChunkIdx);
                    return finalMap;
                }

                // 多 chunk / 重新平衡路徑：取得諮詢鎖 (Method C)
                return this._withChatPresetMapLock(async () => {
                    // 在鎖內重新讀取最新 state，避免覆蓋其他 context 的寫入
                    this._chunkIndexCache = null;
                    this._metaCache = null;
                    await this._ensureChunkCachesLoaded();
                    const { map: lockMap, metaCopy: lockMetaCopy, chunksByIdx: lockChunksByIdx } = await this._readAllChunks();

                    // 對最新 state 重新套用 mutator 並計算差異
                    const lockDiff = await this._computeChatPresetMapDiff(mutator, { map: lockMap, metaCopy: lockMetaCopy, chunksByIdx: lockChunksByIdx });
                    const lockFinalMap = lockDiff.finalMap;

                    if (lockDiff.isNoop) return lockFinalMap;

                    const lockNewChunks = lockDiff.newChunks;
                    const lockNewMeta = lockDiff.newMeta;
                    const lockModifiedChunks = lockDiff.modifiedChunks;

                    // 4. 重新計算被修改 chunk 的大小
                    for (const idx of lockModifiedChunks) {
                        if (idx < lockNewChunks.length) {
                            lockNewMeta.chunkSizes[idx] = this._byteLen(lockNewChunks[idx]);
                        }
                    }

                    // 5. 移除尾部空 chunk
                    while (lockNewMeta.chunkCount > 0) {
                        const lastIdx = lockNewMeta.chunkCount - 1;
                        if (Object.keys(lockNewChunks[lastIdx]).length === 0) {
                            lockNewChunks.pop();
                            lockNewMeta.chunkSizes.pop();
                            lockNewMeta.chunkCount--;
                        } else {
                            break;
                        }
                    }

                    // 6. 僅寫入有變更的 chunk + meta
                    const items = {};
                    let hasChanges = false;

                    for (const idx of lockModifiedChunks) {
                        if (idx < lockNewChunks.length) {
                            items[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + idx] = lockNewChunks[idx];
                            hasChanges = true;
                        }
                    }

                    // 若新增了 chunk（超出原始 chunkCount）
                    for (let i = lockMetaCopy.chunkCount; i < lockNewMeta.chunkCount; i++) {
                        items[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i] = lockNewChunks[i];
                        hasChanges = true;
                    }

                    // meta 有變（chunk 數量或大小改變）
                    if (hasChanges) {
                        items[StorageManager.KEYS.CHAT_PRESET_MAP_META] = lockNewMeta;
                    }

                    if (hasChanges) {
                        await this._set(items);
                        this._metaCache = lockNewMeta;
                    }

                    // 7. 清理被裁減的孤兒 chunk key
                    if (lockNewMeta.chunkCount < lockMetaCopy.chunkCount) {
                        const orphanedKeys = [];
                        for (let i = lockNewMeta.chunkCount; i < lockMetaCopy.chunkCount; i++) {
                            orphanedKeys.push(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
                        }
                        await this._safeRemove('sync', orphanedKeys);
                        await this._safeRemove('local', orphanedKeys);
                    }

                    // 8. 重建 chunk 索引快取
                    this._chunkIndexCache = new Map();
                    for (let i = 0; i < lockNewChunks.length; i++) {
                        for (const uuid of Object.keys(lockNewChunks[i])) {
                            this._chunkIndexCache.set(uuid, i);
                        }
                    }

                    this._metaCache = lockNewMeta;

                    return lockFinalMap;
                });
            });
        },

        /**
         * 清除指向已不存在提示詞組的綁定（提示詞組刪除後殘留的孤兒條目）。
         * 無孤兒條目時 mutateChatPresetMap 不會產生任何寫入。
         * @param {string[]} validPresetIds - 目前仍存在的提示詞組 id 清單
         * @returns {Promise<Object>} 修剪後的 chatPresetMap
         */
        async pruneOrphanChatBindings(validPresetIds) {
            const validIds = new Set(validPresetIds || []);
            return this.mutateChatPresetMap(map => {
                for (const [uuid, presetId] of Object.entries(map)) {
                    if (presetId && !validIds.has(presetId)) {
                        delete map[uuid];
                    }
                }
            });
        },

        /**
         * 讀取完整的 chatPresetMap（經由寫入佇列序列化，確保讀寫順序正確）。
         * @returns {Promise<Object>}
         */
        async getChatPresetMap() {
            return this._enqueueChatPresetMapWrite(async () => {
                const { map } = await this._readAllChunks();
                return map;
            });
        },

        /**
         * 將指定 uuid 的 chat 綁定至 preset。
         * @param {string} uuid
         * @param {string} presetId
         * @returns {Promise<true>}
         */
        async bindChatToPreset(uuid, presetId) {
            return this._enqueueChatPresetMapWrite(async () => {
                await this._ensureChunkCachesLoaded();

                if (this._chunkIndexCache.has(uuid)) {
                    // UUID 已存在 — 原地更新 (Method D: reconciliation)
                    const chunkIdx = this._chunkIndexCache.get(uuid);
                    const chunkKey = StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx;
                    const raw = await this._get([chunkKey]);
                    const chunk = raw[chunkKey] ?? {};
                    if (chunk[uuid] !== presetId) {
                        await this._writeChunkWithReconciliation({
                            chunkIdx,
                            applyDelta: c => { c[uuid] = presetId; }
                        });
                    }
                    this._chunkIndexCache.set(uuid, chunkIdx);
                    return true;
                }

                // 新 UUID：使用快取的 meta 決定寫入目標，不讀取所有 chunk
                const entrySize = this._byteLen({ [uuid]: presetId });
                let targetIdx = -1;

                for (let i = 0; i < this._metaCache.chunkSizes.length; i++) {
                    if (this._metaCache.chunkSizes[i] + entrySize < CHUNK_SOFT_LIMIT_BYTES) {
                        targetIdx = i;
                        break;
                    }
                }

                if (targetIdx >= 0) {
                    // 僅讀取目標 chunk (Method D: reconciliation)
                    await this._writeChunkWithReconciliation({
                        chunkIdx: targetIdx,
                        applyDelta: c => { c[uuid] = presetId; }
                    });
                    this._chunkIndexCache.set(uuid, targetIdx);
                } else {
                    // 附加新 chunk — 改變 chunkCount，需取得諮詢鎖 (Method C)
                    await this._withChatPresetMapLock(async () => {
                        // 在鎖內重新載入快取，避免 onChanged 併發寫入導致 _metaCache 為 null
                        await this._ensureChunkCachesLoaded();

                        const newIdx = this._metaCache.chunkCount;
                        const newChunk = { [uuid]: presetId };
                        const newMeta = this._buildNextMeta(this._metaCache, {
                            chunkCount: newIdx + 1,
                            chunkSizes: [...this._metaCache.chunkSizes, this._byteLen(newChunk)],
                        });

                        const items = {
                            [StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + newIdx]: newChunk,
                            [StorageManager.KEYS.CHAT_PRESET_MAP_META]: newMeta,
                        };
                        await this._set(items);
                        this._metaCache = newMeta;
                        // 寫入可能觸發 onChanged → 快取失效監聽器將 _chunkIndexCache 設為 null
                        if (this._chunkIndexCache === null) {
                            await this._ensureChunkCachesLoaded();
                        }
                        this._chunkIndexCache.set(uuid, newIdx);
                    });
                }

                return true;
            });
        },

        /**
         * 解除指定 uuid 的 chat 綁定。
         * @param {string} uuid
         * @returns {Promise<true>}
         */
        async unbindChat(uuid) {
            return this._enqueueChatPresetMapWrite(async () => {
                await this._ensureChunkCachesLoaded();

                if (!this._chunkIndexCache.has(uuid)) return true; // 無此 uuid，不做事

                const chunkIdx = this._chunkIndexCache.get(uuid);
                const chunkKey = StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx;
                const raw = await this._get([chunkKey]);
                const chunk = raw[chunkKey] ?? {};

                if (!(uuid in chunk)) return true; // 已被刪除

                delete chunk[uuid];
                // _get 可能觸發 onChanged → 快取失效監聽器將 _chunkIndexCache 設為 null
                if (this._chunkIndexCache === null) {
                    await this._ensureChunkCachesLoaded();
                }
                this._chunkIndexCache.delete(uuid);

                const isEmpty = Object.keys(chunk).length === 0;

                if (isEmpty && chunkIdx === this._metaCache.chunkCount - 1) {
                    // 尾部空 chunk：階層式清除連續空 chunk — 改變 chunkCount，需取得諮詢鎖 (Method C)
                    await this._withChatPresetMapLock(async () => {
                        const { chunksByIdx } = await this._readAllChunks();

                        // 從尾部開始尋找最後一個非空 chunk
                        let lastNonEmptyIdx = -1;
                        for (let i = chunksByIdx.length - 1; i >= 0; i--) {
                            if (Object.keys(chunksByIdx[i]).length > 0) {
                                lastNonEmptyIdx = i;
                                break;
                            }
                        }

                        const newChunkCount = lastNonEmptyIdx + 1;
                        const orphanedKeys = [];
                        for (let i = newChunkCount; i < this._metaCache.chunkCount; i++) {
                            orphanedKeys.push(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
                        }

                        const newMeta = this._buildNextMeta(this._metaCache, {
                            chunkCount: newChunkCount,
                            chunkSizes: this._metaCache.chunkSizes.slice(0, newChunkCount)
                        });

                        if (orphanedKeys.length > 0) {
                            await this._safeRemove('sync', orphanedKeys);
                            await this._safeRemove('local', orphanedKeys);
                        }

                        await this._set({ [StorageManager.KEYS.CHAT_PRESET_MAP_META]: newMeta });
                        this._metaCache = newMeta;
                    });
                } else {
                    // 非尾部空 chunk：使用 reconciliation 更新 (Method D)
                    await this._writeChunkWithReconciliation({
                        chunkIdx,
                        applyDelta: c => { delete c[uuid]; }
                    });
                }

                return true;
            });
        },
    });

    root.__DS_StorageManager_chatmap = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
