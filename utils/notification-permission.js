/**
 * DS studio — 通知權限共用工具（utils/notification-permission.js）
 *
 * 單一職責：把 chrome.permissions 對選用權限 notifications 的查詢與請求包成不會向呼叫端拋錯的介面。
 * popup 層依規範不得直接呼叫 chrome.*，一律經由本模組；service worker 的 background/permission-intent-routes.js 亦經由本模組查詢，權限集合僅此一處定義。
 * 無載入期副作用：載入僅完成全域指派；以 IIFE 包裹，避免與其他 popup 腳本共用的全域識別字衝突。
 */
(() => {
    /** 選用通知權限的權限集合。 */
    const NOTIFICATIONS_PERMISSION_SET = { permissions: ['notifications'] };

    /**
     * 判斷請求失敗是否因沒有視窗可承載權限提示（Kiwi Browser 等）；判斷規則由 utils/permission-request-errors.js 定義，呼叫當下才讀取，未載入時視為否。
     * @param {unknown} err - chrome.permissions.request 拒絕或同步拋出的值
     * @returns {boolean} 屬於視窗不存在的失敗時為 true
     */
    const isPromptWindowUnavailable = (err) => globalThis.DSSPermissionRequestErrors?.isWindowUnavailableError(err) === true;

    /**
     * 以通知權限集合呼叫 chrome.permissions 的指定方法；呼叫當下才讀取 API，API 不存在時回傳 false，拒絕或同步拋錯時記錄錯誤並回傳 resolveFailure 的判斷結果。
     * @param {'contains'|'request'} methodName - chrome.permissions 的方法名稱
     * @param {string} callerName - 記錄錯誤時使用的對外函式名稱
     * @param {(err: unknown) => boolean} [resolveFailure] - 依錯誤決定失敗時的回傳值；預設一律 false
     * @returns {Promise<boolean>} 邊界回傳的布林值；失敗時為 resolveFailure 的結果
     */
    async function callPermissionsApi(methodName, callerName, resolveFailure = () => false) {
        const permissionsApi = globalThis.chrome?.permissions;
        if (typeof permissionsApi?.[methodName] !== 'function') return false;
        try {
            return (await permissionsApi[methodName](NOTIFICATIONS_PERMISSION_SET)) === true;
        } catch (err) {
            console.error(`[DSS] notification-permission.${callerName}:`, err);
            return resolveFailure(err);
        }
    }

    /**
     * 查詢是否已取得通知權限；僅查詢，絕不觸發權限提示。
     * @returns {Promise<boolean>} 已取得時為 true
     */
    const hasNotificationPermission = () => callPermissionsApi('contains', 'hasNotificationPermission');

    /**
     * 向使用者請求通知權限；須在使用者手勢內呼叫。
     * 沒有視窗可承載權限提示時（Kiwi Browser 等）無法詢問使用者，視同同意，讓設定得以開啟。
     * @returns {Promise<boolean>} 使用者同意，或沒有視窗可承載權限提示時為 true
     */
    const requestNotificationPermission = () => callPermissionsApi('request', 'requestNotificationPermission', isPromptWindowUnavailable);

    globalThis.DSSNotificationPermission = { hasNotificationPermission, requestNotificationPermission };
})();
