/**
 * DS studio — 剪貼簿權限共用工具（utils/clipboard-permission.js）
 *
 * 單一職責：把 chrome.permissions 對選用權限 clipboardWrite 與 offscreen 的查詢與請求包成不會向呼叫端拋錯的介面（任一自動複製勾選框開啟時兩者一併請求）。
 * popup 層依規範不得直接呼叫 chrome.*，一律經由本模組；service worker 的 background/permission-intent-routes.js 亦經由本模組查詢，權限集合僅此一處定義。
 * 無載入期副作用：載入僅完成全域指派；以 IIFE 包裹，避免與其他 popup 腳本共用的全域識別字衝突。
 */
(() => {
    /** 自動複製所需的選用權限集合；clipboardWrite 與 offscreen 一併查詢與請求。 */
    const CLIPBOARD_PERMISSION_SET = { permissions: ['clipboardWrite', 'offscreen'] };

    /**
     * 以剪貼簿權限集合呼叫 chrome.permissions 的指定方法；呼叫當下才讀取 API，API 不存在、拒絕或同步拋錯時一律回傳 false。
     * @param {'contains'|'request'} methodName - chrome.permissions 的方法名稱
     * @param {string} callerName - 記錄錯誤時使用的對外函式名稱
     * @returns {Promise<boolean>} 邊界回傳的布林值；失敗時為 false
     */
    async function callPermissionsApi(methodName, callerName) {
        const permissionsApi = globalThis.chrome?.permissions;
        if (typeof permissionsApi?.[methodName] !== 'function') return false;
        try {
            return (await permissionsApi[methodName](CLIPBOARD_PERMISSION_SET)) === true;
        } catch (err) {
            console.error(`[DSS] clipboard-permission.${callerName}:`, err);
            return false;
        }
    }

    /**
     * 查詢是否已取得剪貼簿相關權限；僅查詢，絕不觸發權限提示。
     * @returns {Promise<boolean>} 兩項權限皆已取得時為 true
     */
    const hasClipboardPermission = () => callPermissionsApi('contains', 'hasClipboardPermission');

    /**
     * 向使用者請求剪貼簿相關權限；須在使用者手勢內呼叫。
     * @returns {Promise<boolean>} 使用者同意時為 true
     */
    const requestClipboardPermission = () => callPermissionsApi('request', 'requestClipboardPermission');

    globalThis.DSSClipboardPermission = { hasClipboardPermission, requestClipboardPermission };
})();
