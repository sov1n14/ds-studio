/**
 * DS studio — 桌面通知訊息路由（background/notification-routes.js）
 *
 * 職責：background 層的訊息路由。install() 於呼叫時（非載入時）註冊單一 chrome.runtime.onMessage 監聽器；收到 DSS_SHOW_NOTIFICATION 時，先確認 chrome.notifications 可用並驗證 title／body 為字串，再以 promise 形式呼叫 chrome.notifications.create 顯示 basic 通知。未知型別回傳 false 且不回應，讓既有的其他 onMessage 監聽器仍能處理。
 *
 * 相依：utils/message-constants.js 需先載入。
 */
(function () {
    'use strict';

    // 通知圖示（擴充功能封裝內的相對路徑）
    const NOTIFICATION_ICON_PATH = 'assets/icons/icon128.png';

    /** 於呼叫時解析訊息型別常數，缺失即拋出並指名修法。 */
    function resolveShowNotificationType() {
        const type = globalThis.DSS_SHOW_NOTIFICATION;
        if (!type) throw new Error('[DSS] notification-routes 需要 utils/message-constants.js 先行載入');
        return type;
    }

    /**
     * 驗證通知內容後建立桌面通知；任何失敗皆以拋出交由 runRoute 轉為 { ok: false, error }。
     * @param {{ title?: unknown, body?: unknown }} message
     */
    async function showNotification(message) {
        // 未授予 notifications 權限時 chrome.notifications 不存在
        if (typeof chrome.notifications?.create !== 'function') throw new Error('chrome.notifications 無法使用（未授予 notifications 權限）');
        const { title, body } = message;
        if (typeof title !== 'string' || typeof body !== 'string') throw new TypeError('通知的 title 與 body 必須為字串');

        await chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON_PATH),
            title,
            message: body,
        });
    }

    /**
     * 建立 message.type → 處理函式的對照表。
     * @returns {Object<string, (message: object) => Promise<void>>}
     */
    function buildRouteTable() {
        return {
            [resolveShowNotificationType()]: showNotification,
        };
    }

    /**
     * 執行單一路由並回應結果；失敗於此邊界攔截（onMessage 之外無人可攔）。
     * @param {(message: object) => Promise<object|void>} route
     * @param {object} message
     * @param {(response: object) => void} sendResponse
     */
    async function runRoute(route, message, sendResponse) {
        try {
            const result = await route(message);
            sendResponse(result && typeof result === 'object' ? { ok: true, ...result } : { ok: true });
        } catch (err) {
            console.error(`[DSS] notification-routes ${message?.type}:`, err);
            sendResponse({ ok: false, error: String(err) });
        }
    }

    /**
     * 註冊桌面通知訊息路由監聽器。
     * 必須由 service worker 於頂層呼叫，確保 worker 重啟後仍能存活。
     */
    function install() {
        const routes = buildRouteTable();

        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            const route = routes[message?.type];
            if (!route) return false; // 交由其他監聽器處理
            runRoute(route, message, sendResponse);
            return true; // 非同步回應
        });
    }

    globalThis.DSSNotificationRoutes = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSNotificationRoutes;
})();
