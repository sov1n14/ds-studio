/**
 * DS studio — Popup Feature Toggles 模組
 * 封裝九組功能開關（全域提示詞、主開關、思考過程、參考來源、側邊欄自動隱藏、
 * 隱藏思考過程、顯示系統時間、防止自動捲動、聯網搜尋單選）的 change 事件綁定。
 * 使用 factory 模式接收 ctx 上下文物件。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 建立功能開關管理器。
 * @param {Object} ctx - 上下文物件，提供共享狀態與回呼函式
 * @param {Object} ctx.StorageManager - StorageManager 實例
 * @param {Function} ctx.refreshSyncStatus - 刷新同步狀態 UI
 * @param {Function} ctx.showSaveStatus - 顯示儲存提示
 * @param {Function} ctx.applyMasterSwitchUI - 依主開關狀態更新子控制項 UI（僅主開關綁定使用）
 * @param {Function} ctx.getPresets - 取得目前 presets 陣列
 * @param {Function} ctx.setPresets - 設定 presets 陣列
 * @param {Function} ctx.getActivePresetId - 取得目前活躍 preset id
 * @param {Function} ctx.setActivePresetId - 設定目前活躍 preset id
 */
function createToggleManager(ctx) {
    const {
        StorageManager, refreshSyncStatus, showSaveStatus, applyMasterSwitchUI,
        getPresets, setPresets, getActivePresetId, setActivePresetId,
    } = ctx;

    /** 取得目前活躍的 preset 物件；無活躍 preset（含已刪除／已清空）時回傳 null。 */
    function resolveActivePreset() {
        const activePresetId = getActivePresetId?.();
        if (!activePresetId) return null;
        const presets = getPresets?.() ?? [];
        return presets.find(p => p.id === activePresetId) ?? null;
    }

    /**
     * 依目前活躍 preset（或無活躍 preset 時的裝置本機舊鍵）更新全域提示詞開關的顯示狀態。
     * 可於初次載入與切換 preset 時重複呼叫，讓開關立即反映當下狀態，無需重開 popup。
     * @param {HTMLElement} globalPromptToggle
     */
    async function renderGlobalPromptToggle(globalPromptToggle) {
        if (!globalPromptToggle) return;
        const activePreset = resolveActivePreset();
        const settings = await StorageManager.getSettings();
        globalPromptToggle.checked = StorageManager.resolveGlobalPromptEnabled(activePreset, settings.globalPromptEnabled);
    }

    /**
     * 綁定所有功能開關的 change 事件監聽器。
     * @param {Object} elements - 九組開關的 DOM 元素參照
     * @param {HTMLElement} elements.globalPromptToggle
     * @param {HTMLElement} elements.enableToggle
     * @param {HTMLElement} elements.includeThinkingToggle
     * @param {HTMLElement} elements.includeReferencesToggle
     * @param {HTMLElement} elements.sidebarAutoHideToggle
     * @param {HTMLElement} elements.hideThinkingToggle
     * @param {HTMLElement} elements.showSystemTimeToggle
     * @param {HTMLElement} elements.preventAutoScrollToggle
     * @param {HTMLElement[]} elements.websearchRadios
     */
    function bindToggles(elements) {
        const {
            globalPromptToggle,
            enableToggle,
            includeThinkingToggle,
            includeReferencesToggle,
            sidebarAutoHideToggle,
            hideThinkingToggle,
            showSystemTimeToggle,
            preventAutoScrollToggle,
            autoExpandMessagesToggle,
            websearchRadios,
        } = elements;

        // --- 全域提示詞開關（依目前活躍 preset 決定寫入目的地） ---
        if (globalPromptToggle) {
            globalPromptToggle.addEventListener('change', async () => {
                const activePreset = resolveActivePreset();
                if (activePreset) {
                    activePreset.globalPromptEnabled = globalPromptToggle.checked;
                    activePreset.updatedAt = Date.now();
                    await StorageManager.saveOnePromptPreset(activePreset);
                } else {
                    await StorageManager.saveGlobalPromptEnabled(globalPromptToggle.checked);
                }
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

        if (preventAutoScrollToggle) {
            preventAutoScrollToggle.addEventListener('change', async () => {
                await StorageManager.savePreventAutoScroll(preventAutoScrollToggle.checked);
                await refreshSyncStatus();
                showSaveStatus();
            });
        }

        // --- 自動展開訊息開關 ---
        if (autoExpandMessagesToggle) {
            autoExpandMessagesToggle.addEventListener('change', async () => {
                await StorageManager.saveAutoExpandMessages(autoExpandMessagesToggle.checked);
                await refreshSyncStatus();
                showSaveStatus();
            });
        }
        websearchRadios.forEach(r => {
            r.addEventListener('change', async () => {
                if (!r.checked) return;
                await StorageManager.saveWebsearchToggle(r.value);
                await refreshSyncStatus();
                showSaveStatus();
            });
        });
    }

    return { bindToggles, renderGlobalPromptToggle };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupToggles = { createToggleManager };
}
