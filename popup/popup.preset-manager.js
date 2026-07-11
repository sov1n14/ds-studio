/**
 * DS studio — Popup Preset Manager 模組
 * 封裝提示詞組的新增、重新命名、刪除等操作。
 * 直接操作共享的 popupState 物件（由 popup.js 建立），
 * Modal / StorageManager 皆為頁面全域（classic script 共享同一作用域）。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

// --- 新增提示詞組 ---
async function requestAddPreset(popupState) {
    const name = await Modal.prompt({
        title: dsI18n.t('addPresetDialogTitle'),
        placeholder: dsI18n.t('addPresetPlaceholder')
    });

    if (!name) return;

    // 名稱重複檢查
    if (popupState.presets.some(p => p.name === name)) {
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

    popupState.presets.push(newPreset);
    popupState.activePresetId = newPreset.id;

    await Promise.all([
        StorageManager.savePromptPresets(popupState.presets),
        StorageManager.saveActivePresetId(popupState.activePresetId)
    ]);
    await refreshSyncStatus();

    // 若在對話頁面則自動綁定新提示詞組
    if (popupState.currentTabUuid) {
        await StorageManager.bindChatToPreset(popupState.currentTabUuid, popupState.activePresetId);
        popupState.chatPresetMap = (await StorageManager.getSettings()).chatPresetMap;
        await refreshSyncStatus();
    }

    popupState.customSelect.render();
    updateEditPresetBtnState();
    showSaveStatus();
    sendActivePresetToContentScript();
}

// --- 重新命名提示詞組 ---
async function requestEditPreset(popupState, id) {
    const presets = popupState.presets;
    const current = presets.find(p => p.id === id);
    if (!current) return;

    const newName = await Modal.prompt({
        title: dsI18n.t('renamePresetTitle'),
        value: current.name,
        placeholder: dsI18n.t('renamePresetPlaceholder')
    });

    if (!newName || newName === current.name) return;

    if (presets.some(p => p.name === newName && p.id !== current.id)) {
        await Modal.confirm({
            title: dsI18n.t('duplicateNameTitlePresetManager'),
            message: dsI18n.t('duplicateNameMessagePresetManager', { name: newName }),
            confirmText: dsI18n.t('confirmButtonPresetManager'),
            cancelText: null
        });
        return;
    }

    current.name      = newName;
    current.updatedAt = Date.now();
    await StorageManager.savePromptPresets(presets);
    await refreshSyncStatus();
    popupState.customSelect.render();
    showSaveStatus();
}

// --- 刪除提示詞組 ---
async function requestDeletePreset(popupState, id) {
    const presets = popupState.presets;
    const current = presets.find(p => p.id === id);
    if (!current) return;

    const isConfirmed = await Modal.confirm({
        title: dsI18n.t('deletePresetTitle'),
        message: dsI18n.t('deletePresetMessage', { name: current.name }),
        confirmText: dsI18n.t('deleteButton'),
        variant: 'danger'
    });

    if (!isConfirmed) return;

    const idx = presets.indexOf(current);
    presets.splice(idx, 1);

    if (popupState.activePresetId === current.id) {
        popupState.activePresetId = '';
        await StorageManager.saveActivePresetId('');
    }

    await StorageManager.savePromptPresets(presets);
    await refreshSyncStatus();

    const deletedId = current.id;
    const updatedMap = await StorageManager.mutateChatPresetMap(map => {
        for (const uuid of Object.keys(map)) {
            if (map[uuid] === deletedId) {
                delete map[uuid];
            }
        }
    });
    popupState.chatPresetMap = updatedMap;
    await refreshSyncStatus();

    popupState.customSelect.render();
    updateEditPresetBtnState();
    showSaveStatus();
    sendActivePresetToContentScript();
}

// --- 刪除全部提示詞組 ---
async function requestDeleteAllPresets(popupState) {
    const presets = popupState.presets;
    if (presets.length === 0) return;

    const isConfirmed = await Modal.confirm({
        title: dsI18n.t('deleteAllPresetsTitle'),
        message: dsI18n.t('deleteAllPresetsMessage'),
        confirmText: dsI18n.t('deleteButton'),
        variant: 'danger'
    });

    if (!isConfirmed) return;

    const deletedIds = new Set(presets.map(p => p.id));

    popupState.presets = [];
    popupState.activePresetId = '';
    await StorageManager.saveActivePresetId('');
    await StorageManager.savePromptPresets([]);
    await refreshSyncStatus();

    const updatedMap = await StorageManager.mutateChatPresetMap(map => {
        for (const uuid of Object.keys(map)) {
            if (deletedIds.has(map[uuid])) {
                delete map[uuid];
            }
        }
    });
    popupState.chatPresetMap = updatedMap;
    await refreshSyncStatus();

    popupState.customSelect.render();
    updateEditPresetBtnState();
    showSaveStatus();
    sendActivePresetToContentScript();
}

// --- 從內容腳本查詢 pending preset ID ---
async function getPendingPresetIdFromContentScript(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'GET_PENDING_PRESET' });
        return response?.pendingPresetId || null;
    } catch (err) {
        return null;
    }
}

// --- 從 URL 解析對話 UUID（純函式） ---
function extractUuidFromUrl(url) {
    try {
        const match = new URL(url).pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}
