/**
 * DS studio — 編輯器視窗關閉訊息路由（background/editor-window-routes.js）
 *
 * 職責：background 層的訊息路由。install() 於呼叫時（非載入時）註冊單一 chrome.runtime.onMessage 監聽器；收到 DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE 時，讀取 chrome.storage.session 中的全域／提示詞組編輯器視窗 id，並行處理每個視窗：先以 FLUSH_MESSAGE_TYPE 請該視窗存檔並等待回報（最多約 1 秒），名稱重複時保留視窗，其餘情況關閉視窗並移除對應的 storage key（單一 id 關閉失敗不阻擋另一個 id 的處理）。
 * 未知型別回傳 false 且不回應，讓既有的其他 onMessage 監聽器仍能處理。
 *
 * 相依：utils/message-constants.js、utils/editor-flush-channel.js（存檔請求的共用請求端）與 background/route-dispatch.js（共用的訊息分派與回應格式）需先載入。
 */
(function () {
    'use strict';

    /** 於呼叫時解析訊息常數，缺失即拋出並指名修法。 */
    function resolveConstants() {
        const constants = globalThis.DSS_EDITOR_WINDOW;
        if (!constants) throw new Error('[DSS] editor-window-routes 需要 utils/message-constants.js 先行載入');
        return constants;
    }

    /**
     * 關閉單一目標（若有記錄的視窗 id）並移除其 storage key；關窗前先請編輯視窗存檔。
     * 名稱重複存檔失敗時保留視窗與 key，且不聚焦。
     * chrome.windows.remove 的拒絕（視窗已不存在）不影響 key 的移除。
     * @param {{ constants: object, requestEditorFlush: (slot: string) => Promise<string|undefined> }} deps
     * @param {string} slot - STORAGE_KEYS 的屬性名稱
     * @param {Object<string, number>} stored
     */
    async function closeTrackedWindow({ constants, requestEditorFlush }, slot, stored) {
        const storageKey = constants.STORAGE_KEYS[slot];
        const windowId = stored[storageKey];
        if (typeof windowId !== 'number') return;

        const flushStatus = await requestEditorFlush(slot);
        if (flushStatus === constants.FLUSH_STATUS.DUPLICATE) return;

        try {
            await chrome.windows.remove(windowId);
        } catch (err) {

        } finally {
            await chrome.storage.session.remove(storageKey);
        }
    }

    /** 並行關閉所有追蹤中的編輯器視窗（全域＋提示詞組）。 */
    async function closeAllEditorWindows(deps) {
        const storageKeys = deps.constants.STORAGE_KEYS;
        const stored = await chrome.storage.session.get(Object.values(storageKeys));
        await Promise.all(Object.keys(storageKeys).map((slot) => closeTrackedWindow(deps, slot, stored)));
    }

    /**
     * 建立 message.type → 處理函式的對照表。
     * @returns {Object<string, (message: object) => Promise<void>>}
     */
    function buildRouteTable() {
        const deps = { constants: resolveConstants(), requestEditorFlush: DSSEditorFlushChannel.requestEditorFlush };
        return {
            [deps.constants.CLOSE_MESSAGE_TYPE]: () => closeAllEditorWindows(deps),
        };
    }

    /**
     * 註冊編輯器視窗關閉訊息路由監聽器。
     * 必須由 service worker 於頂層呼叫，確保 worker 重啟後仍能存活。
     */
    function install() {
        const routes = buildRouteTable();
        const dispatch = globalThis.DSSRouteDispatch;
        if (!dispatch) throw new Error('[DSS] editor-window-routes 需要 background/route-dispatch.js 先行載入');
        dispatch.install(routes, 'editor-window-routes');
    }

    globalThis.DSSEditorWindowRoutes = { install };

    // === 測試匯出（瀏覽器情境為 no-op） ===
    if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.DSSEditorWindowRoutes;
})();
