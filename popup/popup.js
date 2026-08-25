/**
 * DS studio — Popup Controller（入口）
 * 依賴：popup.modal.js（Modal, Toast）、popup.preset-manager.js（createPresetManager）、
 *       popup.backup-manager.js（createBackupManager）、popup.live-sync.js（createLiveSyncListener）、
 *       popup.editor-window.js（createEditorWindowManager）、popup.width-sliders.js（createWidthSliderManager）、
 *       popup.markdown-export.js（createMarkdownExportManager）、popup.toggles.js（createToggleManager）、
 *       popup.preset-domain.js（DSSPresetDomain）、popup.locale.js（bindLocaleSwitcher）、
 *       popup.settings-view.js（applySettingsToDom）
 * 需在本檔案之前以 <script> 載入上述模組。
 */

// ────────────────────────────────────────────
// Main popup logic
// ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // 從全域取回 Modal 與 Toast（由 popup.modal.js 注入）
    const { Modal, Toast } = window.__DS_PopupModal;

    // --- DOM refs ---
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
    const preventAutoScrollToggle   = document.getElementById('preventAutoScrollToggle');
    const websearchRadios           = Array.from(document.querySelectorAll('input[name="websearchToggle"]'));

    let saveTimeout;
    let customSelect;
    let toggleManager;

    // Init Modal & Toast
    Modal.init();
    Toast.init();
    await dsI18n.init();
    window.__DS_PopupLocale.bindLocaleSwitcher();

    // --- 狀態 ---
    let presets        = [];
    let activePresetId = null;
    let pinnedPresetId = '';
    let chatPresetMap  = {};
    let currentTabUuid = undefined;

    // --- 主開關 UI 輔助 ---
    function applyMasterSwitchUI(isEnabled) {
        const subControls = [
            sidebarAutoHideToggle,
            hideThinkingToggle,
            showSystemTimeToggle,
            chatWidthToggle, chatWidthSlider,
            inputWidthToggle, inputWidthSlider,
            preventAutoScrollToggle,
            ...websearchRadios,
        ];
        subControls.forEach(el => {
            if (el) el.disabled = !isEnabled;
        });
    }

    // ────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────

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
            editPresetBtn.disabled = (activePresetId === '');
        }
    }

    /** 廣播目前活躍提示詞組至內容腳本 */
    function sendActivePresetToContentScript() {
        const preset  = presets.find(p => p.id === activePresetId);
        const content = preset?.content ?? '';
        window.DSSTabControl?.broadcastActivePreset(activePresetId, content);
    }

    // --- 建立 pin manager（釘選預設提示詞組） ---
    const { createPinManager } = window.__DS_PopupPinManager;
    const pinManager = createPinManager({
        StorageManager,
        getPinnedPresetId: () => pinnedPresetId,
        setPinnedPresetId: (v) => { pinnedPresetId = v; },
        onPinChanged:      () => customSelect?.render(),
    });

    // --- 建立 preset manager（透過 factory 接收上下文） ---
    const presetManager = window.__DS_PopupPresetManager.createPresetManager({
        getPresets:          () => presets,
        setPresets:          (v) => { presets = v; },
        getActivePresetId:   () => activePresetId,
        setActivePresetId:   (v) => { activePresetId = v; },
        getPinnedPresetId:   () => pinnedPresetId,
        setPinnedPresetId:   (v) => { pinnedPresetId = v; },
        getChatPresetMap:    () => chatPresetMap,
        setChatPresetMap:    (v) => { chatPresetMap = v; },
        getCurrentTabUuid:   () => currentTabUuid,
        setCurrentTabUuid:   (v) => { currentTabUuid = v; },
        getCustomSelect:     () => customSelect,
        refreshSyncStatus,
        showSaveStatus,
        updateEditPresetBtnState,
        sendActivePresetToContentScript,
        Modal,
        StorageManager,
        pinManager,
        renderGlobalPromptToggle: () => toggleManager.renderGlobalPromptToggle(globalPromptToggle),
    });

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

    presets        = settings.promptPresets;
    activePresetId = settings.activePresetId;
    pinnedPresetId = settings.pinnedPresetId ?? '';
    chatPresetMap  = settings.chatPresetMap;

    // 十二組設定鍵對 DOM 的對應集中於 popup.settings-view.js
    window.__DS_PopupSettingsView.applySettingsToDom({
        enableToggle, includeThinkingToggle, includeReferencesToggle,
        sidebarAutoHideToggle, hideThinkingToggle, showSystemTimeToggle,
        preventAutoScrollToggle, websearchRadios,
        chatWidthToggle, chatWidthSlider, chatWidthValue, chatWidthSliderContainer,
        inputWidthToggle, inputWidthSlider, inputWidthValue, inputWidthSliderContainer,
    }, settings);
    applyMasterSwitchUI(settings.isEnabled);

    // 判斷是否在 DeepSeek 分頁並調整活躍提示詞組（委派至 popup.preset-manager.js）
    await presetManager.syncActivePresetWithCurrentTab();

    customSelect = window.__DSSCustomSelect.createPresetCustomSelect({
        triggerEl:    document.getElementById('presetSelect'),
        panelEl:      document.getElementById('presetSelectPanel'),
        valueEl:      document.getElementById('presetSelectValue'),
        searchInputEl: document.getElementById('presetSearchInput'),
        listEl:       document.getElementById('presetSelectList'),
        blankItemEl:  document.querySelector('.ds-select__item--empty'),
        emptyHintEl:  document.getElementById('presetSelectEmptyHint'),
        getPresets:        () => presets,
        getActivePresetId: () => activePresetId,
        getPinnedPresetId: () => pinnedPresetId,
        onRequestTogglePin: (id) => pinManager.togglePin(id),
        onSelect: async (id) => {
            Modal.dismissActive();

            await presetManager.bindCurrentChat(id);

            activePresetId = id;
            await StorageManager.saveActivePresetId(activePresetId);

            updateEditPresetBtnState();
            showSaveStatus();
            await refreshSyncStatus();
            sendActivePresetToContentScript();
            await toggleManager.renderGlobalPromptToggle(globalPromptToggle);
            customSelect.render();
        },
        onReorder: async (newPresets) => {
            presets = newPresets;
            await StorageManager.savePromptPresets(newPresets, { order: newPresets.map(p => p.id), orderUpdatedAt: Date.now() });
            await refreshSyncStatus();
            customSelect.render();
        },
        onRequestDelete:    (id) => presetManager.requestDeletePreset(id),
        onRequestDeleteAll: ()   => presetManager.requestDeleteAllPresets(),
    });

    customSelect.render();
    updateEditPresetBtnState();
    sendActivePresetToContentScript();

    // --- 啟動 Live Sync：即時反映其他裝置/分頁/視窗所做的設定變更 ---
    const liveSync = window.__DS_PopupLiveSync.createLiveSyncListener({
        StorageManager,
        dom: {
            enableToggle, includeThinkingToggle, includeReferencesToggle,
            showSystemTimeToggle, globalPromptToggle,
            sidebarAutoHideToggle, hideThinkingToggle,
            chatWidthToggle, chatWidthSlider, chatWidthValue, chatWidthSliderContainer,
            inputWidthToggle, inputWidthSlider, inputWidthValue, inputWidthSliderContainer,
            preventAutoScrollToggle,
            websearchRadios,
        },
        applyMasterSwitchUI,
        updateEditPresetBtnState,
        getPresets:        () => presets,
        setPresets:        (v) => { presets = v; },
        getActivePresetId: () => activePresetId,
        setActivePresetId: (v) => { activePresetId = v; },
        getChatPresetMap:  () => chatPresetMap,
        setChatPresetMap:  (v) => { chatPresetMap = v; },
        getCustomSelect:   () => customSelect,
    });
    liveSync.start();

    // ────────────────────────────────────────────
    // 按鈕 & 開關事件綁定
    // ────────────────────────────────────────────

    // --- 新增提示詞組（委派至 popup.preset-manager.js） ---
    addPresetBtn.addEventListener('click', () => presetManager.requestAddPreset());

    // --- 編輯器視窗（委派至 popup.editor-window.js） ---
    const editorWindowManager = window.__DS_PopupEditorWindow.createEditorWindowManager({
        getActivePresetId: () => activePresetId,
    });
    editorWindowManager.bindEditPresetButton(editPresetBtn);
    editorWindowManager.bindEditGlobalPromptButton(editGlobalPromptBtn);

    // --- 功能開關（委派至 popup.toggles.js） ---
    toggleManager = window.__DS_PopupToggles.createToggleManager({
        StorageManager,
        refreshSyncStatus,
        showSaveStatus,
        applyMasterSwitchUI,
        getPresets:        () => presets,
        setPresets:        (v) => { presets = v; },
        getActivePresetId: () => activePresetId,
        setActivePresetId: (v) => { activePresetId = v; },
    });
    toggleManager.bindToggles({
        globalPromptToggle,
        enableToggle,
        includeThinkingToggle,
        includeReferencesToggle,
        sidebarAutoHideToggle,
        hideThinkingToggle,
        showSystemTimeToggle,
        preventAutoScrollToggle,
        websearchRadios,
    });
    // 全域提示詞開關初始值：依目前活躍 preset（或裝置本機舊鍵）決定
    await toggleManager.renderGlobalPromptToggle(globalPromptToggle);

    // --- 寬度滑桿（委派至 popup.width-sliders.js） ---
    const widthSliderManager = window.__DS_PopupWidthSliders.createWidthSliderManager({
        refreshSyncStatus,
        showSaveStatus,
        StorageManager,
    });
    widthSliderManager.bindChatWidthControls(chatWidthToggle, chatWidthSlider, chatWidthValue, chatWidthSliderContainer);
    widthSliderManager.bindInputWidthControls(inputWidthToggle, inputWidthSlider, inputWidthValue, inputWidthSliderContainer);

    // --- 匯出 Markdown（委派至 popup.markdown-export.js） ---
    const markdownExportManager = window.__DS_PopupMarkdownExport.createMarkdownExportManager({ Modal, Toast });
    markdownExportManager.bindExportButton(
        document.getElementById('exportMdBtn'),
        includeThinkingToggle,
        includeReferencesToggle
    );

    // --- JSON 備份與復原訊息備份（委派至 popup.backup-manager.js） ---
    const backupManager = window.__DS_PopupBackupManager.createBackupManager({
        refreshSyncStatus,
        Modal,
        Toast,
        StorageManager,
    });

    backupManager.bindExportJson(document.getElementById('exportJsonBtn'));
    backupManager.bindImportJson(
        document.getElementById('importJsonBtn'),
        document.getElementById('importJsonInput')
    );
    backupManager.bindExportRestored(document.getElementById('exportRestoredBtn'));
    backupManager.bindImportRestored(
        document.getElementById('importRestoredBtn'),
        document.getElementById('importRestoredInput')
    );
    backupManager.bindClearRestored(document.getElementById('clearRestoredBtn'));
});
