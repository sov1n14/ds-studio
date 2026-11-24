/**
 * DS studio — 選用權限包裝工廠（utils/permission-module.js）
 *
 * 單一職責：把 chrome.permissions 對一組選用權限的查詢與請求包成不會向呼叫端拋錯的 { has, request }；utils/clipboard-permission.js 與 utils/notification-permission.js 各以自己的權限集合與記錄標籤呼叫本工廠，包裝邏輯僅此一處定義。
 * 相依：utils/permission-request-errors.js 於呼叫當下才讀取（沒有視窗可承載權限提示的判斷規則），未載入時該失敗視為否。
 * 無載入期副作用：載入僅完成全域指派；以 IIFE 包裹，避免與其他腳本共用的全域識別字衝突。
 */
(() => {
    /**
     * 判斷請求失敗是否因沒有視窗可承載權限提示（Kiwi Browser 等）；判斷規則由 utils/permission-request-errors.js 定義，呼叫當下才讀取，未載入時視為否。
     * @param {unknown} err - chrome.permissions.request 拒絕或同步拋出的值
     * @returns {boolean} 屬於視窗不存在的失敗時為 true
     */
    const isPromptWindowUnavailable = (err) => globalThis.DSSPermissionRequestErrors?.isWindowUnavailableError(err) === true;

    /**
     * 建立指定權限集合的包裝模組。
     * @param {Object} options
     * @param {{ permissions: string[] }} options.permissionSet - 查詢與請求的權限集合
     * @param {string} options.label - 記錄錯誤時的檔案標籤，例如 'clipboard-permission'
     * @param {string} options.hasName - 記錄 has() 失敗時使用的對外函式名稱
     * @param {string} options.requestName - 記錄 request() 失敗時使用的對外函式名稱
     * @returns {{ has: () => Promise<boolean>, request: () => Promise<boolean> }}
     */
    function create({ permissionSet, label, hasName, requestName }) {
        /**
         * 以權限集合呼叫 chrome.permissions 的指定方法；呼叫當下才讀取 API，API 不存在時回傳 false，拒絕或同步拋錯時記錄錯誤並回傳 resolveFailure 的判斷結果。
         * @param {'contains'|'request'} methodName - chrome.permissions 的方法名稱
         * @param {string} callerName - 記錄錯誤時使用的對外函式名稱
         * @param {(err: unknown) => boolean} [resolveFailure] - 依錯誤決定失敗時的回傳值；預設一律 false
         * @returns {Promise<boolean>} 邊界回傳的布林值；失敗時為 resolveFailure 的結果
         */
        async function callPermissionsApi(methodName, callerName, resolveFailure = () => false) {
            const permissionsApi = globalThis.chrome?.permissions;
            if (typeof permissionsApi?.[methodName] !== 'function') return false;
            try {
                return (await permissionsApi[methodName](permissionSet)) === true;
            } catch (err) {
                console.error(`[DSS] ${label}.${callerName}:`, err);
                return resolveFailure(err);
            }
        }

        return {
            /**
             * 查詢是否已取得整組權限；僅查詢，絕不觸發權限提示。
             * @returns {Promise<boolean>} 整組權限皆已取得時為 true
             */
            has: () => callPermissionsApi('contains', hasName),
            /**
             * 向使用者請求整組權限；須在使用者手勢內呼叫。
             * 沒有視窗可承載權限提示時（Kiwi Browser 等）無法詢問使用者，視同同意，讓設定得以開啟。
             * @returns {Promise<boolean>} 使用者同意，或沒有視窗可承載權限提示時為 true
             */
            request: () => callPermissionsApi('request', requestName, isPromptWindowUnavailable),
        };
    }

    globalThis.DSSPermissionModule = { create };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    // Stryker disable next-line ConditionalExpression: 等效突變——module 檢查在 Node 測試環境恆為真，瀏覽器情境無法在 Node 觀察
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSPermissionModule;
})();
