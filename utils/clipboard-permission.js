/**
 * DS studio — 剪貼簿權限共用工具（utils/clipboard-permission.js）
 *
 * 單一職責：宣告自動複製所需的選用權限 clipboardWrite 與 offscreen（任一自動複製勾選框開啟時兩者一併查詢與請求），並以 utils/permission-module.js 的工廠包成不會向呼叫端拋錯的介面。
 * popup 層依規範不得直接呼叫 chrome.*，一律經由本模組；service worker 的 background/permission-intent-routes.js 亦經由本模組查詢，權限集合僅此一處定義。
 * 相依：utils/permission-module.js 需先載入（包裝邏輯），載入時缺失即拋出並指名修法。
 * 無載入期副作用：載入僅完成全域指派；以 IIFE 包裹，避免與其他 popup 腳本共用的全域識別字衝突。
 */
(() => {
    if (!globalThis.DSSPermissionModule) throw new Error('[DSS] clipboard-permission 需要 utils/permission-module.js 先行載入');

    /** 自動複製所需的選用權限集合；clipboardWrite 與 offscreen 一併查詢與請求。 */
    const CLIPBOARD_PERMISSION_SET = { permissions: ['clipboardWrite', 'offscreen'] };

    const permission = globalThis.DSSPermissionModule.create({
        permissionSet: CLIPBOARD_PERMISSION_SET,
        label: 'clipboard-permission',
        hasName: 'hasClipboardPermission',
        requestName: 'requestClipboardPermission',
    });

    globalThis.DSSClipboardPermission = {
        /** 查詢是否已取得剪貼簿相關權限；僅查詢，絕不觸發權限提示；兩項權限皆已取得時為 true。 */
        hasClipboardPermission: permission.has,
        /** 向使用者請求剪貼簿相關權限；須在使用者手勢內呼叫；沒有視窗可承載權限提示時（Kiwi Browser 等）視同同意。 */
        requestClipboardPermission: permission.request,
    };
})();
