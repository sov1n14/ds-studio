/* ===== DS studio i18n — zh_TW Locale Data =====
 * 繁體中文翻譯字典。所有鍵皆須存在於此。
 */
(function (root) {
  'use strict';

  const zh_TW = {
    // ---- Popup: Labels & Section Headers ----
    globalPromptLabel: '全域提示詞',
    editGlobalPromptTitle: '編輯全域提示詞',
    presetGroupLabel: '提示詞組',
    addPresetTitle: '新增提示詞組',
    editPresetContentTitle: '編輯提示詞組內容',
    presetSelectPanelAriaLabel: '提示詞組清單',
    searchPresetPlaceholder: '搜尋提示詞組',
    noPresetOption: '（無提示詞組）',
    noSearchResultsHint: '無相符結果',

    // ---- Popup: Feature Toggles & Export ----
    includeThinkingLabel: '匯出包含思考過程 (Thinking Process)',
    includeReferencesLabel: '匯出包含參考連結 (Reference Links)',
    showSystemTimeLabel: '在訊息開頭注入目前系統時間',
    exportMarkdownButton: '匯出當前頁面對話為 Markdown',
    sidebarAutoHideLabel: '側邊欄自動隱藏（保留 60px hover 展開）',
    hideThinkingLabel: '隱藏思考過程',
    preventAutoScrollLabel: '防止自動回滾',
    websearchToggleLabel: '連網搜索',
    websearchOnLabel: '開啟',
    websearchOffLabel: '關閉',
    chatWidthLabel: '對話區域寬度',
    inputWidthLabel: '編輯輸入框寬度',
    narrowLabel: '窄',
    wideLabel: '寬',
    requiredIndicator: '* 必填',
    saveStatus: '已儲存',

    // ---- Popup: Backup & Restore Section ----
    exportLabel: '匯出：',
    exportJsonSettingsButton: '擴充設定',
    exportRestoredBackupButton: '已復原信息',
    importLabel: '匯入：',
    importJsonSettingsButton: '擴充設定',
    importRestoredBackupButton: '已復原信息',
    clearRestoredRecordsButton: '清除所有已還原紀錄',

    // ---- Popup: Sync Status ----
    syncStatusSynced: '雲端同步',
    syncStatusUnsynced: '未同步',
    syncStatusOversized: '內容過大，僅存本機',

    // ---- Popup: Sync Conflict Dialog ----
    syncConflictTitle: '雲端同步衝突',
    syncConflictMessage: '偵測到雲端同步資料與本機資料不一致。是否要將雲端設定與本機資料合併？介面設定將以雲端為主，提示詞則會進行合併。',
    mergeSyncConfirmButton: '合併同步',
    temporarilyCancelButton: '暫時取消',
    syncMergedSuccessToast: '資料已成功合併同步',

    // ---- Popup: Add Preset Dialog ----
    addPresetDialogTitle: '新增提示詞組',
    addPresetPlaceholder: '請輸入提示詞組名稱...',
    duplicateNameTitle: '名稱重複',
    duplicateNameMessage: '「{name}」已存在，請使用不同的名稱。',
    confirmButton: '確定',

    // ---- Popup: Not on DeepSeek ----
    notOnDeepseekTitle: '提示',
    notOnDeepseekMessage: '請在 chat.deepseek.com 頁面使用此功能。',
    exportFailedRefreshToast: '匯出失敗，請重整頁面後再試',

    // ---- Popup: Sync Toasts ----
    syncCompleteToast: '已同步完成',
    syncRemainingToast: '仍有 {count} 項未同步',
    syncFailedToast: '同步失敗',

    // ---- Modal Component ----
    cancelButton: '取消',
    confirmButtonDefault: '確認',

    // ---- Preset Manager: Rename ----
    renamePresetTitle: '重新命名',
    renamePresetPlaceholder: '請輸入新名稱...',
    duplicateNameTitlePresetManager: '名稱重複',
    duplicateNameMessagePresetManager: '「{name}」已存在，請使用不同的名稱。',
    confirmButtonPresetManager: '確定',

    // ---- Preset Manager: Delete ----
    deletePresetTitle: '刪除提示詞組',
    deletePresetMessage: '確定要刪除「{name}」嗎？此操作無法復原。',
    deleteButton: '刪除',

    // ---- Preset Manager: Delete All ----
    deleteAllPresetsTitle: '刪除全部提示詞組',
    deleteAllPresetsMessage: '確定要刪除全部提示詞組嗎？此操作無法復原。',

    // ---- Backup Manager: Export ----
    settingsExportedToast: '設定已成功匯出',
    exportFailedToast: '匯出失敗',

    // ---- Backup Manager: Restore ----
    invalidBackupFormatError: '無效的備份檔案格式',
    restoreSettingsTitle: '還原設定',
    restoreSettingsMessage:
      '確定要匯入嗎？\n• 覆蓋：介面設定、對話綁定、全域提示詞\n• 合併：提示詞組合（相同 ID 保留本地、新組合新增於後）',
    importAndMergeButton: '匯入並合併',
    cancelButtonBackupManager: '取消',
    settingsRestoredToast: '設定已成功還原，請重新整理頁面。',
    restoreFailedTitle: '還原失敗',
    restoreFailedMessage: '讀取備份檔案時發生錯誤：{message}',
    confirmButtonBackupManager: '確定',

    // ---- Backup Manager: Restored Messages Backup ----
    restoredBackupExportedToast: '復原備份已成功匯出',
    invalidRestoredBackupFormatError: '無效的備份檔案格式：缺少 restored_messages',
    restoredBackupImportedToast: '復原備份已成功匯入',
    importFailedTitle: '匯入失敗',
    importFailedMessage: '讀取備份檔案時發生錯誤：{message}',
    confirmButtonImportFailed: '確定',

    // ---- Backup Manager: Clear Restored Messages ----
    clearRestoredRecordsTitle: '清除已還原紀錄',
    clearRestoredRecordsMessage: '確定要清除所有已還原內容嗎？此操作無法復原。',
    clearButton: '清除',
    cancelButtonClearRestored: '取消',
    restoredRecordsClearedToast: '已清除所有復原紀錄',
    clearFailedToast: '清除失敗',

    // ---- Custom Select ----
    noPresetOptionCustomSelect: '（無提示詞組）',
    deleteAriaLabel: '刪除',
    deletePresetTooltip: '刪除提示詞',
    pinPresetAriaLabel: '設為預設（新對話自動選用）',
    pinPresetTooltip: '設為預設（新對話自動選用）',
    unpinPresetAriaLabel: '取消預設',
    unpinPresetTooltip: '取消預設',
    deleteAllPresetsTooltip: '刪除全部提示詞組',

    // ---- Content Script: Censor Reply Restore ----
    restoredBadge: '⚠ 已復原內容（後續對話無法沿用）',
    restoredBadgeThinkOnly: '⚠ 已復原內容（模型在思考階段被屏蔽，僅恢復思考內容；後續對話無法沿用）',
    thinkBlockHeader: '已思考（用時 {seconds} 秒）',

    // ---- Content Script: Export ----
    exportNoConversationAlert: '找不到對話紀錄。請確認您正在 DeepSeek 聊天頁面中。',

    // ---- Content Script: Harvest ----
    harvestScrollingToast: '正在捲動至對話頂端…',
    harvestCapturingToast: '正在擷取完整對話… 已擷取 {count} 則',
    harvestWarning: '⚠ 請勿捲動對話記錄，以免擷取失敗',
    harvestCancelButton: '取消',
    harvestCancelButtonAriaLabel: '取消匯出',
    harvestCancellingButton: '正在取消…',
    harvestCancellingButtonAriaLabel: '正在取消匯出',
    harvestDismissButton: '關閉',
    harvestDismissButtonAriaLabel: '關閉警示',
    harvestIncompleteToast: '匯出未完整：已擷取 {count} 則。原因：{reason}',

    // ---- Content Script: Temporary Chat ----
    tempChatDeleteFailedToast: '臨時對話刪除失敗，請確認網路連線。',

    // ---- Content Script: Go Top ----
    goTopAriaLabel: '回到頂部',

    // ---- Content Script: Quote Reply ----
    quoteReplyBtnLabel: '引用回覆',

    // ---- Content Script: Preset Dropdown ----
    dropdownEmptyOption: '（無）',
    dropdownPlaceholder: '選擇提示詞',
    dropdownComboboxAriaLabel: '選擇提示詞組',
    dropdownListboxAriaLabel: '提示詞組列表',

    // ---- Editor Window ----
    editorPageTitle: '提示詞編輯器',
    editorHeading: '提示詞編輯器',
    savedInitial: '已儲存',
    savingStatus: '儲存中…',
    savedStatus: '已儲存',
    globalPresetTitle: '全域提示詞',
    invalidParamsError: '無效的編輯器參數',
    loadFailedError: '載入失敗，請關閉後重試',
    presetNotFoundError: '找不到提示詞組（可能已被刪除）',
    globalPlaceholder: '輸入全域提示詞（會在所有對話中自動插入）',
    presetPlaceholder: '請輸入提示詞內容...',

    // ---- Utils ----
    migratedPresetName: '我的提示詞',
  };

  root.__DS_I18N_Locales_zhTW = zh_TW;
  if (typeof module !== 'undefined' && module.exports) module.exports = zh_TW;

})(globalThis);
