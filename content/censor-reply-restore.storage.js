/**
 * DS studio — Censor Reply Restore :: Storage Bundle
 * 持久化儲存子系統（saveFragment、eviction、load、migration）。
 * 由 censor-reply-restore.js 以 Object.assign 合入。
 * 執行期依賴全域 StorageManager（由 utils/storage-manager.js 提供）。
 */
(function (root) {
    'use strict';

    // 存檔期間清除世代持續變動時的重讀上限，避免清除連續發生時無限重讀
    const SNAPSHOT_REREAD_LIMIT = 3;

    // 讀取失敗、目前世代未知時的讀取結果：不依世代移除記憶體記錄，也不合併任何讀到的記錄
    function unknownGenerationResult() {
        return { records: {}, currentGeneration: null };
    }

    const bundle = {

        // 本實例最後確認的清除世代（載入、存檔讀取或清除後重讀時更新）；從未確認時為 null
        _lastKnownClearGeneration: null,

        // ────────────────────────────────────────────
        // Subsystem G: Storage management
        // ────────────────────────────────────────────

        async _saveFragment(record) {
            // 以 session-scoped key 儲存，防止不同聊天的相同數字 message_id 互相覆蓋
            const sessionId = record.chat_session_id || null;
            const storeKey = this._recordKey(sessionId, record.message_id);
            // 新建的記錄物件尚無世代標記：它在清除之後才寫入，其他存檔不可把它當成清除前的記錄移除
            const liveRecord = {
                message_id: record.message_id,
                fragments: record.fragments,
                restored_at: Date.now(),
                thinking_elapsed_secs: record.thinking_elapsed_secs || 0,
                censored: true,
                chat_session_id: sessionId,
                prompt_key: record.prompt_key || null
            };
            // 先同步寫入記憶體：呼叫端不 await，緊接著就以 _restoredMessages 嘗試還原
            this._restoredMessages[storeKey] = liveRecord;

            // 讀取其他情境（彈出視窗匯入、其他分頁）在本分頁載入後寫入的記錄，並確認其屬於目前的清除世代
            const { records: storedRecords, currentGeneration } = await this._readStoredRecordsOfCurrentGeneration();

            // 確認清除世代之後到寫入之前不再 await，避免合併結果在寫入前又過期
            if (currentGeneration !== null) this._confirmClearGeneration(currentGeneration);
            // 讀取失敗時本次記錄標記為最後確認的世代，之後的清除仍能把它當成清除前的記錄移除
            this._adoptRecords({ ...storedRecords, [storeKey]: liveRecord }, this._lastKnownClearGeneration);
            this._evictOldest();

            await StorageManager.saveRestoredMessages(this._restoredMessages);
        },

        // 讀取持久化記錄並確認讀取之後未再發生清除；期間發生清除時重讀，讓其他情境在清除後寫入的記錄得以合併，最多重讀 SNAPSHOT_REREAD_LIMIT 次
        async _readStoredRecordsOfCurrentGeneration() {
            let snapshot = await this._readCleanedStoredRecords();
            if (snapshot.clearGeneration === null) return unknownGenerationResult();
            let currentGeneration = await this._readCurrentClearGeneration();
            if (currentGeneration === null) return unknownGenerationResult();
            for (let rereadCount = 0; currentGeneration !== snapshot.clearGeneration && rereadCount < SNAPSHOT_REREAD_LIMIT; rereadCount++) {
                const reread = await this._readCleanedStoredRecords();
                const rereadGeneration = reread.clearGeneration === null ? null : await this._readCurrentClearGeneration();
                // 重讀或其世代讀取失敗：保留已知的目前世代以移除清除前的記錄，但不合併任何讀到的記錄
                if (rereadGeneration === null) return { records: {}, currentGeneration };
                snapshot = reread;
                currentGeneration = rereadGeneration;
            }
            // 讀取之後沒有發生清除，讀到的記錄才屬於目前世代、可以合併
            return { records: currentGeneration === snapshot.clearGeneration ? snapshot.records : {}, currentGeneration };
        },

        // 讀取並清潔目前持久化的記錄與清除世代；讀取失敗時回傳空記錄與 null 世代，讓本次記錄仍以記憶體內容寫入
        async _readCleanedStoredRecords() {
            try {
                const { records, clearGeneration } = await StorageManager.getRestoredMessagesSnapshot();
                return { records: this._cleanStoredRecords(records).records, clearGeneration };
            } catch (e) {
                root.__DS_Logger?.warn('censor-reply-restore: read before save failed, saving in-memory records only', e);
                return { records: {}, clearGeneration: null };
            }
        },

        // 讀取目前的清除世代；讀取失敗時回傳 null（未知），絕不當成世代 0
        async _readCurrentClearGeneration() {
            try {
                return await StorageManager.getRestoredMessagesClearGeneration();
            } catch (e) {
                root.__DS_Logger?.warn('censor-reply-restore: clear generation read failed', e);
                return null;
            }
        },

        // 清除持久化記錄，並重讀清除後的世代，讓之後讀取全失敗的存檔記錄標記為清除後的世代
        async _clearStoredRecords() {
            await StorageManager.clearRestoredMessages();
            this._lastKnownClearGeneration = await this._readCurrentClearGeneration();
        },

        // 每筆記憶體記錄物件最後確認時的清除世代（記錄物件 → 世代），每個實例各自持有；以 WeakMap 依記錄物件標記，記錄離開記憶體後標記隨之回收，不需另行清理
        _recordGenerationMap() {
            if (!(this._recordGenerations instanceof WeakMap)) this._recordGenerations = new WeakMap();
            return this._recordGenerations;
        },

        // 確認目前的清除世代：移除記憶體中標記為其他世代的記錄（清除前存過或讀到的記錄），並記下此世代；未標記（存檔中）或標記為未知世代（null）的記錄保留
        _confirmClearGeneration(currentGeneration) {
            const generations = this._recordGenerationMap();
            for (const key of Object.keys(this._restoredMessages)) {
                const generation = generations.get(this._restoredMessages[key]);
                // 寬鬆比較 != null 同時涵蓋未標記（undefined）與未知世代（null）
                if (generation != null && generation !== currentGeneration) delete this._restoredMessages[key];
            }
            this._lastKnownClearGeneration = currentGeneration;
        },

        // 將記錄放入記憶體並標記其清除世代
        _adoptRecords(records, generation) {
            const generations = this._recordGenerationMap();
            for (const key in records) {
                this._restoredMessages[key] = records[key];
                generations.set(records[key], generation);
            }
        },

        // 清潔策略：移除沒有 censored === true 旗標的項目，同時遷移舊格式 key。
        // 舊格式：key 為純 message_id 數字字串（不含 '::'）
        // 新格式：key 為 "{sessionId}::{messageId}"
        _cleanStoredRecords(raw) {
            const records = {};
            let hasMigrated = false;
            for (const key in raw) {
                const record = raw[key];
                if (!record || record.censored !== true) continue;

                if (key.indexOf('::') === -1) {
                    // 舊版 key — 以記錄內嵌的 chat_session_id 重新編 key
                    records[this._recordKey(record.chat_session_id, record.message_id)] = record;
                    hasMigrated = true;
                } else {
                    records[key] = record;
                }
            }
            return { records, hasMigrated };
        },

        _evictOldest() {
            const entries = Object.entries(this._restoredMessages);
            if (entries.length <= this.STORAGE_MAX_ENTRIES) return;

            entries.sort((a, b) => a[1].restored_at - b[1].restored_at);
            const toDelete = entries.length - this.STORAGE_MAX_ENTRIES;
            for (let i = 0; i < toDelete; i++) {
                delete this._restoredMessages[entries[i][0]];
            }
        },

        async _loadRestoredMessages() {
            try {
                // 先讀清除世代再讀記錄：兩次讀取之間若發生清除，記錄只會被標成較舊的世代而在下次存檔時移出記憶體（仍在 storage 的會再合併回來），清除前的記錄不會被當成目前世代
                const clearGeneration = await StorageManager.getRestoredMessagesClearGeneration();
                const raw = await StorageManager.getRestoredMessages();
                const { records: cleanedData, hasMigrated } = this._cleanStoredRecords(raw);
                this._restoredMessages = {};
                this._lastKnownClearGeneration = clearGeneration;
                this._adoptRecords(cleanedData, clearGeneration);

                // 若有清除或遷移，寫回儲存
                const rawCount = Object.keys(raw).length;
                const cleanedCount = Object.keys(cleanedData).length;
                if (hasMigrated || cleanedCount !== rawCount) {
                    await StorageManager.saveRestoredMessages(cleanedData);
                }
            } catch (e) {
                this._restoredMessages = {};
            }
        },
    };

    root.__DS_CensorReplyRestore_storage = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(globalThis);
