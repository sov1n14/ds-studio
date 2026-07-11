/**
 * DS studio — Popup Editor Windows 模組
 * 負責開啟（或聚焦）提示詞／全域提示詞的獨立編輯器視窗（singleton per target）。
 * 此檔案以 classic script 載入，無 ES import/export。
 */

/**
 * 開啟（或聚焦）編輯器視窗（singleton per target）
 * @param {Object} popupState - 共享的 popup 狀態物件（由 popup.js 建立）
 * @param {'global'|'preset'} target - 編輯目標類型
 * @param {string} [presetId] - 僅在 target==='preset' 時使用
 */
async function openEditorWindow(popupState, target, presetId) {
    const baseUrl = chrome.runtime.getURL('popup/editor/editor.html');
    const url = target === 'global'
        ? `${baseUrl}?target=global`
        : `${baseUrl}?target=preset&id=${encodeURIComponent(presetId)}`;

    // 根據 target 選取對應的視窗 ID slot
    const isGlobal  = target === 'global';
    const trackedId = isGlobal ? popupState.globalEditorWindowId : popupState.presetEditorWindowId;

    if (trackedId !== null) {
        try {
            // 嘗試聚焦現有視窗
            await chrome.windows.update(trackedId, { focused: true });
            return;
        } catch {
            // 視窗已關閉，清除追蹤 ID 並重新建立
            if (isGlobal) {
                popupState.globalEditorWindowId = null;
            } else {
                popupState.presetEditorWindowId = null;
            }
        }
    }

    try {
        const win = await chrome.windows.create({ url, type: 'popup', width: 1280, height: 720 });
        if (isGlobal) {
            popupState.globalEditorWindowId = win.id;
        } else {
            popupState.presetEditorWindowId = win.id;
        }
    } catch (err) {
    }
}
