/**
 * DS studio — 待完成權限意圖路由（background/permission-intent-routes.js）
 *
 * 職責：Chrome 顯示選用權限提示時會關閉 popup，popup 在提示後的儲存因此不會執行。popup 於提示前記下待完成意圖；install() 於呼叫時（非載入時）註冊 chrome.permissions.onAdded 監聽器，權限授予後逐筆檢查待完成意圖，所需權限已全數取得者經由 StorageManager 開啟對應設定並清除該意圖；權限仍不足者保留待下次授予。
 *
 * 相依：utils/storage-manager*.js、utils/clipboard-permission.js、utils/notification-permission.js 需先載入。
 */
(function () {
    'use strict';

    /** 於呼叫時解析相依模組，缺失即拋出並指名修法。StorageManager 在 service worker 為 classic script 的頂層 const，非 globalThis 屬性，故以識別字解析。 */
    function resolveDependencies() {
        const storageManager = typeof StorageManager !== 'undefined' ? StorageManager : undefined;
        const clipboardPermission = globalThis.DSSClipboardPermission;
        const notificationPermission = globalThis.DSSNotificationPermission;
        if (!storageManager?.PERMISSION_INTENTS) throw new Error('[DSS] permission-intent-routes 需要 utils/storage-manager*.js 先行載入');
        if (!clipboardPermission || !notificationPermission) throw new Error('[DSS] permission-intent-routes 需要 utils/clipboard-permission.js 與 utils/notification-permission.js 先行載入');
        return { storageManager, clipboardPermission, notificationPermission };
    }

    /**
     * 建立意圖名稱 → { 權限是否已全數取得, 開啟設定 } 的對照表。
     * @returns {Object<string, { hasPermission: () => Promise<boolean>, enable: () => Promise<void> }>}
     */
    function buildIntentTable({ storageManager, clipboardPermission, notificationPermission }) {
        const { AUTO_COPY_REPLY, AUTO_COPY_CODE, REPLY_NOTIFICATION } = storageManager.PERMISSION_INTENTS;
        const hasClipboard = () => clipboardPermission.hasClipboardPermission();
        return {
            [AUTO_COPY_REPLY]: { hasPermission: hasClipboard, enable: () => storageManager.saveAutoCopyReply(true) },
            [AUTO_COPY_CODE]: { hasPermission: hasClipboard, enable: () => storageManager.saveAutoCopyCode(true) },
            [REPLY_NOTIFICATION]: { hasPermission: () => notificationPermission.hasNotificationPermission(), enable: () => storageManager.saveReplyNotification(true) },
        };
    }

    /** 完成所有權限已全數取得的待完成意圖：先開啟設定再清除意圖，中途失敗時意圖保留，下次授予可重試。 */
    async function completeGrantedIntents(storageManager, intentTable) {
        for (const intentName of await storageManager.getPendingPermissionIntents()) {
            const intent = intentTable[intentName];
            if (!intent || !(await intent.hasPermission())) continue;
            await intent.enable();
            await storageManager.clearPermissionIntent(intentName);
        }
    }

    /**
     * 註冊權限授予監聽器。
     * 必須由 service worker 於頂層呼叫，確保 worker 重啟後仍能存活。
     */
    function install() {
        const dependencies = resolveDependencies();
        const intentTable = buildIntentTable(dependencies);

        chrome.permissions.onAdded.addListener(() => {
            completeGrantedIntents(dependencies.storageManager, intentTable)
                .catch((err) => console.error('[DSS] permission-intent-routes onAdded:', err)); // 事件邊界之外無人可攔
        });
    }

    globalThis.DSSPermissionIntentRoutes = { install };
})();
