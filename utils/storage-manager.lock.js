/**
 * DS Studio — StorageManager 分散式鎖定與樂觀並發控制方法群組
 * 負責 chatPresetMap 跨 context 鎖的取得/釋放，以及帶重試的 CAS 寫入。
 */
(function (root) {
    'use strict';

    // 鎖定相關常數（與 entry file 的常數相同，僅在此模組內使用）
    const LOCK_KEY = 'chatPresetMapLock';
    const LOCK_TTL_MS = 3000;
    const LOCK_ACQUIRE_TIMEOUT_MS = 5000;
    const LOCK_POLL_INTERVAL_MS = 50;
    const RECONCILIATION_RETRY_BUDGET = 3;

    const bundle = {
        /**
         * 睡眠輪詢取得 chatPresetMap 諮詢鎖（存於 chrome.storage.local）。
         * TTL 容錯機制：若持鎖方崩潰，鎖在 LOCK_TTL_MS 後過期，任何請求方均可接管。
         * @returns {Promise<string>} owner token — 必須傳入 _releaseChatPresetMapLock。
         * @throws {LockAcquireTimeoutError} 超過 LOCK_ACQUIRE_TIMEOUT_MS 仍未取得鎖。
         */
        async _acquireChatPresetMapLock() {
            const token = crypto.randomUUID();
            const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;

            while (Date.now() < deadline) {
                const raw = await this._safeGet('local', [LOCK_KEY]);
                const cur = raw[LOCK_KEY];
                const isFree = !cur || Date.now() > cur.expiresAt;

                if (isFree) {
                    await this._safeSet('local', {
                        [LOCK_KEY]: { owner: token, expiresAt: Date.now() + LOCK_TTL_MS }
                    });
                    // 寫後驗證（盡力 CAS）：確認 token 已成功儲存
                    const verify = await this._safeGet('local', [LOCK_KEY]);
                    if (verify[LOCK_KEY]?.owner === token) {
                        return token;
                    }
                    // 同一時間有其他 context 寫入；繼續輪詢重試
                }
                await new Promise(resolve => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
            }
            throw new StorageManager.errors.LockAcquireTimeoutError(
                `Could not acquire chatPresetMap lock within ${LOCK_ACQUIRE_TIMEOUT_MS}ms`
            );
        },

        /**
         * 冪等釋放鎖。僅在 owner token 符合時才移除鎖記錄。
         * owner 不符時記錄警告（表示 TTL 已被其他 context 接管）。
         * @param {string} token - _acquireChatPresetMapLock 回傳的 owner token
         */
        async _releaseChatPresetMapLock(token) {
            const raw = await this._safeGet('local', [LOCK_KEY]);
            const cur = raw[LOCK_KEY];
            if (cur && cur.owner === token) {
                await this._safeRemove('local', [LOCK_KEY]);
            } else {
                console.warn('[StorageManager] lock owner mismatch on release — TTL takeover likely',
                    { expected: token, actual: cur?.owner });
            }
        },

        /**
         * 便利封裝：取得鎖 → 執行 fn → 在 finally 中釋放鎖。
         * @template T
         * @param {() => Promise<T>} fn
         * @returns {Promise<T>}
         */
        async _withChatPresetMapLock(fn) {
            const token = await this._acquireChatPresetMapLock();
            try {
                return await fn();
            } finally {
                await this._releaseChatPresetMapLock(token);
            }
        },

        /**
         * 有界 CAS 重試單一 chunk 寫入（熱路徑操作）。
         * 每次嘗試前重新讀取 chunk 及 meta.version；
         * 若 meta.version 已前進（表示其他 context 已提交），則使快取失效並重試，
         * 最多重試 retryBudget 次。
         *
         * @param {Object} opts
         * @param {number} opts.chunkIdx - 目標 chunk 索引
         * @param {(chunk: Object) => void} opts.applyDelta - 冪等的 chunk 修改函式
         * @param {number} [opts.retryBudget=RECONCILIATION_RETRY_BUDGET] - 最大重試次數
         * @throws {WriteReconciliationExhaustedError} 超過重試預算後拋出
         */
        async _writeChunkWithReconciliation({ chunkIdx, applyDelta, retryBudget = RECONCILIATION_RETRY_BUDGET }) {
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
                // 寫入可能觸發 onChanged → 快取失效監聽器將 _chunkIndexCache 設為 null
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

    root.__DS_StorageManager_lock = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
