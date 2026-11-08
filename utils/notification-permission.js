/**
 * DS studio — 通知權限共用工具（utils/notification-permission.js）
 *
 * 單一職責：把 chrome.permissions 對選用權限 notifications 的查詢與請求包成不會向呼叫端拋錯的介面（決策 U6-10）。
 * popup 層依規範不得直接呼叫 chrome.*，一律經由本模組；service worker 的 background/permission-intent-routes.js 亦經由本模組查詢，權限集合僅此一處定義。
 * 無載入期副作用：載入僅完成全域指派；以 IIFE 包裹，避免與其他 popup 腳本共用的全域識別字衝突。
 */
(() => {
    /** 選用通知權限的權限集合。 */
    const NOTIFICATIONS_PERMISSION_SET = { permissions: ['notifications'] };

    /**
     * 以通知權限集合呼叫 chrome.permissions 的指定方法；呼叫當下才讀取 API，API 不存在、拒絕或同步拋錯時一律回傳 false。
     * @param {'contains'|'request'} methodName - chrome.permissions 的方法名稱
     * @param {string} callerName - 記錄錯誤時使用的對外函式名稱
     * @returns {Promise<boolean>} 邊界回傳的布林值；失敗時為 false
     */
    async function callPermissionsApi(methodName, callerName) {
        const permissionsApi = globalThis.chrome?.permissions;
        if (typeof permissionsApi?.[methodName] !== 'function') return false;
        try {
            return (await permissionsApi[methodName](NOTIFICATIONS_PERMISSION_SET)) === true;
        } catch (err) {
            console.error(`[DSS] notification-permission.${callerName}:`, err);
            return false;
        }
    }

    /**
     * 查詢是否已取得通知權限；僅查詢，絕不觸發權限提示。
     * @returns {Promise<boolean>} 已取得時為 true
     */
    const hasNotificationPermission = () => callPermissionsApi('contains', 'hasNotificationPermission');

    /**
     * 向使用者請求通知權限；須在使用者手勢內呼叫。
     * @returns {Promise<boolean>} 使用者同意時為 true
     */
    const requestNotificationPermission = () => callPermissionsApi('request', 'requestNotificationPermission');

    globalThis.DSSNotificationPermission = { hasNotificationPermission, requestNotificationPermission };
})();
