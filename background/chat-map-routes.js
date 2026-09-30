/**
 * DS studio — chat→preset 綁定表訊息路由（background/chat-map-routes.js）
 *
 * 職責：background 層的訊息路由。install() 於呼叫時（非載入時）將注入的 StorageManager 設為 chatPresetMap 唯一寫入者，
 * 並註冊單一 chrome.runtime.onMessage 監聽器，把 DSS_CHAT_MAP_MSG 操作交給該實例的引擎依序套用。
 * 未知型別回傳 false 且不回應，讓其他 onMessage 監聽器仍能處理。
 *
 * 相依：utils/message-constants.js、utils/storage-manager.chatmap.ops.js 與 StorageManager 各分包需先載入。
 */
(function () {
    'use strict';

    /** 於呼叫時解析訊息型別常數，缺失即拋出並指名修法。 */
    function resolveMessageTypes() {
        const types = globalThis.DSS_CHAT_MAP_MSG;
        if (!types) throw new Error('[DSS] chat-map-routes 需要 utils/message-constants.js 先行載入');
        return types;
    }

    /** 於呼叫時解析宣告式操作模組，缺失即拋出並指名修法。 */
    function resolveOps() {
        const ops = globalThis.DSSChatMapOps;
        if (!ops) throw new Error('[DSS] chat-map-routes 需要 utils/storage-manager.chatmap.ops.js 先行載入');
        return ops;
    }

    /**
     * 經引擎套用操作並回應；失敗於此邊界攔截（onMessage 之外無人可攔），佇列不受影響。
     * @param {Object} storageManager
     * @param {Object} message
     * @param {(response: object) => void} sendResponse
     */
    async function runOp(storageManager, message, sendResponse) {
        try {
            const map = await storageManager.applyChatMapOp(message);
            sendResponse({ ok: true, map });
        } catch (err) {
            console.error(`[DSS] chat-map-routes ${message.type}:`, err);
            sendResponse({ ok: false, error: String(err?.message || err || 'unknown error') });
        }
    }

    /**
     * 註冊 chat-map 訊息路由監聽器；必須由 service worker 於頂層呼叫，確保 worker 重啟後仍能存活。
     * @param {{ storageManager: Object }} deps - service worker 的 StorageManager 實例
     */
    function install({ storageManager } = {}) {
        if (!storageManager) throw new Error('[DSS] chat-map-routes.install 需要 { storageManager }');
        storageManager.enableChatMapWriterMode();

        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            const types = resolveMessageTypes();
            const type = message?.type;
            if (!Object.values(types).includes(type)) return false; // 交由其他監聽器處理

            const verdict = resolveOps().validate(message);
            if (!verdict.ok) {
                sendResponse({ ok: false, error: verdict.error });
                return false;
            }
            runOp(storageManager, message, sendResponse);
            return true; // 非同步回應
        });
    }

    globalThis.DSSChatMapRoutes = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSChatMapRoutes;
})();
