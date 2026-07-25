/**
 * DS studio — Popup Editor Window 模組
 * 封裝全域/提示詞組編輯器視窗的開啟（singleton per target）與追蹤邏輯，
 * 並綁定「編輯提示詞組」「編輯全域提示詞」兩顆按鈕的點擊事件。
 * 使用 factory 模式接收 ctx 上下文物件，以保持與 popup.js 的共享狀態同步。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 建立編輯器視窗管理器。
 * @param {Object} ctx - 上下文物件，提供共享狀態與回呼函式
 * @param {Function} ctx.getActivePresetId - 取得目前 activePresetId
 */
function createEditorWindowManager(ctx) {
    // --- 編輯器視窗 ID 追蹤（各保留一個 slot） ---
    let globalEditorWindowId = null;
    let presetEditorWindowId = null;

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

    // --- 綁定「編輯提示詞組」按鈕（開啟編輯器視窗） ---
    function bindEditPresetButton(editPresetBtn) {
        if (!editPresetBtn) return;
        editPresetBtn.addEventListener('click', () => {
            const activePresetId = ctx.getActivePresetId();
            if (!activePresetId) return;
            openEditorWindow('preset', activePresetId);
        });
    }

    // --- 綁定「編輯全域提示詞」按鈕（開啟編輯器視窗） ---
    function bindEditGlobalPromptButton(editGlobalPromptBtn) {
        if (!editGlobalPromptBtn) return;
        editGlobalPromptBtn.addEventListener('click', () => {
            openEditorWindow('global');
        });
    }

    return { openEditorWindow, bindEditPresetButton, bindEditGlobalPromptButton };
}

// 將 factory 掛載至全域，供 popup.js 存取（classic script 環境）
if (typeof window !== 'undefined') {
    window.__DS_PopupEditorWindow = { createEditorWindowManager };
}
