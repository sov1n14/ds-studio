/**
 * DS Studio — StorageManager 本機專屬（local-only）設定方法群組
 * 負責僅存於裝置本機、不參與 chrome.storage.sync 同步／備份還原的設定：
 * 主功能開關、全域預設提示詞啟用狀態、已還原訊息快取。
 * 這些設定屬於裝置層級的操作狀態，不應隨帳號跨裝置同步。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * Save the enabled state
         * 僅存本機（local-only），不參與同步／備份還原，理由與 restored_messages 相同：
         * 屬於裝置層級的功能開關，不應隨帳號跨裝置同步。
         * @param {boolean} isEnabled
         */
        async saveEnabledState(isEnabled) {
            return this._safeSet('local', { [this.KEYS.IS_ENABLED]: isEnabled });
        },

        /**
         * 儲存全域預設提示詞啟用狀態
         * 僅存本機（local-only），不參與同步／備份還原，理由同上。
         * @param {boolean} enabled
         */
        async saveGlobalPromptEnabled(enabled) {
            return this._safeSet('local', { [this.KEYS.GLOBAL_PROMPT_ENABLED]: enabled });
        },

        /**
         * 讀取已還原訊息快取，回傳訊息 map 本身（以訊息 key 為鍵）。
         * 從未寫入時回傳空物件 {}。
         * @returns {Promise<Object>}
         */
        async getRestoredMessages() {
            const data = await this._safeGet('local', this.KEYS.RESTORED_MESSAGES);
            return data[this.KEYS.RESTORED_MESSAGES] || {};
        },

        saveRestoredMessages(messages) {
            return this._safeSet('local', { [this.KEYS.RESTORED_MESSAGES]: messages });
        },

        /**
         * 將 entries 淺層合併進既有快取；鍵衝突時以傳入值覆蓋既有值。
         * 僅寫入 chrome.storage.local，不進入 sync（屬裝置層級資料）。
         * @param {Object} entries
         * @returns {Promise<Object>} 合併後的完整 map
         */
        async mergeRestoredMessages(entries) {
            const merged = { ...(await this.getRestoredMessages()), ...entries };
            await this.saveRestoredMessages(merged);
            return merged;
        },

        /**
         * 移除整個已還原訊息快取 key；未曾寫入時為 no-op。
         * @returns {Promise<void>}
         */
        clearRestoredMessages() {
            return this._safeRemove('local', this.KEYS.RESTORED_MESSAGES);
        },
    };

    root.__DS_StorageManager_local = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
