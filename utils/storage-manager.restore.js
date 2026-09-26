/**
 * DS Studio — StorageManager 匯入還原方法
 * 負責從匯入的 JSON 物件還原所有設定。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * 從匯入的 JSON 物件還原所有設定。
         * @param {Object} importedSettings
         * @param {boolean} mergePresetsOnly - 若為 true，僅合併 presets 而不覆寫 UI 設定
         */
        async restoreSettings(importedSettings, mergePresetsOnly = false) {
            const currentSettings = await this.getSettings();
            const updates = {};

            // 合併 prompt presets
            if (importedSettings.promptPresets) {
                const mergedPresets = this.mergePresets(currentSettings.promptPresets, importedSettings.promptPresets);
                await this.savePromptPresets(mergedPresets);

                // 清除匯入 preset 的舊 tombstone 記錄，避免使用者刪除全部 preset 後
                // 重新匯入備份還原時，於下次跨裝置同步遭墓碑機制再次判定為已刪除。
                const importedPresetIds = importedSettings.promptPresets
                    .map(preset => preset && preset.id)
                    .filter(Boolean);
                await this.clearPresetTombstones(importedPresetIds);
            }

            // 交由 service worker 將匯入的 chatPresetMap 合併至現有資料
            if (importedSettings.chatPresetMap) {
                await this.mergeChatPresetBindings(importedSettings.chatPresetMap);
            }

            // 其餘設定直接覆寫，除非 mergePresetsOnly 為 true
            if (!mergePresetsOnly) {
                if (importedSettings.activePresetId !== undefined) updates[this.KEYS.ACTIVE_PRESET_ID] = importedSettings.activePresetId;
                if (importedSettings.pinnedPresetId !== undefined) updates[this.KEYS.PINNED_PRESET_ID] = importedSettings.pinnedPresetId;
                // isEnabled / globalPromptEnabled 為裝置層級的本機開關（local-only），
                // 匯入備份不應覆寫當前裝置的開關狀態，故不從 importedSettings 還原。
                if (importedSettings.includeThinking !== undefined) updates[this.KEYS.INCLUDE_THINKING] = importedSettings.includeThinking;
                if (importedSettings.includeReferences !== undefined) updates[this.KEYS.INCLUDE_REFERENCES] = importedSettings.includeReferences;
                if (importedSettings.globalDefaultPrompt !== undefined) updates[this.KEYS.GLOBAL_DEFAULT_PROMPT] = importedSettings.globalDefaultPrompt;
                if (importedSettings.sidebarAutoHide !== undefined) updates[this.KEYS.SIDEBAR_AUTO_HIDE] = importedSettings.sidebarAutoHide;
                if (importedSettings.hideThinking !== undefined) updates[this.KEYS.HIDE_THINKING] = importedSettings.hideThinking;
                if (importedSettings.autoRetry !== undefined) updates[this.KEYS.AUTO_RETRY] = importedSettings.autoRetry;
                if (importedSettings.autoContinue !== undefined) updates[this.KEYS.AUTO_CONTINUE] = importedSettings.autoContinue;
                if (importedSettings.isShowSystemTime !== undefined) updates[this.KEYS.SHOW_SYSTEM_TIME] = importedSettings.isShowSystemTime;
                if (importedSettings.chatWidth !== undefined) updates[this.KEYS.CHAT_WIDTH] = importedSettings.chatWidth;
                if (importedSettings.chatWidthEnabled !== undefined) updates[this.KEYS.CHAT_WIDTH_ENABLED] = importedSettings.chatWidthEnabled;
                if (importedSettings.inputWidth !== undefined) updates[this.KEYS.INPUT_WIDTH] = importedSettings.inputWidth;
                if (importedSettings.inputWidthEnabled !== undefined) updates[this.KEYS.INPUT_WIDTH_ENABLED] = importedSettings.inputWidthEnabled;
            }

            if (Object.keys(updates).length > 0) {
                return this._set(updates);
            }
        },
    };

    root.__DS_StorageManager_restore = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
