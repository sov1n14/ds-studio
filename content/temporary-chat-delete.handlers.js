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
     * @param {(uuid: string) => void} deps.handOffToServiceWorker
     * @param {() => boolean} deps.readEnabledFlag
     * @param {(isEnabled: boolean) => void} deps.setEnabledFlagCache
     * @param {() => void} deps.attachListeners - 由入口檔注入（避免循環依賴）
     * @param {() => void} deps.detachListeners - 由入口檔注入（避免循環依賴）
     */
    function create(state, deps = {}) {
        if (!state) throw new Error('[DSS] temporary-chat-delete.handlers: create(state, deps) requires the shared state object');
        const { tracking, deleteTrackedAndClear, handOffToServiceWorker, readEnabledFlag, setEnabledFlagCache, attachListeners, detachListeners } = deps;
        if (!tracking || !deleteTrackedAndClear || !handOffToServiceWorker || !readEnabledFlag || !setEnabledFlagCache || !attachListeners || !detachListeners) {
            throw new Error('[DSS] temporary-chat-delete.handlers: deps require tracking, deleteTrackedAndClear, handOffToServiceWorker, readEnabledFlag, setEnabledFlagCache, attachListeners and detachListeners');
        }

        const extractUuidFromUrl = tracking.extractUuidFromUrl;

        /**
         * 只把 MAIN world XHR hook 的授權 token（DSS_AUTH_CAPTURED）存入本分頁記憶體：不傳背景、不寫儲存。
         * @param {MessageEvent} e
         * @returns {boolean} 是否為本視窗的 DSS_AUTH_CAPTURED 訊息
         */
        function holdAuthMessage(e) {
            if (e.source !== window) return false;
            if (e.data?.type !== globalThis.DSS_TEMP_CHAT.DSS_AUTH_CAPTURED_TYPE) return false;
            state.capturedAuthToken = e.data.authorization || null;
            return true;
        }

        /** 把 token 交給 SW 的待刪佇列路由（DSS_SET_LAST_AUTH_TOKEN）；無 token 時不送。fire-and-forget，失敗僅記錄。 */
        function relayAuthToken(token) {
            if (!token) return;
            Promise.resolve(chrome.runtime.sendMessage({ type: globalThis.DSS_TEMP_CHAT.DSS_MSG_SET_LAST_AUTH_TOKEN, token }))
                .then((response) => { if (response?.ok === false) throw new Error(response.error); })
                .catch((err) => console.error('[DSS] temporary-chat-delete.handlers relayAuthToken:', err));
        }

        /** 監聽器掛載期間的 auth 訊息：保存 token 並立即交給 SW（離開時刪除可能在切換關閉後才發生）。 */
        function handleAuthMessage(e) {
            if (holdAuthMessage(e)) relayAuthToken(state.capturedAuthToken);
        }

        /**
         * 處理來自 MAIN world 的新對話建立訊息（DSS_CHAT_CREATE_DETECTED { createdSessionId }）。
         * 不受切換狀態限制：切換可能在頁面載入的 create 之後才開啟，id 仍須保留供首次送出時配對。
         * @param {MessageEvent} e
         */
        function handleCreateMessage(e) {
            if (e.source !== window) return;
            if (e.data?.type !== globalThis.DSS_TEMP_CHAT.DSS_CHAT_CREATE_MESSAGE_TYPE) return;
            tracking.recordCreatedSession(e.data.createdSessionId);
        }

        /**
         * 處理來自 MAIN world 的 completion 請求訊息（DSS_CHAT_COMPLETION_DETECTED { chatSessionId }）。
         * 一律記錄（判定首次送出），並附上送出當下的切換狀態。
         * @param {MessageEvent} e
         */
        function handleCompletionMessage(e) {
            if (e.source !== window) return;
            if (e.data?.type !== globalThis.DSS_TEMP_CHAT.DSS_CHAT_COMPLETION_MESSAGE_TYPE) return;
            tracking.recordCompletionSession(e.data.chatSessionId, readEnabledFlag());
        }

        /**
         * 常駐的 session 觀察器：路由 create 與 completion 訊息。
         * 由入口檔於 init 掛載且不隨切換卸載，確保切換開啟前發生的 create 與首次送出都被觀察到。
         * @param {MessageEvent} e
         */
        function handleSessionMessage(e) {
            handleCreateMessage(e);
            handleCompletionMessage(e);
        }

        /**
         * 處理來自 MAIN world history hook 的 SPA 導航訊息（DSS_HISTORY_NAV）。
         * 建構合成的 NavigateEvent 物件並委派給 handleNavigationEvent。
         * @param {MessageEvent} e
         */
        function handleHistoryNavMessage(e) {
            if (e.source !== window) return;
            if (e.data?.type !== globalThis.DSS_TEMP_CHAT.DSS_HISTORY_NAV_TYPE) return;
            // 建構合成事件，使 handleNavigationEvent 可直接重用
            handleNavigationEvent({
                destination: { url: e.data.url },
                navigationType: 'push',
            });
        }

        /**
         * 統一處理切換期間的 postMessage（根據 type 路由至對應處理器）。
         * create 與 completion 由常駐的 handleSessionMessage 處理，不在此重複路由。
         * @param {MessageEvent} e
         */
        function handleWindowMessage(e) {
            handleAuthMessage(e);
            handleHistoryNavMessage(e);
        }

        /**
         * Navigation API navigate 事件處理器：
         * 1. 若離開的是追蹤中的臨時對話（且非刷新/同 URL），執行刪除。
         * 2. 若導航目的地正是已配對的臨時對話 UUID，標記該 UUID（其他對話一律不標記）。
         * @param {NavigateEvent} event
         */
        function handleNavigationEvent(event) {
            const destinationUrl = event.destination?.url || '';

            // 匯出對話時 <a download> 點擊會觸發 navigate 事件，但使用者並未離開頁面。
            // 透過 downloadRequest（瀏覽器標示檔案下載）或 blob: scheme 偵測，直接跳出避免誤刪。
            const isDownload = event.downloadRequest != null || destinationUrl.startsWith('blob:');
            if (isDownload) return;
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

            // 擴充功能 context 已失效時跳出刪除與追蹤分支，避免後續 chrome API 呼叫擲出。
            // 刷新偵測必須在此之前完成：失效後的刷新仍需武裝 beforeunload 抑制旗標，否則會誤刪。
            if (!chrome.runtime?.id) return;

            const fromUuid = extractUuidFromUrl();

            // 目的地 UUID：即使目的地 URL 與目前 URL 僅差異於 query/hash，
            // 只要對話 UUID 相同即視為「同一對話」的再導航，不應觸發刪除。
            const destUuid = extractUuidFromUrl(destinationUrl);
            const isSameConversation = !!destUuid && destUuid === state.trackedTemporaryUuid;

            // 離開臨時對話：非刷新、非同一對話再導航、且有追蹤 UUID 與當前頁面 UUID 吻合
            const isLeavingTracked = !isRefresh && !isSameConversation && fromUuid && fromUuid === state.trackedTemporaryUuid;
            if (isLeavingTracked) {
                if (state.capturedAuthToken) {
                    deleteTrackedAndClear({ keepalive: false });
                    return;
                } else {
                    // 無 token（例如 Chrome 還原分頁）→ 交接 SW 排程重試
                    handOffToServiceWorker(fromUuid);
                    return;
                }
            }

            // 標記新建立的臨時對話：目的地必須正是已配對（本文件建立且以開啟狀態首次送出）的 UUID
            const isPendingDestination = !!destUuid && destUuid === state.pendingTemporaryUuid;
            if (isPendingDestination && readEnabledFlag()) {
                tracking.trackUuid(destUuid);
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
         * 失效 toast 發出的「刻意刷新」事件：武裝 beforeunload 抑制旗標。
         * toast 的 location.reload() 不保證先觸發 navigate 事件，故需此獨立通道。
         */
        function handleIntentionalReload() {
            state.suppressNextUnloadDelete = true;
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
            holdAuthMessage,
            relayAuthToken,
            handleAuthMessage,
            handleCreateMessage,
            handleCompletionMessage,
            handleSessionMessage,
            handleHistoryNavMessage,
            handleWindowMessage,
            handleNavigationEvent,
            handleRefreshKeydown,
            handleIntentionalReload,
            handleBeforeUnload,
            handleToggleChanged,
        };
    }

    const bundle = { create };

    root.__DSS_TempChatDelete_handlers = bundle;

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
