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

        getRestoredMessages() {
            return this._safeGet('local', this.KEYS.RESTORED_MESSAGES);
        },

        saveRestoredMessages(messages) {
            return this._safeSet('local', { [this.KEYS.RESTORED_MESSAGES]: messages });
        },
    };

    root.__DS_StorageManager_local = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
