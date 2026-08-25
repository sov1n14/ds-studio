/**
 * DS studio — Temporary Chat Delete / 事件處理器部件
 * 單一職責：處理 postMessage、Navigation API、鍵盤刷新、beforeunload 與切換事件。
 * 常數由 temporary-chat-constants.js 在前載入提供（classic script，無 ESM import）。
 * 無載入期副作用：入口檔 temporary-chat-delete.js 負責組合本部件並注入生命週期能力。
 */
(function (root) {
    'use strict';

    /**
     * 綁定共享狀態與依賴，回傳事件處理器集合。
     * 回傳的函式參照必須被入口檔保存並重複使用，
     * 否則 removeEventListener 會因參照不同而靜默失效。
     * @param {object} state - tracking 部件建立的共享狀態物件
     * @param {object} deps
     * @param {object} deps.tracking - tracking 部件的已綁定 API
     * @param {(options?: object) => void} deps.deleteTrackedAndClear
     * @param {() => boolean} deps.readEnabledFlag
     * @param {(isEnabled: boolean) => void} deps.setEnabledFlagCache
     * @param {() => void} deps.attachListeners - 由入口檔注入（避免循環依賴）
     * @param {() => void} deps.detachListeners - 由入口檔注入（避免循環依賴）
     */
    function create(state, deps = {}) {
        if (!state) throw new Error('[DSS] temporary-chat-delete.handlers: create(state, deps) requires the shared state object');
        const { tracking, deleteTrackedAndClear, readEnabledFlag, setEnabledFlagCache, attachListeners, detachListeners } = deps;
        if (!tracking || !deleteTrackedAndClear || !readEnabledFlag || !setEnabledFlagCache || !attachListeners || !detachListeners) {
            throw new Error('[DSS] temporary-chat-delete.handlers: deps require tracking, deleteTrackedAndClear, readEnabledFlag, setEnabledFlagCache, attachListeners and detachListeners');
        }

        const extractUuidFromUrl = tracking.extractUuidFromUrl;

        /**
         * 處理來自 MAIN world XHR hook 的授權 token 訊息（DSS_AUTH_CAPTURED）。
         * 無論切換狀態如何皆保存 token（離開時刪除可能在切換關閉後才發生）。
         * @param {MessageEvent} e
         */
        function handleAuthMessage(e) {
            if (e.source !== window) return;
            if (e.data?.type !== globalThis.DSS_AUTH_CAPTURED_TYPE) return;
            state.capturedAuthToken = e.data.authorization || null;
            if (!e.data.authorization) return;
            // 委派 SW 的待刪佇列路由；fire-and-forget，失敗僅記錄
            Promise.resolve(chrome.runtime.sendMessage({
                type: globalThis.DSS_MSG_SET_LAST_AUTH_TOKEN,
                token: e.data.authorization,
            }))
                .then((response) => { if (response?.ok === false) throw new Error(response.error); })
                .catch((err) => console.error('[DSS] temporary-chat-delete.handlers handleAuthMessage:', err));
        }

        /**
         * 處理來自 MAIN world 的新對話建立偵測訊息（DSS_CHAT_CREATE_DETECTED）。
         * @param {MessageEvent} e
         */
        function handleCreateMessage(e) {
            if (e.source !== window) return;
            if (e.data?.type !== globalThis.DSS_CHAT_CREATE_MESSAGE_TYPE) return;
            if (!readEnabledFlag()) return;
            state.createDetected = true;
            tracking.checkCoOccurrence();
        }

        /**
         * 處理來自 MAIN world 的 completion API 偵測訊息（DSS_CHAT_COMPLETION_DETECTED）。
         * @param {MessageEvent} e
         */
        function handleCompletionMessage(e) {
            if (e.source !== window) return;
            if (e.data?.type !== globalThis.DSS_CHAT_COMPLETION_MESSAGE_TYPE) return;
            if (!readEnabledFlag()) return;
            state.completionDetected = true;
            tracking.checkCoOccurrence();
        }

        /**
         * 處理來自 MAIN world history hook 的 SPA 導航訊息（DSS_HISTORY_NAV）。
         * 建構合成的 NavigateEvent 物件並委派給 handleNavigationEvent。
         * @param {MessageEvent} e
         */
        function handleHistoryNavMessage(e) {
            if (e.source !== window) return;
            if (e.data?.type !== globalThis.DSS_HISTORY_NAV_TYPE) return;
            // 建構合成事件，使 handleNavigationEvent 可直接重用
            handleNavigationEvent({
                destination: { url: e.data.url },
                navigationType: 'push',
            });
        }

        /**
         * 統一處理所有 postMessage（根據 type 路由至對應處理器）。
         * @param {MessageEvent} e
         */
        function handleWindowMessage(e) {
            handleAuthMessage(e);
            handleCreateMessage(e);
            handleCompletionMessage(e);
            handleHistoryNavMessage(e);
        }

        /**
         * Navigation API navigate 事件處理器：
         * 1. 若離開的是追蹤中的臨時對話（且非刷新/同 URL），執行刪除。
         * 2. 若有待定建立旗標且導航目的地是對話頁面，標記該 UUID 為臨時對話。
         * @param {NavigateEvent} event
         */
        function handleNavigationEvent(event) {
            const destinationUrl = event.destination?.url || '';
            const isReload = (event.navigationType === 'reload');
            const isSameUrl = (destinationUrl === window.location.href);
            const isReloadOrSameUrl = isReload || isSameUrl;

            // 鍵盤補充旗標整合
            const isRefresh = isReloadOrSameUrl || state.isKeyboardRefresh;

            // beforeunload 抑制旗標只應由「真正的整頁刷新」武裝（含鍵盤刷新）。
            // 同 URL 的 SPA push（例如建立臨時對話時的第二次導航）不會卸載頁面，
            // 若也武裝此旗標，會在真正離開至外部網站時卡住不消耗，導致刪除被錯誤跳過。
            state.suppressNextUnloadDelete = isReload || state.isKeyboardRefresh;
            state.isKeyboardRefresh = false;

            const fromUuid = extractUuidFromUrl();

            // 目的地 UUID：即使目的地 URL 與目前 URL 僅差異於 query/hash，
            // 只要對話 UUID 相同即視為「同一對話」的再導航，不應觸發刪除。
            const destUuid = extractUuidFromUrl(destinationUrl);
            const isSameConversation = !!destUuid && destUuid === state.trackedTemporaryUuid;

            // 離開臨時對話：非刷新、非同一對話再導航、且有追蹤 UUID 與當前頁面 UUID 吻合
            if (!isRefresh && !isSameConversation && fromUuid && fromUuid === state.trackedTemporaryUuid && state.capturedAuthToken) {
                deleteTrackedAndClear({ keepalive: false });
            }

            // 標記新建立的臨時對話：有待定旗標且目的地是對話頁面
            if (state.isPendingCreate && readEnabledFlag()) {
                const destinationUuid = extractUuidFromUrl(new URL(destinationUrl).pathname);
                if (destinationUuid) {
                    tracking.trackUuid(destinationUuid);
                }
            }
        }

        /**
         * 鍵盤事件補充偵測（F5 / Ctrl+R / Cmd+R），與 Navigation API 並行。
         * @param {KeyboardEvent} e
         */
        function handleRefreshKeydown(e) {
            if (e.key === 'F5' ||
                (e.ctrlKey && e.key.toLowerCase() === 'r') ||
                (e.metaKey && e.key.toLowerCase() === 'r')) {
                state.isKeyboardRefresh = true;
            }
        }

        /**
         * beforeunload 處理器：涵蓋分頁關閉與 Navigation API 未處理的完整頁面導航。
         * keepalive=true 確保分頁關閉後請求仍能送出。
         */
        function handleBeforeUnload() {
            if (state.suppressNextUnloadDelete) return;
            if (state.isKeyboardRefresh) return;

            const currentUuid = extractUuidFromUrl();
            if (!currentUuid) return;
            if (currentUuid !== state.trackedTemporaryUuid) return;
            if (!state.capturedAuthToken) return;

            deleteTrackedAndClear({ keepalive: true });
        }

        /**
         * 處理 dss-temporary-chat-changed CustomEvent，根據新狀態調整監聽器。
         * 切換關閉時：若仍有追蹤對話則保留監聽器以等待刪除機會；否則卸載。
         * @param {CustomEvent} e
         */
        function handleToggleChanged(e) {
            const isEnabled = e.detail?.isEnabled === true;
            // 立即同步啟用旗標快取，確保後續 readEnabledFlag() 回傳正確值
            setEnabledFlagCache(isEnabled);
            if (isEnabled) {
                attachListeners();
            } else if (!state.trackedTemporaryUuid) {
                // 切換關閉：若有追蹤對話需保留監聽器（用於後續離開時刪除）
                detachListeners();
            }
        }

        return {
            handleAuthMessage,
            handleCreateMessage,
            handleCompletionMessage,
            handleHistoryNavMessage,
            handleWindowMessage,
            handleNavigationEvent,
            handleRefreshKeydown,
            handleBeforeUnload,
            handleToggleChanged,
        };
    }

    const bundle = { create };

    root.__DSS_TempChatDelete_handlers = bundle;

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
