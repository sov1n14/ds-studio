/* ===== DS studio i18n System =====
 * Load this script BEFORE all other scripts that use dsI18n.t()
 * For content scripts, add to manifest.json content_scripts js list
 * For popup/editor, use <script src="../utils/i18n.js"></script>
 */

(function () {
  'use strict';

  const DEFAULT_LOCALE = 'zh_TW';
  const STORAGE_KEY = 'ds_studio_locale';

  // ============================================================
  //  LOCALE DISPLAY NAMES
  // ============================================================
  const LOCALE_NAMES = { zh_TW: '中文', en: 'English' };

  // ============================================================
  //  TRANSLATION DATA — Simplified Chinese (zh_TW)
  //  Source of truth; all keys must exist here.
  // ============================================================
  const zh_TW = {
    // ---- Popup: Labels & Section Headers ----
    globalPromptLabel: '全域預設提示詞',
    editGlobalPromptTitle: '編輯全域預設提示詞',
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
    manualSyncButton: '手動同步',

    // ---- Popup: Sync Status ----
    syncStatusSynced: '雲端同步',
    syncStatusUnsynced: '未同步',

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

    // ---- Popup: Manual Sync ----
    syncingButtonText: '同步中…',
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
    renameAriaLabel: '重新命名',
    deleteAriaLabel: '刪除',

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

    // ---- Content Script: Go Top ----
    exportOverlayLoading: '正在載入完整對話，請稍候…',
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
    globalPresetTitle: '全域預設提示詞',
    invalidParamsError: '無效的編輯器參數',
    loadFailedError: '載入失敗，請關閉後重試',
    presetNotFoundError: '找不到提示詞組（可能已被刪除）',
    globalPlaceholder: '輸入全域預設提示詞（會在所有對話中自動插入）',
    presetPlaceholder: '請輸入提示詞內容...',

    // ---- Utils ----
    migratedPresetName: '我的提示詞',
  };

  // ============================================================
  //  TRANSLATION DATA — English (en)
  //  Faithful translation; every key matches zh_TW exactly.
  // ============================================================
  const en = {
    // ---- Popup: Labels & Section Headers ----
    globalPromptLabel: 'Global Default Prompt',
    editGlobalPromptTitle: 'Edit Global Default Prompt',
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
    manualSyncButton: 'Manual Sync',

    // ---- Popup: Sync Status ----
    syncStatusSynced: 'Cloud Synced',
    syncStatusUnsynced: 'Not Synced',

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

    // ---- Popup: Manual Sync ----
    syncingButtonText: 'Syncing…',
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
    renameAriaLabel: 'Rename',
    deleteAriaLabel: 'Delete',

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

    // ---- Content Script: Go Top ----
    exportOverlayLoading: 'Loading full conversation, please wait…',
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
    globalPresetTitle: 'Global Default Prompt',
    invalidParamsError: 'Invalid editor parameters',
    loadFailedError: 'Load failed, please close and try again',
    presetNotFoundError: 'Prompt group not found (may have been deleted)',
    globalPlaceholder: 'Enter the global default prompt (will be inserted in all conversations)',
    presetPlaceholder: 'Enter prompt content...',

    // ---- Utils ----
    migratedPresetName: 'My Prompts',
  };

  // ============================================================
  //  i18n API
  // ============================================================
  const i18n = {
    LOCALE_NAMES: LOCALE_NAMES,

    _data: null,
    _locale: DEFAULT_LOCALE,
    _ready: false,

    /** Initialize — read saved locale from chrome.storage.sync.
     *  Safe to call multiple times; re-reads from storage each time. */
    async init() {
      this._ready = true;
      try {
        const result = await chrome.storage.sync.get(STORAGE_KEY);
        if (result[STORAGE_KEY] && LOCALE_NAMES[result[STORAGE_KEY]]) {
          this._locale = result[STORAGE_KEY];
          this._data = result[STORAGE_KEY] === 'en' ? en : zh_TW;
          try { localStorage.setItem(STORAGE_KEY, this._locale); } catch (_) { /* ignore */ }
        }
      } catch (_e) { /* storage unavailable */ }
      // Ensure _data is populated even when storage is empty/unavailable
      if (this._data === null) {
        this._data = this._locale === 'en' ? en : zh_TW;
      }
    },

    /** Get current locale code (zh_TW | en) */
    getLocale() {
      return this._locale;
    },

    /** Get display name of current locale */
    getLocaleName() {
      return LOCALE_NAMES[this._locale] || this._locale;
    },

    /** For testing only — reset internal state so init() re-reads storage */
    _reset() {
      this._ready = false;
      this._locale = DEFAULT_LOCALE;
      this._data = null;
    },

    /**
     * Switch locale, persist to localStorage (sync) and
     * chrome.storage.sync (async), then reload to refresh all strings.
     */
    async setLocale(locale) {
      if (!LOCALE_NAMES[locale]) return false;
      this._locale = locale;
      this._data = locale === 'en' ? en : zh_TW;
      try { localStorage.setItem(STORAGE_KEY, locale); } catch (_) { /* ignore */ }
      try { await chrome.storage.sync.set({ [STORAGE_KEY]: locale }); } catch (_) { /* ignore */ }
      return true;
    },

    /**
     * Translate a key with optional {placeholder} substitution.
     * @param {string} key — Message key
     * @param {Object} [replacements] — e.g. { name: 'Foo' }
     * @returns {string}
     */
    t(key, replacements) {
      let str =
        this._data?.[key] ??
        zh_TW[key]; // always fall back to source language
      if (str === undefined) return key;
      if (replacements) {
        for (const [k, v] of Object.entries(replacements)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    },

    /**
     * Apply i18n to all DOM elements with [data-i18n] attributes.
     * @param {HTMLElement} [root=document] — Scope to scan
     */
    apply(root) {
      root = root || document;
      const elements = root.querySelectorAll('[data-i18n]');
      for (const el of elements) {
        const key = el.getAttribute('data-i18n');
        const attr = el.getAttribute('data-i18n-attr') || 'textContent';
        if (!key) continue;
        const translation = this.t(key);
        if (attr === 'textContent') {
          el.textContent = translation;
        } else {
          el.setAttribute(attr, translation);
        }
      }
    },
  };

  // ============================================================
  //  Auto-Init (runs once when the script loads)
  // ============================================================
  (function autoInit() {
    // 1. Synchronous init from localStorage (instant — no await)
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached && LOCALE_NAMES[cached]) {
        i18n._locale = cached;
        i18n._data = cached === 'en' ? en : zh_TW;
      }
    } catch (_) { /* localStorage unavailable */ }

    // 2. Async init from chrome.storage.sync (may update cached value)
    i18n.init().then(function () {
      // 3. Auto-apply when DOM is ready (only in browser context)
      if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function onReady() {
            document.removeEventListener('DOMContentLoaded', onReady);
            i18n.apply();
          });
        } else {
          i18n.apply();
        }
      }
    });

    // 4. Live locale switch — listen for storage changes from popup
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'sync' && changes[STORAGE_KEY]) {
          var newVal = changes[STORAGE_KEY].newValue;
          if (newVal && LOCALE_NAMES[newVal] && newVal !== i18n._locale) {
            i18n._locale = newVal;
            i18n._data = newVal === 'en' ? en : zh_TW;
            try { localStorage.setItem(STORAGE_KEY, newVal); } catch (_) { /* ignore */ }
            // Re-apply i18n to DOM elements (static data-i18n attributes)
            i18n.apply();
            // Dispatch custom event so content-script modules can react
            if (typeof document !== 'undefined') {
              try { document.dispatchEvent(new CustomEvent('dsI18n-locale-changed', { detail: { locale: newVal } })); } catch (_) { /* ignore */ }
            }
          }
        }
      });
    }
  })();

  // ============================================================
  //  Export to global scope
  // ============================================================
  // Export: try both globalThis (vitest/happy-dom) and window (browser)
  try { globalThis.dsI18n = i18n; } catch (_) {}
  try { window.dsI18n = i18n; } catch (_) {}
})();
