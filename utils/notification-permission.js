/**
 * DS studio — 通知權限共用工具（utils/notification-permission.js）
 *
 * 單一職責：宣告回覆完成通知所需的選用權限 notifications，並以 utils/permission-module.js 的工廠包成不會向呼叫端拋錯的介面。
 * popup 層依規範不得直接呼叫 chrome.*，一律經由本模組；service worker 的 background/permission-intent-routes.js 亦經由本模組查詢，權限集合僅此一處定義。
 * 相依：utils/permission-module.js 需先載入（包裝邏輯），載入時缺失即拋出並指名修法。
 * 無載入期副作用：載入僅完成全域指派；以 IIFE 包裹，避免與其他 popup 腳本共用的全域識別字衝突。
 */
(() => {
    if (!globalThis.DSSPermissionModule) throw new Error('[DSS] notification-permission 需要 utils/permission-module.js 先行載入');

    /** 選用通知權限的權限集合。 */
    const NOTIFICATIONS_PERMISSION_SET = { permissions: ['notifications'] };

    const permission = globalThis.DSSPermissionModule.create({
        permissionSet: NOTIFICATIONS_PERMISSION_SET,
        label: 'notification-permission',
        hasName: 'hasNotificationPermission',
        requestName: 'requestNotificationPermission',
    });

    globalThis.DSSNotificationPermission = {
        /** 查詢是否已取得通知權限；僅查詢，絕不觸發權限提示。 */
        hasNotificationPermission: permission.has,
        /** 向使用者請求通知權限；須在使用者手勢內呼叫；沒有視窗可承載權限提示時（Kiwi Browser 等）視同同意。 */
        requestNotificationPermission: permission.request,
    };
})();
