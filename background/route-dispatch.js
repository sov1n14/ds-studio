/**
 * DS studio — 背景訊息路由分派器（background/route-dispatch.js）
 *
 * 職責：background 層所有 *-routes.js 共用的 chrome.runtime.onMessage 分派。install(routes, label) 於呼叫時（非載入時）註冊單一監聽器；訊息型別在路由表中時，等待該路由完成並回應 { ok: true, ...結果物件 } 或 { ok: false, error }，型別不在路由表時回傳 false 且不回應，讓其他 onMessage 監聽器仍能處理。
 * 回應格式僅此一處定義：路由回傳物件時併入回應，其他回傳值一律視為 { ok: true }；錯誤字串取錯誤的 message，缺少 message 時取 String(err)。
 *
 * 不需要其他腳本先載入；使用此分派器的 *-routes.js 須在其後載入。
 */
(function () {
    'use strict';

    /**
     * 錯誤轉為回應字串：優先取 message，沒有 message 時取 String(err)。
     * @param {unknown} err
     * @returns {string}
     */
    function describeError(err) {
        return err?.message || String(err);
    }

    /**
     * 執行單一路由並回應結果；失敗於此邊界攔截（onMessage 之外無人可攔）。
     * @param {(message: object) => Promise<object|void>} route
     * @param {object} message
     * @param {(response: object) => void} sendResponse
     * @param {string} label - 記錄錯誤時使用的路由檔名稱
     */
    async function runRoute(route, message, sendResponse, label) {
        try {
            const result = await route(message);
            sendResponse(result && typeof result === 'object' ? { ok: true, ...result } : { ok: true });
        } catch (err) {
            // Stryker disable next-line OptionalChaining: 等效突變——runRoute 只在 message 以 type 查到路由後呼叫，message 必為物件
            console.error(`[DSS] ${label} ${message?.type}:`, err);
            sendResponse({ ok: false, error: describeError(err) });
        }
    }

    /**
     * 註冊以 message.type 查表分派的單一 onMessage 監聽器。
     * 必須由 service worker 於頂層經各 *-routes.js 的 install() 呼叫，確保 worker 重啟後仍能存活。
     * @param {Object<string, (message: object) => Promise<object|void>>} routes - message.type → 處理函式
     * @param {string} label - 記錄錯誤時使用的路由檔名稱
     */
    function install(routes, label) {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            const route = routes[message?.type];
            if (!route) return false; // 交由其他監聽器處理
            runRoute(route, message, sendResponse, label);
            return true; // 非同步回應
        });
    }

    globalThis.DSSRouteDispatch = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    // Stryker disable next-line ConditionalExpression: 等效突變——module 檢查在 Node 測試環境恆為真，瀏覽器情境無法在 Node 觀察
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSRouteDispatch;
})();
