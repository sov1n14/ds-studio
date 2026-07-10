/**
 * DS studio — Popup Controller（入口）
 * 依賴：popup.modal.js（Modal, Toast）、popup.preset-manager.js（createPresetManager）
 * 需在本檔案之前以 <script> 載入上述兩個模組。
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
    const forceSyncBtn              = document.getElementById('forceSyncBtn');
    const syncStatusEl              = document.getElementById('syncStatus');

    let saveTimeout;
    let customSelect;

    // Init Modal & Toast
    Modal.init();
    Toast.init();
    await dsI18n.init();

    // --- 狀態 ---
    let presets        = [];
    let activePresetId = null;
    let chatPresetMap  = {};
    let currentTabUuid = undefined;

    // --- 編輯器視窗 ID 追蹤（各保留一個 slot） ---
    let globalEditorWindowId = null;
    let presetEditorWindowId = null;

    // --- 主開關 UI 輔助 ---
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

    // ────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────

    async function refreshSyncStatus() {
        try {
            const isSynced = await StorageManager.isSyncedWithCloud();
            const el = document.getElementById('syncStatus');
            el.classList.toggle('synced',   isSynced);
            el.classList.toggle('unsynced', !isSynced);
            el.textContent = isSynced ? dsI18n.t('syncStatusSynced') : dsI18n.t('syncStatusUnsynced');
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
        window.DSVMessaging?.broadcastActivePreset(activePresetId, content);
    }

    /**
     * 開啟（或聚焦）編輯器視窗（singleton per target）
     * @param {'global'|'preset'} target - 編輯目標類型
     * @param {string} [presetId] - 僅在 target==='preset' 時使用
     */
    async function openEditorWindow(target, presetId) {
        const baseUrl = chrome.runtime.getURL('popup/editor/editor.html');
        const url = target === 'global'
            ? `${baseUrl}?target=global`
            : `${baseUrl}?target=preset&id=${encodeURIComponent(presetId)}`;

        // 根據 target 選取對應的視窗 ID slot
        const isGlobal      = target === 'global';
        const trackedId     = isGlobal ? globalEditorWindowId : presetEditorWindowId;

        if (trackedId !== null) {
            try {
                // 嘗試聚焦現有視窗
                await chrome.windows.update(trackedId, { focused: true });
                return;
            } catch {
                // 視窗已關閉，清除追蹤 ID 並重新建立
                if (isGlobal) {
                    globalEditorWindowId = null;
                } else {
                    presetEditorWindowId = null;
                }
            }
        }

        try {
            const win = await chrome.windows.create({ url, type: 'popup', width: 1280, height: 720 });
            if (isGlobal) {
                globalEditorWindowId = win.id;
            } else {
                presetEditorWindowId = win.id;
            }
        } catch (err) {
        }
    }

    // --- 建立 preset manager（透過 factory 接收上下文） ---
    const presetManager = window.__DS_PopupPresetManager.createPresetManager({
        getPresets:          () => presets,
        setPresets:          (v) => { presets = v; },
        getActivePresetId:   () => activePresetId,
        setActivePresetId:   (v) => { activePresetId = v; },
        getChatPresetMap:    () => chatPresetMap,
        setChatPresetMap:    (v) => { chatPresetMap = v; },
        getCustomSelect:     () => customSelect,
        refreshSyncStatus,
        showSaveStatus,
        updateEditPresetBtnState,
        sendActivePresetToContentScript,
        Modal,
        StorageManager,
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
    chatPresetMap  = settings.chatPresetMap;

    // 清除已失效的 chatPresetMap 條目
    const validIds = new Set(presets.map(p => p.id));
    chatPresetMap = await StorageManager.mutateChatPresetMap(map => {
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
            const uuid  = presetManager.extractUuidFromUrl(tabs[0].url);
            const tabId = tabs[0].id;
            currentTabUuid = uuid || null;

            if (uuid && chatPresetMap[uuid]) {
                // 已綁定對話：自動選擇對應提示詞組
                activePresetId = chatPresetMap[uuid];
                await StorageManager.saveActivePresetId(activePresetId);
            } else {
                // 未綁定對話：從內容腳本查詢 pending preset
                const pending = await presetManager.getPendingPresetIdFromContentScript(tabId);
                activePresetId = (pending && presets.some(p => p.id === pending)) ? pending : '';
                await StorageManager.saveActivePresetId(activePresetId);
            }
        } else {
            // 非 DeepSeek 頁面：預設空白選項
            activePresetId = '';
        }
    } catch (err) {
        // 查詢分頁失敗：安全回退為空白
        activePresetId = '';
    }

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
        onSelect: async (id) => {
            Modal.dismissActive();

            if (currentTabUuid && id !== '') {
                await StorageManager.bindChatToPreset(currentTabUuid, id);
                chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
            } else if (currentTabUuid && id === '') {
                await StorageManager.unbindChat(currentTabUuid);
                chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
            }

            activePresetId = id;
            await StorageManager.saveActivePresetId(activePresetId);

            updateEditPresetBtnState();
            showSaveStatus();
            await refreshSyncStatus();
            sendActivePresetToContentScript();
            customSelect.render();
        },
        onReorder: async (newPresets) => {
            presets = newPresets;
            await StorageManager.savePromptPresets(newPresets, { order: newPresets.map(p => p.id), orderUpdatedAt: Date.now() });
            await refreshSyncStatus();
            customSelect.render();
        },
        onRequestEdit:   (id) => presetManager.requestEditPreset(id),
        onRequestDelete: (id) => presetManager.requestDeletePreset(id),
    });

    customSelect.render();
    updateEditPresetBtnState();
    sendActivePresetToContentScript();

    // ────────────────────────────────────────────
    // 按鈕 & 開關事件綁定
    // ────────────────────────────────────────────

    // --- 新增提示詞組 ---
    addPresetBtn.addEventListener('click', async () => {
        const name = await Modal.prompt({
            title: dsI18n.t('addPresetDialogTitle'),
            placeholder: dsI18n.t('addPresetPlaceholder')
        });

        if (!name) return;

        // 名稱重複檢查
        if (presets.some(p => p.name === name)) {
            await Modal.confirm({
                title: dsI18n.t('duplicateNameTitle'),
                message: dsI18n.t('duplicateNameMessage', { name }),
                confirmText: dsI18n.t('confirmButton'),
                cancelText: null
            });
            return;
        }

        const newPreset = {
            id:        'preset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            name:      name,
            content:   '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        presets.push(newPreset);
        activePresetId = newPreset.id;

        await Promise.all([
            StorageManager.savePromptPresets(presets),
            StorageManager.saveActivePresetId(activePresetId)
        ]);
        await refreshSyncStatus();

        // 若在對話頁面則自動綁定新提示詞組
        if (currentTabUuid) {
            await StorageManager.bindChatToPreset(currentTabUuid, activePresetId);
            chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
            await refreshSyncStatus();
        }

        customSelect.render();
        updateEditPresetBtnState();
        showSaveStatus();
        sendActivePresetToContentScript();
    });

    // --- 編輯提示詞組內容（開啟編輯器視窗） ---
    if (editPresetBtn) {
        editPresetBtn.addEventListener('click', () => {
            if (!activePresetId) return;
            openEditorWindow('preset', activePresetId);
        });
    }

    // --- 編輯全域提示詞（開啟編輯器視窗） ---
    if (editGlobalPromptBtn) {
        editGlobalPromptBtn.addEventListener('click', () => {
            openEditorWindow('global');
        });
    }

    // --- 全域提示詞開關 ---
    if (globalPromptToggle) {
        globalPromptToggle.addEventListener('change', async () => {
            await StorageManager.saveGlobalPromptEnabled(globalPromptToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // --- 主開關 ---
    enableToggle.addEventListener('change', async () => {
        await StorageManager.saveEnabledState(enableToggle.checked);
        await refreshSyncStatus();
        applyMasterSwitchUI(enableToggle.checked);
        showSaveStatus();
    });

    if (includeThinkingToggle) {
        includeThinkingToggle.addEventListener('change', async () => {
            await StorageManager.saveIncludeThinking(includeThinkingToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (includeReferencesToggle) {
        includeReferencesToggle.addEventListener('change', async () => {
            await StorageManager.saveIncludeReferences(includeReferencesToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (sidebarAutoHideToggle) {
        sidebarAutoHideToggle.addEventListener('change', async () => {
            await StorageManager.saveSidebarAutoHide(sidebarAutoHideToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (hideThinkingToggle) {
        hideThinkingToggle.addEventListener('change', async () => {
            await StorageManager.saveHideThinking(hideThinkingToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    if (showSystemTimeToggle) {
        showSystemTimeToggle.addEventListener('change', async () => {
            await StorageManager.saveShowSystemTime(showSystemTimeToggle.checked);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // 對話區域寬度開關與 slider
    if (chatWidthToggle && chatWidthSliderContainer) {
        chatWidthToggle.addEventListener('change', async () => {
            const isEnabled = chatWidthToggle.checked;
            chatWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
            await StorageManager.saveChatWidthEnabled(isEnabled);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }
    if (chatWidthSlider && chatWidthValue) {
        chatWidthSlider.addEventListener('input', () => {
            chatWidthValue.textContent = chatWidthSlider.value + '%';
        });
        chatWidthSlider.addEventListener('change', async () => {
            await StorageManager.saveChatWidth(parseInt(chatWidthSlider.value, 10));
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

    // 編輯輸入框寬度開關與 slider
    if (inputWidthToggle && inputWidthSliderContainer) {
        inputWidthToggle.addEventListener('change', async () => {
            const isEnabled = inputWidthToggle.checked;
            inputWidthSliderContainer.classList.toggle('collapsed', !isEnabled);
            await StorageManager.saveInputWidthEnabled(isEnabled);
            await refreshSyncStatus();
            showSaveStatus();
        });
    }
    if (inputWidthSlider && inputWidthValue) {
        inputWidthSlider.addEventListener('input', () => {
            inputWidthValue.textContent = inputWidthSlider.value + '%';
        });
        inputWidthSlider.addEventListener('change', async () => {
            await StorageManager.saveInputWidth(parseInt(inputWidthSlider.value, 10));
            await refreshSyncStatus();
            showSaveStatus();
        });
    }

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

    if (forceSyncBtn) {
        forceSyncBtn.addEventListener('click', async () => {
            const original = forceSyncBtn.textContent;
            forceSyncBtn.disabled = true;
            forceSyncBtn.textContent = dsI18n.t('syncingButtonText');
            try {
                const result = await StorageManager.retrySync();
                if (result.success) {
                    Toast.show(dsI18n.t('syncCompleteToast'));
                } else {
                    Toast.show(dsI18n.t('syncRemainingToast', { count: result.remainingUnsyncedCount }));
                }
            } catch (e) {
                Toast.show(dsI18n.t('syncFailedToast'));
            } finally {
                forceSyncBtn.disabled = false;
                forceSyncBtn.textContent = original;
                await refreshSyncStatus();
            }
        });
    }
});
