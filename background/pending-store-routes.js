/**
 * DS studio — 待刪佇列訊息路由（background/pending-store-routes.js）
 *
 * 職責：background 層的訊息路由。install() 於呼叫時（非載入時）註冊單一
 * chrome.runtime.onMessage 監聽器，將 content 端的待刪佇列／開啟集合／token
 * 寫入請求委派給 TemporaryChatPendingStore，使 content 層不再直接觸碰
 * chrome.storage.*（coding-guidelines §1 層級界線）。
 * 未知型別回傳 false 且不回應，讓既有的其他 onMessage 監聽器仍能處理。
 *
 * 相依：content/temporary-chat-constants.js、content/temporary-chat-pending-store.js 需先載入。
 */
(function () {
    'use strict';

    /** 於呼叫時解析待刪佇列存取層（service worker 以全域提供），缺失即拋出並指名修法。 */
    function resolvePendingStore() {
        const store = globalThis.TemporaryChatPendingStore;
        if (!store) throw new Error('[DSS] pending-store-routes 需要 content/temporary-chat-pending-store.js 先行載入');
        return store;
    }

    /** 於呼叫時解析訊息型別常數，缺失即拋出並指名修法。 */
    function resolveMessageTypes() {
        const types = {
            TRACK_FOR_DELETION: globalThis.DSS_MSG_TRACK_FOR_DELETION,
            REMOVE_PENDING_DELETE: globalThis.DSS_MSG_REMOVE_PENDING_DELETE,
            REMOVE_OPEN_UUID: globalThis.DSS_MSG_REMOVE_OPEN_UUID,
            SET_LAST_AUTH_TOKEN: globalThis.DSS_MSG_SET_LAST_AUTH_TOKEN,
        };
        const missing = Object.keys(types).filter((name) => !types[name]);
        if (missing.length > 0) {
            throw new Error('[DSS] pending-store-routes 需要 content/temporary-chat-constants.js 先行載入');
        }
        return types;
    }

    /**
     * 建立 message.type → 存取層操作的對照表；每個操作皆為回傳 Promise 的函式。
     * @returns {Object<string, (message: object) => Promise<void>>}
     */
    function buildRouteTable() {
        const types = resolveMessageTypes();
        return {
            [types.TRACK_FOR_DELETION]: (message) => resolvePendingStore().trackForDeletion(message?.uuid),
            [types.REMOVE_PENDING_DELETE]: (message) => resolvePendingStore().removePendingDelete(message?.uuid),
            [types.REMOVE_OPEN_UUID]: (message) => resolvePendingStore().removeOpenUuid(message?.uuid),
            [types.SET_LAST_AUTH_TOKEN]: (message) => resolvePendingStore().setLastAuthToken(message?.token),
        };
    }

    /**
     * 執行單一路由並回應結果；失敗於此邊界攔截（onMessage 之外無人可攔）。
     * @param {(message: object) => Promise<void>} route
     * @param {object} message
     * @param {(response: object) => void} sendResponse
     */
    async function runRoute(route, message, sendResponse) {
        try {
            await route(message);
            sendResponse({ ok: true });
        } catch (err) {
            console.error(`[DSS] pending-store-routes ${message?.type}:`, err);
            sendResponse({ ok: false, error: String(err) });
        }
    }

    /**
     * 註冊待刪佇列訊息路由監聽器。
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

    globalThis.DSSPendingStoreRoutes = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSPendingStoreRoutes;
})();
