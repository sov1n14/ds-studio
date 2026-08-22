/**
 * DS studio — 編輯器視窗關閉訊息路由（background/editor-window-routes.js）
 *
 * 職責：background 層的訊息路由。install() 於呼叫時（非載入時）註冊單一
 * chrome.runtime.onMessage 監聽器；收到 DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE
 * 時，讀取 chrome.storage.session 中的全域／提示詞組編輯器視窗 id，逐一關閉
 * 視窗並移除對應的 storage key（單一 id 關閉失敗不阻擋另一個 id 的處理）。
 * 未知型別回傳 false 且不回應，讓既有的其他 onMessage 監聽器仍能處理。
 *
 * 相依：utils/editor-window-constants.js 需先載入。
 */
(function () {
    'use strict';

    /** 於呼叫時解析訊息常數，缺失即拋出並指名修法。 */
    function resolveConstants() {
        const constants = globalThis.DSS_EDITOR_WINDOW;
        if (!constants) throw new Error('[DSS] editor-window-routes 需要 utils/editor-window-constants.js 先行載入');
        return constants;
    }

    /**
     * 關閉單一目標（若有記錄的視窗 id）並移除其 storage key。
     * chrome.windows.remove 的拒絕（視窗已不存在）不影響 key 的移除。
     * @param {string} storageKey
     * @param {Object<string, number>} stored
     */
    async function closeTrackedWindow(storageKey, stored) {
        const windowId = stored[storageKey];
        if (typeof windowId !== 'number') return;

        try {
            await chrome.windows.remove(windowId);
        } catch (err) {
            console.error('[DSS] editor-window-routes closeTrackedWindow:', err);
        } finally {
            await chrome.storage.session.remove(storageKey);
        }
    }

    /** 關閉所有追蹤中的編輯器視窗（全域＋提示詞組），並回應 ok:true。 */
    async function closeAllEditorWindows(storageKeys, sendResponse) {
        const keys = Object.values(storageKeys);
        const stored = await chrome.storage.session.get(keys);

        await Promise.all(keys.map((key) => closeTrackedWindow(key, stored)));

        sendResponse({ ok: true });
    }

    /**
     * 註冊編輯器視窗關閉訊息路由監聽器。
     * 必須由 service worker 於頂層呼叫，確保 worker 重啟後仍能存活。
     */
    function install() {
        const { CLOSE_MESSAGE_TYPE, STORAGE_KEYS } = resolveConstants();

        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message?.type !== CLOSE_MESSAGE_TYPE) return false; // 交由其他監聽器處理

            closeAllEditorWindows(STORAGE_KEYS, sendResponse);
            return true; // 非同步回應
        });
    }

    globalThis.DSSEditorWindowRoutes = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSEditorWindowRoutes;
})();
