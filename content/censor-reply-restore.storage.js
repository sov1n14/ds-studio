/**
 * DS studio — Censor Reply Restore :: Storage Bundle
 * 持久化儲存子系統（saveFragment、eviction、load、migration）。
 * 由 censor-reply-restore.js 以 Object.assign 合入。
 * 執行期依賴全域 StorageManager（由 utils/storage-manager.js 提供）。
 */
(function (root) {
    'use strict';

    const bundle = {

        // ────────────────────────────────────────────
        // Subsystem G: Storage management
        // ────────────────────────────────────────────

        async _saveFragment(record) {
            // 以 session-scoped key 儲存，防止不同聊天的相同數字 message_id 互相覆蓋
            const sessionId = record.chat_session_id || null;
            const storeKey = this._recordKey(sessionId, record.message_id);
            this._restoredMessages[storeKey] = {
                message_id: record.message_id,
                fragments: record.fragments,
                restored_at: Date.now(),
                thinking_elapsed_secs: record.thinking_elapsed_secs || 0,
                censored: true,
                chat_session_id: sessionId,
                prompt_key: record.prompt_key || null
            };

            this._evictOldest();

            await StorageManager.saveRestoredMessages(this._restoredMessages);
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
                const data = await StorageManager.getRestoredMessages();
                const raw = data[StorageManager.KEYS.RESTORED_MESSAGES] || {};

                // 清潔策略：移除沒有 censored === true 旗標的項目，同時遷移舊格式 key。
                // 舊格式：key 為純 message_id 數字字串（不含 '::'）
                // 新格式：key 為 "{sessionId}::{messageId}"
                const cleanedData = {};
                var didMigrate = false;
                for (const key in raw) {
                    const record = raw[key];
                    if (!record || record.censored !== true) continue;

                    if (key.indexOf('::') === -1) {
                        // 舊版 key — 以記錄內嵌的 chat_session_id 重新編 key
                        const newKey = this._recordKey(record.chat_session_id, record.message_id);
                        cleanedData[newKey] = record;
                        didMigrate = true;
                    } else {
                        cleanedData[key] = record;
                    }
                }
                this._restoredMessages = cleanedData;

                // 若有清除或遷移，寫回儲存
                const rawCount = Object.keys(raw).length;
                const cleanedCount = Object.keys(cleanedData).length;
                if (didMigrate || cleanedCount !== rawCount) {
                    await StorageManager.saveRestoredMessages(cleanedData);
                }
            } catch (e) {
                this._restoredMessages = {};
            }
        },
    };

    root.__DS_CensorReplyRestore_storage = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
