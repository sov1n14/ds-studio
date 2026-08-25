/**
 * DS studio — Censor Reply Restore / key ↔ messageId 對應表
 * censor-reply-restore.js 的 _keyToMessageId 專用資料結構，載入順序必須在 entry 之前。
 */
(function (root) {
    'use strict';

    /**
     * virtual-list-item key 與 messageId 的雙向對應表：正向 key -> messageId 之外同步維護 messageId -> keys 反向索引，讓「此 messageId 是否已被某個 key 佔用」成為 O(1) 查詢，取代逐筆記錄線性掃描整張表的舊作法（refactor backlog C13）。
     */
    class KeyToMessageIdMap extends Map {
        constructor(entries) {
            super();
            this._keysByMessageId = new Map();
            if (!entries) return;
            for (const [key, messageId] of entries) {
                this.set(key, messageId);
            }
        }

        set(key, messageId) {
            // 覆寫既有 key 時，先釋放它原本佔用的 messageId
            if (super.has(key)) this._releaseMessageId(super.get(key), key);
            var idKey = String(messageId);
            var keys = this._keysByMessageId.get(idKey);
            if (!keys) {
                keys = new Set();
                this._keysByMessageId.set(idKey, keys);
            }
            keys.add(key);
            return super.set(key, messageId);
        }

        delete(key) {
            if (super.has(key)) this._releaseMessageId(super.get(key), key);
            return super.delete(key);
        }

        clear() {
            this._keysByMessageId.clear();
            return super.clear();
        }

        /**
         * 回傳目前對應到該 messageId 的 key，無人佔用時回傳 null。
         * @param {string|number} messageId
         * @returns {string|null}
         */
        findKey(messageId) {
            var keys = this._keysByMessageId.get(String(messageId));
            if (!keys || keys.size === 0) return null;
            return keys.values().next().value;
        }

        _releaseMessageId(messageId, key) {
            var idKey = String(messageId);
            var keys = this._keysByMessageId.get(idKey);
            if (!keys) return;
            keys.delete(key);
            if (keys.size === 0) this._keysByMessageId.delete(idKey);
        }
    }

    root.__DS_CensorKeyToMessageIdMap = KeyToMessageIdMap;
    if (typeof module !== 'undefined' && module.exports) module.exports = KeyToMessageIdMap;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
