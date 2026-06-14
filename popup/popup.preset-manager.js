/**
 * DS studio — Popup Preset Manager 模組
 * 封裝提示詞組的重新命名、刪除等操作。
 * 使用 factory 模式接收 ctx 上下文物件，以保持與 popup.js 的共享狀態同步。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 建立 preset 管理器。
 * @param {Object} ctx - 上下文物件，提供共享狀態與回呼函式
 * @param {Function} ctx.getPresets - 取得目前 presets 陣列
 * @param {Function} ctx.setPresets - 更新 presets 陣列
 * @param {Function} ctx.getActivePresetId - 取得目前 activePresetId
 * @param {Function} ctx.setActivePresetId - 更新 activePresetId
 * @param {Function} ctx.getChatPresetMap - 取得目前 chatPresetMap
 * @param {Function} ctx.setChatPresetMap - 更新 chatPresetMap
 * @param {Function} ctx.getCustomSelect - 取得 customSelect 實例
 * @param {Function} ctx.refreshSyncStatus - 刷新同步狀態 UI
 * @param {Function} ctx.showSaveStatus - 顯示儲存提示
 * @param {Function} ctx.updateEditPresetBtnState - 更新鉛筆按鈕停用狀態
 * @param {Function} ctx.sendActivePresetToContentScript - 廣播活躍提示詞組
 * @param {Object} ctx.Modal - Modal 實例
 * @param {Object} ctx.StorageManager - StorageManager 實例
 */
function createPresetManager(ctx) {
    // --- 重新命名提示詞組 ---
    async function requestEditPreset(id) {
        const presets = ctx.getPresets();
        const current = presets.find(p => p.id === id);
        if (!current) return;

        const newName = await ctx.Modal.prompt({
            title: dsI18n.t('renamePresetTitle'),
            value: current.name,
            placeholder: dsI18n.t('renamePresetPlaceholder')
        });

        if (!newName || newName === current.name) return;

        if (presets.some(p => p.name === newName && p.id !== current.id)) {
            await ctx.Modal.confirm({
                title: dsI18n.t('duplicateNameTitlePresetManager'),
                message: dsI18n.t('duplicateNameMessagePresetManager', { name: newName }),
                confirmText: dsI18n.t('confirmButtonPresetManager'),
                cancelText: null
            });
            return;
        }

        current.name      = newName;
        current.updatedAt = Date.now();
        await ctx.StorageManager.savePromptPresets(presets);
        await ctx.refreshSyncStatus();
        ctx.getCustomSelect().render();
        ctx.showSaveStatus();
    }

    // --- 刪除提示詞組 ---
    async function requestDeletePreset(id) {
        const presets = ctx.getPresets();
        const current = presets.find(p => p.id === id);
        if (!current) return;

        const isConfirmed = await ctx.Modal.confirm({
            title: dsI18n.t('deletePresetTitle'),
            message: dsI18n.t('deletePresetMessage', { name: current.name }),
            confirmText: dsI18n.t('deleteButton'),
            variant: 'danger'
        });

        if (!isConfirmed) return;

        const idx = presets.indexOf(current);
        presets.splice(idx, 1);

        if (ctx.getActivePresetId() === current.id) {
            ctx.setActivePresetId('');
            await ctx.StorageManager.saveActivePresetId('');
        }

        await ctx.StorageManager.savePromptPresets(presets);
        await ctx.refreshSyncStatus();

        const deletedId = current.id;
        const updatedMap = await ctx.StorageManager.mutateChatPresetMap(map => {
            for (const uuid of Object.keys(map)) {
                if (map[uuid] === deletedId) {
                    delete map[uuid];
                }
            }
        });
        ctx.setChatPresetMap(updatedMap);
        await ctx.refreshSyncStatus();

        ctx.getCustomSelect().render();
        ctx.updateEditPresetBtnState();
        ctx.showSaveStatus();
        ctx.sendActivePresetToContentScript();
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

    return {
        requestEditPreset,
        requestDeletePreset,
        getPendingPresetIdFromContentScript,
        extractUuidFromUrl,
    };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupPresetManager = { createPresetManager };
}
