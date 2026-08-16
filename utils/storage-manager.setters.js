/**
 * DS Studio — StorageManager 單鍵設定值 setter 方法群組
 * 負責同步至 chrome.storage.sync（經由 this._set）的單鍵布林／字串／數值設定寫入。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * Save the active preset ID
         * @param {string} id
         */
        async saveActivePresetId(id) {
            return this._set({ [this.KEYS.ACTIVE_PRESET_ID]: id });
        },

        /**
         * Save the pinned (default) preset group ID
         * @param {string} id
         */
        async savePinnedPresetId(id) {
            return this._set({ [this.KEYS.PINNED_PRESET_ID]: id });
        },

        /**
         * Save include thinking state
         * @param {boolean} includeThinking
         */
        async saveIncludeThinking(includeThinking) {
            return this._set({ [this.KEYS.INCLUDE_THINKING]: includeThinking });
        },

        /**
         * Save include references state
         * @param {boolean} includeReferences
         */
        async saveIncludeReferences(includeReferences) {
            return this._set({ [this.KEYS.INCLUDE_REFERENCES]: includeReferences });
        },

        async saveGlobalDefaultPrompt(content) {
            return this._set({ [this.KEYS.GLOBAL_DEFAULT_PROMPT]: content });
        },

        async saveSidebarAutoHide(enabled) {
            return this._set({ [this.KEYS.SIDEBAR_AUTO_HIDE]: enabled });
        },

        async saveHideThinking(enabled) {
            return this._set({ [this.KEYS.HIDE_THINKING]: enabled });
        },

        async savePreventAutoScroll(enabled) {
            return this._set({ [this.KEYS.PREVENT_AUTO_SCROLL]: enabled });
        },

        async saveWebsearchToggle(value) { return this._set({ [this.KEYS.WEBSEARCH_TOGGLE]: value }); },

        async saveShowSystemTime(enabled) {
            return this._set({ [this.KEYS.SHOW_SYSTEM_TIME]: enabled });
        },

        async saveChatWidth(percent) {
            return this._set({ [this.KEYS.CHAT_WIDTH]: percent });
        },

        async saveChatWidthEnabled(enabled) {
            return this._set({ [this.KEYS.CHAT_WIDTH_ENABLED]: enabled });
        },

        async saveInputWidth(percent) {
            return this._set({ [this.KEYS.INPUT_WIDTH]: percent });
        },

        async saveInputWidthEnabled(enabled) {
            return this._set({ [this.KEYS.INPUT_WIDTH_ENABLED]: enabled });
        },
    };

    root.__DS_StorageManager_setters = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
