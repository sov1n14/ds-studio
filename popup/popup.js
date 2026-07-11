/**
 * DS studio — Popup Controller（入口）
 * 依賴：popup.modal.js（Modal, Toast）、custom-select.js（createPresetCustomSelect）、
 *       popup.preset-manager.js（requestAddPreset/requestEditPreset/requestDeletePreset/requestDeleteAllPresets）、
 *       popup.backup-manager.js（bindExportJson 等）、popup.live-sync.js（startLiveSync）、
 *       popup.editor-windows.js（openEditorWindow）、popup.settings-controls.js（bindSettingsControls）
 * 需在本檔案之前以 <script> 載入上述模組。
 */

// --- DOM refs（供本檔案與其他 sub-module 共用） ---
const enableToggle              = document.getElementById('enableToggle');
const includeThinkingToggle     = document.getElementById('includeThinkingToggle');
const includeReferencesToggle   = document.getElementById('includeReferencesToggle');
const showSystemTimeToggle      = document.getElementById('showSystemTimeToggle');
const saveStatus                = document.getElementById('saveStatus');
const addPresetBtn              = document.getElementById('addPresetBtn');
const editPresetBtn             = document.getElementById('editPresetBtn');
const editGlobalPromptBtn       = document.getElementById('editGlobalPromptBtn');
const globalPromptToggle        = document.getElementById('globalPromptToggle');
const sidebarAutoHideToggle     = document.getElementById('sidebarAutoHideToggle');
const hideThinkingToggle        = document.getElementById('hideThinkingToggle');
const chatWidthToggle           = document.getElementById('chatWidthToggle');
const chatWidthSlider           = document.getElementById('chatWidthSlider');
const chatWidthValue            = document.getElementById('chatWidthValue');
const chatWidthSliderContainer  = document.getElementById('chatWidthSliderContainer');
const inputWidthToggle          = document.getElementById('inputWidthToggle');
const inputWidthSlider          = document.getElementById('inputWidthSlider');
const inputWidthValue           = document.getElementById('inputWidthValue');
const inputWidthSliderContainer = document.getElementById('inputWidthSliderContainer');
const syncStatusEl              = document.getElementById('syncStatus');

let saveTimeout;

// --- 共享 popup 狀態（取代先前散落在 DOMContentLoaded 閉包中的變數） ---
const popupState = {
    presets: [],
    activePresetId: null,
    chatPresetMap: {},
    currentTabUuid: undefined,
    customSelect: null,
    globalEditorWindowId: null,
    presetEditorWindowId: null,
};

// ────────────────────────────────────────────
// Helpers（頂層宣告，供其他 sub-module 直接呼叫）
// ────────────────────────────────────────────

/** 依主開關狀態切換子控制項 disabled */
function applyMasterSwitchUI(isEnabled) {
    const subControls = [
        sidebarAutoHideToggle,
        hideThinkingToggle,
        showSystemTimeToggle,
        chatWidthToggle, chatWidthSlider,
        inputWidthToggle, inputWidthSlider
    ];
    subControls.forEach(el => {
        if (el) el.disabled = !isEnabled;
    });
}

async function refreshSyncStatus() {
    try {
        const isSynced = await StorageManager.isSyncedWithCloud();
        const isOversized = await StorageManager.hasOversizedItems();
        const el = document.getElementById('syncStatus');
        el.classList.toggle('synced',   isSynced && !isOversized);
        el.classList.toggle('unsynced', !isSynced || isOversized);
        el.textContent = isOversized
            ? dsI18n.t('syncStatusOversized')
            : (isSynced ? dsI18n.t('syncStatusSynced') : dsI18n.t('syncStatusUnsynced'));
    } catch (e) { /* 靜默忽略 — 僅為 UI 提示 */ }
}

function showSaveStatus() {
    saveStatus.classList.remove('status-hidden');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveStatus.classList.add('status-hidden');
    }, 1000);
}

/** 依目前活躍提示詞組更新鉛筆按鈕的停用狀態 */
function updateEditPresetBtnState() {
    if (editPresetBtn) {
        editPresetBtn.disabled = (popupState.activePresetId === '');
    }
}

/** 廣播目前活躍提示詞組至內容腳本 */
function sendActivePresetToContentScript() {
    const preset  = popupState.presets.find(p => p.id === popupState.activePresetId);
    const content = preset?.content ?? '';
    window.DSVMessaging?.broadcastActivePreset(popupState.activePresetId, content);
}

// ────────────────────────────────────────────
// Main popup logic
// ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // Init Modal & Toast
    Modal.init();
    Toast.init();
    await dsI18n.init();

    // --- 載入初始設定 ---
    await StorageManager.initialize();

    // 檢查同步衝突
    const isConflictPending = await StorageManager.checkSyncConflictPending();
    if (isConflictPending) {
        const isResolved = await Modal.confirm({
            title: dsI18n.t('syncConflictTitle'),
            message: dsI18n.t('syncConflictMessage'),
            confirmText: dsI18n.t('mergeSyncConfirmButton'),
            cancelText: dsI18n.t('temporarilyCancelButton')
        });

        if (isResolved) {
            await StorageManager.resolveSyncConflict();
            Toast.show(dsI18n.t('syncMergedSuccessToast'));
            setTimeout(() => window.location.reload(), 1000);
            return;
        }
    }

    await refreshSyncStatus();
    // 統一同步進入點：先重試推送擱置項目，再拉取雲端收斂後的最新設定
    const settings = await StorageManager.syncNow();

    popupState.presets        = settings.promptPresets;
    popupState.activePresetId = settings.activePresetId;
    popupState.chatPresetMap  = settings.chatPresetMap;

    // 清除已失效的 chatPresetMap 條目
    const validIds = new Set(popupState.presets.map(p => p.id));
    popupState.chatPresetMap = await StorageManager.mutateChatPresetMap(map => {
        for (const [uuid, pid] of Object.entries(map)) {
            if (pid && !validIds.has(pid)) {
                delete map[uuid];
            }
        }
    });

    enableToggle.checked = settings.isEnabled;
    applyMasterSwitchUI(settings.isEnabled);

    if (includeThinkingToggle)   includeThinkingToggle.checked   = settings.includeThinking;
    if (includeReferencesToggle) includeReferencesToggle.checked = settings.includeReferences;
    if (sidebarAutoHideToggle)   sidebarAutoHideToggle.checked   = settings.sidebarAutoHide;
    if (hideThinkingToggle)      hideThinkingToggle.checked      = settings.hideThinking;
    if (showSystemTimeToggle)    showSystemTimeToggle.checked    = settings.showSystemTime;

    // 全域提示詞開關初始值
    if (globalPromptToggle) {
        globalPromptToggle.checked = settings.globalPromptEnabled ?? true;
    }

    if (chatWidthToggle && chatWidthSlider && chatWidthValue) {
        chatWidthToggle.checked = settings.chatWidthEnabled;
        chatWidthSlider.value   = settings.chatWidth;
        chatWidthValue.textContent = settings.chatWidth + '%';
        if (chatWidthSliderContainer) {
            chatWidthSliderContainer.classList.toggle('collapsed', !settings.chatWidthEnabled);
        }
    }
    if (inputWidthToggle && inputWidthSlider && inputWidthValue) {
        inputWidthToggle.checked = settings.inputWidthEnabled;
        inputWidthSlider.value   = settings.inputWidth;
        inputWidthValue.textContent = settings.inputWidth + '%';
        if (inputWidthSliderContainer) {
            inputWidthSliderContainer.classList.toggle('collapsed', !settings.inputWidthEnabled);
        }
    }

    // 判斷是否在 DeepSeek 分頁並調整活躍提示詞組
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url && tabs[0].url.includes('chat.deepseek.com')) {
            const uuid  = extractUuidFromUrl(tabs[0].url);
            const tabId = tabs[0].id;
            popupState.currentTabUuid = uuid || null;

            if (uuid && popupState.chatPresetMap[uuid]) {
                // 已綁定對話：自動選擇對應提示詞組
                popupState.activePresetId = popupState.chatPresetMap[uuid];
                await StorageManager.saveActivePresetId(popupState.activePresetId);
            } else {
                // 未綁定對話：從內容腳本查詢 pending preset
                const pending = await getPendingPresetIdFromContentScript(tabId);
                popupState.activePresetId = (pending && popupState.presets.some(p => p.id === pending)) ? pending : '';
                await StorageManager.saveActivePresetId(popupState.activePresetId);
            }
        } else {
            // 非 DeepSeek 頁面：預設空白選項
            popupState.activePresetId = '';
        }
    } catch (err) {
        // 查詢分頁失敗：安全回退為空白
        popupState.activePresetId = '';
    }

    popupState.customSelect = createPresetCustomSelect({
        triggerEl:    document.getElementById('presetSelect'),
        panelEl:      document.getElementById('presetSelectPanel'),
        valueEl:      document.getElementById('presetSelectValue'),
        searchInputEl: document.getElementById('presetSearchInput'),
        listEl:       document.getElementById('presetSelectList'),
        blankItemEl:  document.querySelector('.ds-select__item--empty'),
        emptyHintEl:  document.getElementById('presetSelectEmptyHint'),
        getPresets:        () => popupState.presets,
        getActivePresetId: () => popupState.activePresetId,
        onSelect: async (id) => {
            Modal.dismissActive();

            if (popupState.currentTabUuid && id !== '') {
                await StorageManager.bindChatToPreset(popupState.currentTabUuid, id);
                popupState.chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
            } else if (popupState.currentTabUuid && id === '') {
                await StorageManager.unbindChat(popupState.currentTabUuid);
                popupState.chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
            }

            popupState.activePresetId = id;
            await StorageManager.saveActivePresetId(popupState.activePresetId);

            updateEditPresetBtnState();
            showSaveStatus();
            await refreshSyncStatus();
            sendActivePresetToContentScript();
            popupState.customSelect.render();
        },
        onReorder: async (newPresets) => {
            popupState.presets = newPresets;
            await StorageManager.savePromptPresets(newPresets, { order: newPresets.map(p => p.id), orderUpdatedAt: Date.now() });
            await refreshSyncStatus();
            popupState.customSelect.render();
        },
        onRequestEdit:      (id) => requestEditPreset(popupState, id),
        onRequestDelete:    (id) => requestDeletePreset(popupState, id),
        onRequestDeleteAll: ()   => requestDeleteAllPresets(popupState),
    });

    popupState.customSelect.render();
    updateEditPresetBtnState();
    sendActivePresetToContentScript();

    // --- 啟動 Live Sync：即時反映其他裝置/分頁/視窗所做的設定變更 ---
    startLiveSync(popupState);

    // ────────────────────────────────────────────
    // 按鈕事件綁定
    // ────────────────────────────────────────────

    // --- 新增提示詞組 ---
    addPresetBtn.addEventListener('click', () => requestAddPreset(popupState));

    // --- 編輯提示詞組內容（開啟編輯器視窗） ---
    if (editPresetBtn) {
        editPresetBtn.addEventListener('click', () => {
            if (!popupState.activePresetId) return;
            openEditorWindow(popupState, 'preset', popupState.activePresetId);
        });
    }

    // --- 編輯全域提示詞（開啟編輯器視窗） ---
    if (editGlobalPromptBtn) {
        editGlobalPromptBtn.addEventListener('click', () => {
            openEditorWindow(popupState, 'global');
        });
    }

    // --- 設定開關與寬度滑桿（委派至 popup.settings-controls.js） ---
    bindSettingsControls();

    // --- 匯出 Markdown ---
    const exportMdBtn = document.getElementById('exportMdBtn');
    if (exportMdBtn) {
        exportMdBtn.addEventListener('click', async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('chat.deepseek.com')) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "EXPORT_MARKDOWN",
                    includeThinking:   includeThinkingToggle   ? includeThinkingToggle.checked   : true,
                    includeReferences: includeReferencesToggle ? includeReferencesToggle.checked : true
                }).catch(() => {
                    Toast.show(dsI18n.t('exportFailedRefreshToast'));
                });
            } else {
                await Modal.confirm({
                    title: dsI18n.t('notOnDeepseekTitle'),
                    message: dsI18n.t('notOnDeepseekMessage'),
                    confirmText: dsI18n.t('confirmButton'),
                    cancelText: null
                });
            }
        });
    }

    // --- JSON 備份與復原訊息備份（委派至 popup.backup-manager.js） ---
    bindExportJson(document.getElementById('exportJsonBtn'));
    bindImportJson(
        document.getElementById('importJsonBtn'),
        document.getElementById('importJsonInput')
    );
    bindExportRestored(document.getElementById('exportRestoredBtn'));
    bindImportRestored(
        document.getElementById('importRestoredBtn'),
        document.getElementById('importRestoredInput')
    );
    bindClearRestored(document.getElementById('clearRestoredBtn'));
});
