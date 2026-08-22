/**
 * DS studio — Popup Preset Manager 模組
 * 封裝提示詞組的新增、刪除、對話綁定與分頁活躍狀態解析等操作。
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
 * @param {Function} ctx.getCurrentTabUuid - 取得目前分頁的對話 UUID
 * @param {Function} ctx.setCurrentTabUuid - 更新目前分頁的對話 UUID
 * @param {Function} ctx.getChatPresetMap - 取得目前 chatPresetMap
 * @param {Function} ctx.setChatPresetMap - 更新 chatPresetMap
 * @param {Function} ctx.getCustomSelect - 取得 customSelect 實例
 * @param {Function} ctx.refreshSyncStatus - 刷新同步狀態 UI
 * @param {Function} ctx.showSaveStatus - 顯示儲存提示
 * @param {Function} ctx.updateEditPresetBtnState - 更新鉛筆按鈕停用狀態
 * @param {Function} ctx.sendActivePresetToContentScript - 廣播活躍提示詞組
 * @param {Function} [ctx.renderGlobalPromptToggle] - 重新渲染全域提示詞開關（刪除後立即反映回退狀態）
 * @param {Object} ctx.Modal - Modal 實例
 * @param {Object} ctx.StorageManager - StorageManager 實例
 * @param {Object} ctx.pinManager - Pin 管理器實例，需提供 async clearPinIfDeleted(deletedIds)
 */
function createPresetManager(ctx) {

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
        await ctx.pinManager?.clearPinIfDeleted([deletedId]);

        ctx.getCustomSelect().render();
        ctx.updateEditPresetBtnState();
        ctx.showSaveStatus();
        ctx.sendActivePresetToContentScript();
        await ctx.renderGlobalPromptToggle?.();
    }

    // --- 刪除全部提示詞組 ---
    async function requestDeleteAllPresets() {
        const presets = ctx.getPresets();
        if (presets.length === 0) return;

        const isConfirmed = await ctx.Modal.confirm({
            title: dsI18n.t('deleteAllPresetsTitle'),
            message: dsI18n.t('deleteAllPresetsMessage'),
            confirmText: dsI18n.t('deleteButton'),
            variant: 'danger'
        });

        if (!isConfirmed) return;

        const deletedIds = new Set(presets.map(p => p.id));

        ctx.setPresets([]);
        ctx.setActivePresetId('');
        await ctx.StorageManager.saveActivePresetId('');
        await ctx.StorageManager.savePromptPresets([]);
        await ctx.refreshSyncStatus();

        const updatedMap = await ctx.StorageManager.mutateChatPresetMap(map => {
            for (const uuid of Object.keys(map)) {
                if (deletedIds.has(map[uuid])) {
                    delete map[uuid];
                }
            }
        });
        ctx.setChatPresetMap(updatedMap);
        await ctx.refreshSyncStatus();
        await ctx.pinManager?.clearPinIfDeleted([...deletedIds]);

        ctx.getCustomSelect().render();
        ctx.updateEditPresetBtnState();
        ctx.showSaveStatus();
        ctx.sendActivePresetToContentScript();
        await ctx.renderGlobalPromptToggle?.();
    }

    // --- 從內容腳本查詢 pending preset ID ---
    async function getPendingPresetIdFromContentScript(tabId) {
        const response = await DSSTabControl.sendToTab(tabId, { action: 'GET_PENDING_PRESET' });
        return response?.pendingPresetId || null;
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

    /**
     * 將目前分頁的對話綁定至指定提示詞組（id 為空字串則解除綁定），
     * 並把最新的 chatPresetMap 讀回共享狀態。非對話分頁時不做事。
     */
    async function bindCurrentChat(id) {
        const currentTabUuid = ctx.getCurrentTabUuid();
        if (!currentTabUuid) return;

        if (id === '') {
            await ctx.StorageManager.unbindChat(currentTabUuid);
        } else {
            await ctx.StorageManager.bindChatToPreset(currentTabUuid, id);
        }
        ctx.setChatPresetMap((await ctx.StorageManager.getSettings()).chatPresetMap);
    }

    /**
     * 依目前分頁決定活躍提示詞組：已綁定的對話沿用綁定值，未綁定則採用內容腳本回報的
     * pending preset，非 DeepSeek 分頁或查詢失敗則回退為空白。
     * 同時把解析到的對話 UUID 寫回共享狀態。
     */
    async function syncActivePresetWithCurrentTab() {
        try {
            const activeTab = await DSSTabControl.queryActiveDeepseekTab();
            if (!activeTab || !activeTab.url) {
                // 非 DeepSeek 頁面：預設空白選項
                ctx.setActivePresetId('');
                return;
            }

            const uuid = extractUuidFromUrl(activeTab.url);
            ctx.setCurrentTabUuid(uuid || null);

            const boundPresetId = uuid ? ctx.getChatPresetMap()[uuid] : undefined;
            if (boundPresetId) {
                // 已綁定對話：自動選擇對應提示詞組
                ctx.setActivePresetId(boundPresetId);
            } else {
                // 未綁定對話：從內容腳本查詢 pending preset
                const pending = await getPendingPresetIdFromContentScript(activeTab.id);
                const isPendingUsable = Boolean(pending) && ctx.getPresets().some(p => p.id === pending);
                ctx.setActivePresetId(isPendingUsable ? pending : '');
            }
            await ctx.StorageManager.saveActivePresetId(ctx.getActivePresetId());
        } catch (err) {
            // 查詢分頁失敗：安全回退為空白
            ctx.setActivePresetId('');
        }
    }

    // --- 新增提示詞組 ---
    async function requestAddPreset() {
        const name = await ctx.Modal.prompt({
            title: dsI18n.t('addPresetDialogTitle'),
            placeholder: dsI18n.t('addPresetPlaceholder')
        });

        // 名稱驗證（規則由 popup.preset-domain.js 集中定義）
        const validation = DSSPresetDomain.validatePresetName(name, ctx.getPresets());
        if (!validation.ok) {
            // 空白名稱與使用者取消一律靜默結束；僅重複名稱需要提示
            if (validation.reason === 'duplicate') {
                await ctx.Modal.confirm({
                    title: dsI18n.t('duplicateNameTitle'),
                    message: dsI18n.t('duplicateNameMessage', { name }),
                    confirmText: dsI18n.t('confirmButton'),
                    cancelText: null
                });
            }
            return;
        }

        const newPreset = DSSPresetDomain.createPreset(name);
        const presets = ctx.getPresets();

        presets.push(newPreset);
        ctx.setActivePresetId(newPreset.id);

        await Promise.all([
            ctx.StorageManager.savePromptPresets(presets),
            ctx.StorageManager.saveActivePresetId(ctx.getActivePresetId())
        ]);
        await ctx.refreshSyncStatus();

        // 若在對話頁面則自動綁定新提示詞組
        if (ctx.getCurrentTabUuid()) {
            await bindCurrentChat(ctx.getActivePresetId());
            await ctx.refreshSyncStatus();
        }

        ctx.getCustomSelect().render();
        ctx.updateEditPresetBtnState();
        ctx.showSaveStatus();
        ctx.sendActivePresetToContentScript();
    }

    return {
        requestAddPreset,
        requestDeletePreset,
        requestDeleteAllPresets,
        getPendingPresetIdFromContentScript,
        extractUuidFromUrl,
        bindCurrentChat,
        syncActivePresetWithCurrentTab,
    };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupPresetManager = { createPresetManager };
}
