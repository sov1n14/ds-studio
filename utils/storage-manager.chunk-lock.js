/**
 * DS Studio — StorageManager 分塊式讀寫 + 分散式鎖定方法群組
 * 負責 chatPresetMap 的分塊讀取、合併、原子寫入，以及跨 context 鎖的取得/釋放與帶重試的 CAS 寫入。
 * 鎖定邏輯直接呼叫本檔的分塊寫入基礎方法，兩者高度耦合，故合併為單一 bundle。
 */
(function (root) {
    'use strict';

    /**
     * 鎖定相關常數的唯一定義處。透過下方 bundle 一併 mixin 至 StorageManager，
     * 因此生產程式碼與測試都以 StorageManager.<名稱> 取用同一份值。
     */
    const LOCK_CONSTANTS = {
        CHAT_PRESET_MAP_LOCK_KEY: 'chatPresetMapLock',
        LOCK_TTL_MS: 3000,
        LOCK_ACQUIRE_TIMEOUT_MS: 5000,
        LOCK_POLL_INTERVAL_MS: 50,
        RECONCILIATION_RETRY_BUDGET: 3,
    };

    const {
        CHAT_PRESET_MAP_LOCK_KEY: LOCK_KEY,
        LOCK_TTL_MS,
        LOCK_ACQUIRE_TIMEOUT_MS,
        LOCK_POLL_INTERVAL_MS,
        RECONCILIATION_RETRY_BUDGET,
    } = LOCK_CONSTANTS;

    /**
     * 可降級告警：本 bundle 亦由 background/service-worker.js 載入，該處刻意不載入
     * utils/logger.js，故 __DS_Logger 缺席時退回帶 [DSS] 前綴的 console.warn。
     * @param {string} event
     * @param {*} context
     */
    function warn(event, context) {
        if (globalThis.__DS_Logger?.warn) {
            globalThis.__DS_Logger.warn(event, context);
            return;
        }
        console.warn('[DSS]', event, context);
    }

    const bundle = {
        ...LOCK_CONSTANTS,

        /**
         * 確保 _metaCache 與 _chunkIndexCache 已從 storage 載入。
         * 若兩者皆已存在則立即返回，避免重複讀取。
         */
        async _ensureChunkCachesLoaded() {
            if (this._metaCache && this._chunkIndexCache) return;
            const metaRaw = await this._safeGet('sync', [StorageManager.KEYS.CHAT_PRESET_MAP_META]);
            const meta = metaRaw[StorageManager.KEYS.CHAT_PRESET_MAP_META]
                ?? { version: 0, chunkCount: 0, chunkSizes: [] };
            const chunkKeys = [];
            for (let i = 0; i < meta.chunkCount; i++) {
                chunkKeys.push(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
            }
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
            const chunkKeys = [];
            for (let i = 0; i < metaCopy.chunkCount; i++) {
                chunkKeys.push(StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + i);
            }
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
                warn('chunk-lock:meta-version-not-incremented',
                    { prev: this._metaCache.version, next: newMeta.version });
            }
            const items = {};
            items[StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx] = chunkObj;
            items[StorageManager.KEYS.CHAT_PRESET_MAP_META] = newMeta;
            await this._set(items);
            this._metaCache = newMeta;
        },

        /**
         * 睡眠輪詢取得指定 key 的諮詢鎖（存於 chrome.storage.local）。
         * TTL 容錯機制：若持鎖方崩潰，鎖在 LOCK_TTL_MS 後過期，任何請求方均可接管。
         * @param {string} [lockKey] - 鎖定的 storage key，預設為 LOCK_KEY（chatPresetMapLock）
         * @returns {Promise<string>} owner token，必須傳入 _releaseLock。
         * @throws {LockAcquireTimeoutError} 超過 LOCK_ACQUIRE_TIMEOUT_MS 仍未取得鎖。
         */
        async _acquireLock(lockKey = LOCK_KEY) {
            const token = Math.random().toString(36).slice(2) + '-' + Date.now();
            const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;

            while (Date.now() < deadline) {
                const raw = await this._safeGet('local', [lockKey]);
                const cur = raw[lockKey];
                const isFree = !cur || Date.now() > cur.expiresAt;

                if (isFree) {
                    await this._safeSet('local', {
                        [lockKey]: { owner: token, expiresAt: Date.now() + LOCK_TTL_MS }
                    });
                    // 寫後驗證（盡力 CAS）：確認 token 已成功儲存
                    const verify = await this._safeGet('local', [lockKey]);
                    if (verify[lockKey]?.owner === token) {
                        return token;
                    }
                    // 同一時間有其他 context 寫入，繼續輪詢重試
                }
                await new Promise(resolve => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
            }
            throw new StorageManager.errors.LockAcquireTimeoutError(
                `Could not acquire lock "${lockKey}" within ${LOCK_ACQUIRE_TIMEOUT_MS}ms`
            );
        },

        /**
         * 冪等釋放指定 key 的鎖。僅在 owner token 符合時才移除鎖記錄。
         * owner 不符時記錄警告（表示 TTL 已被其他 context 接管）。
         * @param {string} lockKey - 鎖定的 storage key
         * @param {string} token - _acquireLock 回傳的 owner token
         */
        async _releaseLock(lockKey, token) {
            const raw = await this._safeGet('local', [lockKey]);
            const cur = raw[lockKey];
            if (cur && cur.owner === token) {
                await this._safeRemove('local', [lockKey]);
            } else {
                warn('chunk-lock:lock-owner-mismatch-on-release',
                    { lockKey, expected: token, actual: cur?.owner });
            }
        },

        /**
         * 便利封裝：取得指定 key 的鎖，執行 fn，並在 finally 中釋放鎖。
         * @template T
         * @param {string} lockKey
         * @param {() => Promise<T>} fn
         * @returns {Promise<T>}
         */
        async _withLock(lockKey, fn) {
            const token = await this._acquireLock(lockKey);
            try {
                return await fn();
            } finally {
                await this._releaseLock(lockKey, token);
            }
        },

        /**
         * 向下相容封裝：取得 chatPresetMap 鎖，執行 fn，並在 finally 中釋放鎖。
         * @template T
         * @param {() => Promise<T>} fn
         * @returns {Promise<T>}
         */
        async _withChatPresetMapLock(fn) {
            return this._withLock(LOCK_KEY, fn);
        },

        /**
         * 有界 CAS 重試單一 chunk 寫入（熱路徑操作）。
         * 每次嘗試前重新讀取 chunk 及 meta.version；
         * 若 meta.version 已前進（表示其他 context 已提交），則使快取失效並重試，
         * 最多重試 RECONCILIATION_RETRY_BUDGET 次。
         *
         * @param {Object} opts
         * @param {number} opts.chunkIdx - 目標 chunk 索引
         * @param {(chunk: Object) => void} opts.applyDelta - 冪等的 chunk 修改函式
         * @throws {WriteReconciliationExhaustedError} 超過重試預算後拋出
         */
        async _writeChunkWithReconciliation({ chunkIdx, applyDelta }) {
            const retryBudget = RECONCILIATION_RETRY_BUDGET;
            let attempt = 0;
            while (attempt <= retryBudget) {
                await this._ensureChunkCachesLoaded();
                const prevVersion = this._metaCache.version;
                const chunkKey = StorageManager.KEYS.CHAT_PRESET_MAP_CHUNK_PREFIX + chunkIdx;
                const raw = await this._get([chunkKey]);
                const chunk = raw[chunkKey] ?? {};
                applyDelta(chunk);
                const newSize = this._byteLen(chunk);
                const newMeta = this._buildNextMeta(this._metaCache, { chunkSizes: [...this._metaCache.chunkSizes] });
                newMeta.chunkSizes[chunkIdx] = newSize;

                // 樂觀 CAS 檢查：重新讀取 meta 確認版號未前進
                const liveMetaRaw = await this._safeGet('sync', [StorageManager.KEYS.CHAT_PRESET_MAP_META]);
                const liveVersion = liveMetaRaw[StorageManager.KEYS.CHAT_PRESET_MAP_META]?.version ?? prevVersion;
                if (liveVersion !== prevVersion) {
                    // 衝突：使快取失效並以最新狀態重試
                    this._metaCache = null;
                    this._chunkIndexCache = null;
                    attempt += 1;
                    continue;
                }

                await this._writeChunkWithMeta(chunkIdx, chunk, newMeta);
                // 寫入可能觸發 onChanged，快取失效監聽器將 _chunkIndexCache 設為 null
                // 若發生此情況，重新載入快取以確保一致性
                if (this._chunkIndexCache === null) {
                    await this._ensureChunkCachesLoaded();
                }
                return;
            }
            throw new StorageManager.errors.WriteReconciliationExhaustedError(
                `chunk ${chunkIdx} write reconciliation exhausted after ${retryBudget + 1} attempts`
            );
        },
    };

    root.__DS_StorageManager_chunklock = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
