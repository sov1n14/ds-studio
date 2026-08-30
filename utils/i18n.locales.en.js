/* ===== DS studio i18n — en Locale Data =====
 * English translation dictionary. Every key matches zh_TW exactly.
 */
(function (root) {
  'use strict';

  const en = {
    // ---- Popup: Labels & Section Headers ----
    globalPromptLabel: 'Global Prompt',
    editGlobalPromptTitle: 'Edit Global Prompt',
    presetGroupLabel: 'Prompt Group',
    addPresetTitle: 'Add Prompt Group',
    editPresetContentTitle: 'Edit Prompt Group Content',
    presetSelectPanelAriaLabel: 'Prompt Group List',
    searchPresetPlaceholder: 'Search Prompt Group',
    noPresetOption: '(No Prompt Group)',
    noSearchResultsHint: 'No Results Found',

    // ---- Popup: Feature Toggles & Export ----
    includeThinkingLabel: 'Include Thinking Process in Export',
    includeReferencesLabel: 'Include Reference Links in Export',
    showSystemTimeLabel: 'Inject Current System Time at Message Start',
    exportMarkdownButton: 'Export Current Page Conversation as Markdown',
    sidebarAutoHideLabel: 'Auto-hide Sidebar (60px on hover to expand)',
    hideThinkingLabel: 'Collapse Thinking Process',
    autoExpandMessagesLabel: 'Auto-expand messages',
    preventAutoScrollLabel: 'Prevent Auto-Scroll',
    websearchToggleLabel: 'Web Search',
    websearchOnLabel: 'On',
    websearchOffLabel: 'Off',
    chatWidthLabel: 'Conversation Area Width',
    inputWidthLabel: 'Input Box Width',
    narrowLabel: 'Narrow',
    wideLabel: 'Wide',
    requiredIndicator: '* Required',
    saveStatus: 'Saved',

    // ---- Popup: Backup & Restore Section ----
    exportLabel: 'Export:',
    exportJsonSettingsButton: 'Extension Settings',
    exportRestoredBackupButton: 'Restored Messages',
    importLabel: 'Import:',
    importJsonSettingsButton: 'Extension Settings',
    importRestoredBackupButton: 'Restored Messages',
    clearRestoredRecordsButton: 'Clear All Restored Messages',

    // ---- Popup: Sync Status ----
    syncStatusSynced: 'Cloud Synced',
    syncStatusUnsynced: 'Not Synced',
    syncStatusOversized: 'Too Large — Local Only',

    // ---- Popup: Sync Conflict Dialog ----
    syncConflictTitle: 'Cloud Sync Conflict',
    syncConflictMessage: 'Cloud data differs from local data. Merge cloud settings with local data? Interface settings will use the cloud version; prompt groups will be merged.',
    mergeSyncConfirmButton: 'Merge Sync',
    temporarilyCancelButton: 'Dismiss Temporarily',
    syncMergedSuccessToast: 'Data has been merged and synced successfully',

    // ---- Popup: Add Preset Dialog ----
    addPresetDialogTitle: 'Add Prompt Group',
    addPresetPlaceholder: 'Enter prompt group name...',
    duplicateNameTitle: 'Duplicate Name',
    duplicateNameMessage: '"{name}" already exists, please use a different name.',
    confirmButton: 'OK',

    // ---- Popup: Not on DeepSeek ----
    notOnDeepseekTitle: 'Notice',
    notOnDeepseekMessage: 'Please use this feature on the chat.deepseek.com page.',
    exportFailedRefreshToast: 'Export failed, please refresh the page and try again',

    // ---- Popup: Sync Toasts ----
    syncCompleteToast: 'Sync completed',
    syncRemainingToast: '{count} item(s) not synced',
    syncFailedToast: 'Sync failed',

    // ---- Modal Component ----
    cancelButton: 'Cancel',
    confirmButtonDefault: 'Confirm',

    // ---- Preset Manager: Rename ----
    renamePresetTitle: 'Rename',
    renamePresetPlaceholder: 'Enter a new name...',
    duplicateNameTitlePresetManager: 'Duplicate Name',
    duplicateNameMessagePresetManager: '"{name}" already exists, please use a different name.',
    confirmButtonPresetManager: 'OK',

    // ---- Preset Manager: Delete ----
    deletePresetTitle: 'Delete Prompt Group',
    deletePresetMessage: 'Are you sure you want to delete "{name}"? This action cannot be undone.',
    deleteButton: 'Delete',

    // ---- Preset Manager: Delete All ----
    deleteAllPresetsTitle: 'Delete All Prompt Groups',
    deleteAllPresetsMessage: 'Are you sure you want to delete all prompt groups? This action cannot be undone.',

    // ---- Backup Manager: Export ----
    settingsExportedToast: 'Settings exported successfully',
    exportFailedToast: 'Export failed',

    // ---- Backup Manager: Restore ----
    invalidBackupFormatError: 'Invalid backup file format',
    restoreSettingsTitle: 'Restore Settings',
    restoreSettingsMessage:
      'Import this backup?\n• Overwrite: Interface settings, conversation bindings, global prompt\n• Merge: Prompt groups (same ID keeps local, new ones appended)',
    importAndMergeButton: 'Import & Merge',
    cancelButtonBackupManager: 'Cancel',
    settingsRestoredToast: 'Settings restored successfully. Please refresh the page.',
    restoreFailedTitle: 'Restore Failed',
    restoreFailedMessage: 'Error reading backup file: {message}',
    confirmButtonBackupManager: 'OK',

    // ---- Backup Manager: Restored Messages Backup ----
    restoredBackupExportedToast: 'Restored Messages backup exported successfully',
    invalidRestoredBackupFormatError: 'Invalid backup format: missing restored_messages',
    restoredBackupImportedToast: 'Restored Messages backup imported successfully',
    importFailedTitle: 'Import Failed',
    importFailedMessage: 'Error reading backup file: {message}',
    confirmButtonImportFailed: 'OK',

    // ---- Backup Manager: Clear Restored Messages ----
    clearRestoredRecordsTitle: 'Clear Restored Messages',
    clearRestoredRecordsMessage: 'Are you sure you want to clear all restored content? This action cannot be undone.',
    clearButton: 'Clear',
    cancelButtonClearRestored: 'Cancel',
    restoredRecordsClearedToast: 'All Restored Messages cleared',
    clearFailedToast: 'Clear failed',

    // ---- Custom Select ----
    noPresetOptionCustomSelect: '(No Prompt Group)',
    deleteAriaLabel: 'Delete',
    deletePresetTooltip: 'Delete prompt',
    pinPresetAriaLabel: 'Set as default (auto-selected for new conversations)',
    pinPresetTooltip: 'Set as default (auto-selected for new conversations)',
    unpinPresetAriaLabel: 'Unset default',
    unpinPresetTooltip: 'Unset default',
    deleteAllPresetsTooltip: 'Delete all prompt groups',

    // ---- Content Script: Censor Reply Restore ----
    restoredBadge: '⚠ Content Restored (cannot be used in subsequent dialogue)',
    restoredBadgeThinkOnly: '⚠ Content Restored (model was censored during thinking phase; only thought content recovered; cannot be used in subsequent dialogue)',
    thinkBlockHeader: 'Thought for {seconds} seconds',

    // ---- Content Script: Export ----
    exportNoConversationAlert: 'No conversation found. Please make sure you are on a DeepSeek chat page.',

    // ---- Content Script: Harvest ----
    harvestScrollingToast: 'Scrolling to the top of the conversation…',
    harvestCapturingToast: 'Capturing full conversation… {count} messages captured',
    harvestWarning: '⚠ Do not scroll the conversation history to avoid capture failure',
    harvestCancelButton: 'Cancel',
    harvestCancelButtonAriaLabel: 'Cancel export',
    harvestCancellingButton: 'Cancelling…',
    harvestCancellingButtonAriaLabel: 'Cancelling export',
    harvestDismissButton: 'Dismiss',
    harvestDismissButtonAriaLabel: 'Dismiss warning',
    harvestIncompleteToast: 'Export incomplete: {count} messages captured. Reason: {reason}',

    // ---- Content Script: Temporary Chat ----
    tempChatDeleteFailedToast: 'Failed to delete the temporary chat. Please check your network connection.',

    // ---- Content Script: Go Top ----
    goTopAriaLabel: 'Back to Top',

    // ---- Content Script: Quote Reply ----
    quoteReplyBtnLabel: 'Quote Reply',

    // ---- Content Script: Preset Dropdown ----
    dropdownEmptyOption: '(None)',
    dropdownPlaceholder: 'Select Prompt',
    dropdownComboboxAriaLabel: 'Select Prompt Group',
    dropdownListboxAriaLabel: 'Prompt Group List',

    // ---- Editor Window ----
    editorPageTitle: 'Prompt Editor',
    editorHeading: 'Prompt Editor',
    savedInitial: 'Saved',
    savingStatus: 'Saving…',
    savedStatus: 'Saved',
    globalPresetTitle: 'Global Prompt',
    invalidParamsError: 'Invalid editor parameters',
    loadFailedError: 'Load failed, please close and try again',
    presetNotFoundError: 'Prompt group not found (may have been deleted)',
    globalPlaceholder: 'Enter the global prompt (will be inserted in all conversations)',
    presetPlaceholder: 'Enter prompt content...',

    // ---- Utils ----
    migratedPresetName: 'My Prompts',
  };

  root.__DS_I18N_Locales_en = en;
  if (typeof module !== 'undefined' && module.exports) module.exports = en;

})(globalThis);
