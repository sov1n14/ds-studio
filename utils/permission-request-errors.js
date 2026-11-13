/**
 * DS studio — 權限請求錯誤分類（utils/permission-request-errors.js）
 *
 * 單一職責：判斷 chrome.permissions.request 的拒絕原因是否為「沒有原生視窗可承載權限提示」；Kiwi Browser（Android）等環境下 Chromium 以 `Could not find an active window.` 拒絕，utils/clipboard-permission.js 與 utils/notification-permission.js 共用此一判斷規則，訊息比對僅此一處定義。
 * 無載入期副作用：載入僅完成全域指派；以 IIFE 包裹，避免與其他腳本共用的全域識別字衝突。
 */
(() => {
    /** Chromium 找不到可承載權限提示的視窗時，chrome.permissions.request 拒絕所帶的錯誤訊息。 */
    const WINDOW_UNAVAILABLE_MESSAGE = 'Could not find an active window.';

    /**
     * 判斷錯誤是否為「沒有視窗可承載權限提示」；其他錯誤（含非 Error 值）一律回傳 false。
     * @param {unknown} err - chrome.permissions.request 拒絕或同步拋出的值
     * @returns {boolean} 錯誤訊息完全等於視窗不存在訊息時為 true
     */
    const isWindowUnavailableError = (err) => err?.message === WINDOW_UNAVAILABLE_MESSAGE;

    globalThis.DSSPermissionRequestErrors = { isWindowUnavailableError };
})();
