/**
 * DS studio — Popup Editor Window 模組
 * 封裝全域/提示詞組編輯器視窗的開啟（singleton per target）與追蹤邏輯，
 * 並綁定「編輯提示詞組」「編輯全域提示詞」兩顆按鈕的點擊事件。
 * 視窗單例狀態由 utils/window-control.js 保存於 chrome.storage.session（決策 D5），
 * popup 關閉後再次點擊仍會聚焦既有視窗，切換提示詞組時則導向該組的 URL。
 * 使用 factory 模式接收 ctx 上下文物件，以保持與 popup.js 的共享狀態同步。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

// --- 編輯器視窗 ID 的 session 儲存鍵（全域與提示詞組各保留一個 slot） ---
const EDITOR_WINDOW_STORAGE_KEYS = {
    global: 'dss-editor-window-id-global',
    preset: 'dss-editor-window-id-preset',
};

// --- 編輯器視窗建立選項 ---
const EDITOR_WINDOW_CREATE_OPTIONS = { type: 'popup', width: 1280, height: 720 };

/**
 * 建立編輯器視窗管理器。
 * @param {Object} ctx - 上下文物件，提供共享狀態與回呼函式
 * @param {Function} ctx.getActivePresetId - 取得目前 activePresetId
 */
function createEditorWindowManager(ctx) {
    /**
     * 開啟（或聚焦）編輯器視窗（singleton per target）
     * @param {'global'|'preset'} target - 編輯目標類型
     * @param {string} [presetId] - 僅在 target==='preset' 時使用
     */
    async function openEditorWindow(target, presetId) {
        const baseUrl = chrome.runtime.getURL('popup/editor/editor.html');
        const isGlobal = target === 'global';
        // URL 的 query string 即編輯器讀取編輯目標的機制，切換提示詞組時由此帶入新的 id
        const url = isGlobal
            ? `${baseUrl}?target=global`
            : `${baseUrl}?target=preset&id=${encodeURIComponent(presetId)}`;

        try {
            await DSSWindowControl.openSingletonWindow({
                url,
                createOptions: EDITOR_WINDOW_CREATE_OPTIONS,
                storageKey: EDITOR_WINDOW_STORAGE_KEYS[isGlobal ? 'global' : 'preset'],
            });
        } catch (err) {
            console.error('[DSS] popup.editor-window.openEditorWindow:', err);
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
