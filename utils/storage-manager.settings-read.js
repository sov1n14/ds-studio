/**
 * DS Studio — StorageManager 設定讀取方法群組
 * 負責彙整使用者設定的讀取路徑（設定白名單、getSettings、作用中提示詞內容）。
 */
(function (root) {
    'use strict';

    /**
     * getSettings() 的使用者設定白名單：回傳物件的欄位名 → KEYS 上的成員名。
     * 白名單是唯一的收錄依據 —— 未列於此的 KEYS 成員（同步重試簿記、分塊佈局
     * 元資料、金鑰前綴常數等）一律屬於內部細節，不得出現在回傳的設定物件裡。
     */
    const SYNCED_SETTINGS_KEYS = {
        presetIndex: 'PRESET_INDEX',
        activePresetId: 'ACTIVE_PRESET_ID',
        pinnedPresetId: 'PINNED_PRESET_ID',
        includeThinking: 'INCLUDE_THINKING',
        includeReferences: 'INCLUDE_REFERENCES',
        globalDefaultPrompt: 'GLOBAL_DEFAULT_PROMPT',
        sidebarAutoHide: 'SIDEBAR_AUTO_HIDE',
        hideThinking: 'HIDE_THINKING',
        preventAutoScroll: 'PREVENT_AUTO_SCROLL',
        websearchToggle: 'WEBSEARCH_TOGGLE',
        isShowSystemTime: 'SHOW_SYSTEM_TIME',
        chatWidth: 'CHAT_WIDTH',
        chatWidthEnabled: 'CHAT_WIDTH_ENABLED',
        inputWidth: 'INPUT_WIDTH',
        inputWidthEnabled: 'INPUT_WIDTH_ENABLED',
        syncInitialized: 'SYNC_INITIALIZED',
        syncConflictPending: 'SYNC_CONFLICT_PENDING',
    };

    /**
     * 裝置層級的本機開關：只讀 chrome.storage.local，不走 sync 合併路徑。
     */
    const LOCAL_ONLY_SETTINGS_KEYS = {
        isEnabled: 'IS_ENABLED',
        globalPromptEnabled: 'GLOBAL_PROMPT_ENABLED',
    };

    const bundle = {
        /**
         * Get all settings
         * @returns {Promise<Object>} Object containing all settings
         */
        async getSettings() {
            const syncedStorageKeys = Object.values(SYNCED_SETTINGS_KEYS).map(name => this.KEYS[name]);
            const localOnlyStorageKeys = Object.values(LOCAL_ONLY_SETTINGS_KEYS).map(name => this.KEYS[name]);

            const data = await this._get(syncedStorageKeys);
            const localOnlyData = await this._safeGet('local', localOnlyStorageKeys);

            // Fetch individual presets based on index
            const presetIds = data[this.KEYS.PRESET_INDEX] || [];
            const presetData = await this._get(presetIds.map(id => this._presetKey(id)));
            const presets = presetIds.map(id => presetData[this._presetKey(id)]).filter(Boolean);

            const settings = {};
            for (const [settingsKey, name] of Object.entries(SYNCED_SETTINGS_KEYS)) {
                const storageKey = this.KEYS[name];
                settings[settingsKey] = data[storageKey] ?? this.DEFAULTS[storageKey];
            }
            for (const [settingsKey, name] of Object.entries(LOCAL_ONLY_SETTINGS_KEYS)) {
                const storageKey = this.KEYS[name];
                settings[settingsKey] = localOnlyData[storageKey] ?? this.DEFAULTS[storageKey];
            }

            // 舊版遺留值的校正規則集中於 StorageManager.normalizeWebsearchToggle，讀取路徑共用
            settings.websearchToggle = this.normalizeWebsearchToggle(settings.websearchToggle);

            settings.promptPresets = presets;
            // chatPresetMap 只有分塊式版本，不從上方的合併資料取得
            settings.chatPresetMap = await this.getChatPresetMap();

            return settings;
        },

        /**
         * Get the content of the currently active preset
         * @returns {Promise<string>} The active preset content
         */
        async getActivePromptContent() {
            const data = await this._get([this.KEYS.PRESET_INDEX, this.KEYS.ACTIVE_PRESET_ID]);
            const ids = data[this.KEYS.PRESET_INDEX] || [];
            const activeId = data[this.KEYS.ACTIVE_PRESET_ID] ?? this.DEFAULTS.activePresetId;

            if (!activeId || !ids.includes(activeId)) return '';

            const presetData = await this._get([this._presetKey(activeId)]);
            const active = presetData[this._presetKey(activeId)];
            return active?.content ?? '';
        },
    };

    root.__DS_StorageManager_settingsRead = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
