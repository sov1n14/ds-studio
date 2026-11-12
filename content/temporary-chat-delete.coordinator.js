/**
 * DS studio — Temporary Chat Delete / 刪除協調部件
 * 單一職責：協調追蹤中臨時對話的刪除（React Fiber 優先、API 重試 fallback、SW alarm 補救）。
 * 常數由 temporary-chat-constants.js 在前載入提供（classic script，無 ESM import）。
 * 無載入期副作用：入口檔 temporary-chat-delete.js 負責組合本部件並注入生命週期能力。
 */
(function (root) {
    'use strict';

    const FIBER_RESULT_TIMEOUT_MS = 3000;

    /**
     * 委派 SW 的待刪佇列路由（content 層不直接觸碰 chrome.storage）。
     * fire-and-forget：刪除流程不等待結果，失敗僅記錄。
     * 同步 throw 防護：擴充功能情境失效時 chrome.runtime.sendMessage 會同步拋出，
     * 以 try/catch 包覆避免逸入呼叫端（參照 temporary-chat-heartbeat.js 同模式）。
     * @param {string} type - 訊息型別常數
     * @param {object} payload - 路由所需欄位（{uuid} 或 {chatUuid}）
     * @param {string} context - 記錄用的呼叫點名稱
     */
    function sendPendingStoreRoute(type, payload, context) {
        try {
            Promise.resolve(chrome.runtime.sendMessage({ type, ...payload }))
                .then((response) => { if (response?.ok === false) throw new Error(response.error); })
                .catch((err) => console.error(`[DSS] temporary-chat-delete.coordinator ${context}:`, err));
        } catch (err) {
            console.error(`[DSS] temporary-chat-delete.coordinator ${context}:`, err);
        }
    }

    /** 自跨裝置待刪佇列移除指定 UUID（確認刪除成功後呼叫）。 */
    function removePendingDeleteRoute(uuid) {
        sendPendingStoreRoute(
            globalThis.DSS_TEMP_CHAT.DSS_MSG_REMOVE_PENDING_DELETE,
            { uuid },
            'removePendingDelete'
        );
    }

    /**
     * 綁定共享狀態與依賴，回傳刪除協調操作。
     * @param {object} state - tracking 部件建立的共享狀態物件
     * @param {object} deps
     * @param {object} deps.tracking - tracking 部件的已綁定 API
     * @param {() => boolean} deps.readEnabledFlag - 讀取啟用旗標
     * @param {() => void} deps.detachListeners - 由入口檔注入的卸載能力（避免循環依賴）
     */
    function create(state, { tracking, readEnabledFlag, detachListeners } = {}) {
        if (!state) throw new Error('[DSS] temporary-chat-delete.coordinator: create(state, deps) requires the shared state object');
        if (!tracking || !readEnabledFlag || !detachListeners) {
            throw new Error('[DSS] temporary-chat-delete.coordinator: deps require tracking, readEnabledFlag and detachListeners');
        }

        /**
         * 無 token 時的清理手續：停止心跳、釋放 lease、排程 SW 重試、移除 open-uuid、清除追蹤狀態。
         * 供「重試耗盡」與「無 token 導航離開」兩條路徑共用，避免重複訊息發送邏輯。
         * @param {string} uuid - 要交接給 SW 的對話 UUID
         */
        function handOffToServiceWorker(uuid) {
            if (!uuid) return;
            state.trackedTemporaryUuid = null;
            tracking.saveTrackedUuid(null);
            root.TemporaryChatHeartbeat?.stop?.();
            sendPendingStoreRoute(globalThis.DSS_TEMP_CHAT.DSS_MSG_REMOVE_OPEN_UUID, { uuid }, 'removeOpenUuid');
            // 排程 SW alarm 重試刪除（fire-and-forget，統一透過 sendPendingStoreRoute 防護同步 throw）
            sendPendingStoreRoute(globalThis.DSS_TEMP_CHAT.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE, { chatUuid: uuid }, 'scheduleDeleteRetry');
            sendPendingStoreRoute(globalThis.DSS_TEMP_CHAT.DSS_MSG_RELEASE_LEASE, { uuid }, 'releaseLease');
            if (!readEnabledFlag()) {
                detachListeners();
            }
        }

        /**
         * 導航離開時刪除已追蹤的臨時對話並清除追蹤狀態（分頁卸載不經此處，改由 SW 寬限期決定）。
         * Guard clause：無追蹤 UUID 或無 token 時立即返回。
         * 優先透過 MAIN world 的 React Fiber 刪除，失敗或逾時則以 API 重試刪除。
         */
        function deleteTrackedAndClear() {
            if (!state.trackedTemporaryUuid) return;
            if (!state.capturedAuthToken) return;

            const uuidToDelete = state.trackedTemporaryUuid;
            const tokenSnapshot = state.capturedAuthToken;
            state.trackedTemporaryUuid = null;
            tracking.saveTrackedUuid(null);
            // 追蹤結束：停止心跳（防禦性參照，缺失不拋）
            root.TemporaryChatHeartbeat?.stop?.();

            // deleteTrackedAndClear 僅於導航離開時呼叫，
            // 故此處由本機開啟集合中移除該 UUID（best-effort，不阻塞刪除流程）。
            sendPendingStoreRoute(
                globalThis.DSS_TEMP_CHAT.DSS_MSG_REMOVE_OPEN_UUID,
                { uuid: uuidToDelete },
                'removeOpenUuid'
            );

            const FIBER_REQ = globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE;
            const FIBER_RES = globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_RESULT_TYPE;

            let hasFallbackTriggered = false;
            let timeoutId = null;

            const fallbackToApi = async () => {
                // Stryker disable next-line ConditionalExpression: 等效突變——兩條觸發路徑進入後都在第一個 await 前同步移除監聽器並清除計時器，第二條路徑無從再觸發，旗標防護屬多餘
                if (hasFallbackTriggered) return;
                // Stryker disable next-line BooleanLiteral: 等效突變——其後同步移除監聽器並清除計時器，旗標防護屬多餘
                hasFallbackTriggered = true;
                window.removeEventListener('message', resultListener);
                // Stryker disable next-line ConditionalExpression,CallExpression: 等效突變——timeoutId 必於任何訊息抵達前設定；未清除的計時器稍後觸發時開頭的旗標防護立即返回，只多留一個待執行計時器
                if (timeoutId) clearTimeout(timeoutId);
                const isOk = await TemporaryChatDeleteApi.deleteChatSessionWithRetry(uuidToDelete, tokenSnapshot);
                if (isOk) {
                    removePendingDeleteRoute(uuidToDelete);
                } else {
                    // 情境存活但重試耗盡 → 釋放 lease 並排程 SW alarm 重試（統一透過 sendPendingStoreRoute 防護）
                    sendPendingStoreRoute(globalThis.DSS_TEMP_CHAT.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE, { chatUuid: uuidToDelete }, 'scheduleDeleteRetry');
                    sendPendingStoreRoute(globalThis.DSS_TEMP_CHAT.DSS_MSG_RELEASE_LEASE, { uuid: uuidToDelete }, 'releaseLease');
                }
            };

            const resultListener = (e) => {
                if (e.source !== window) return;
                if (e.data?.type !== FIBER_RES) return;
                // Stryker disable next-line OptionalChaining: 等效突變——上一行已於 e.data 為 null/undefined 時返回
                if (e.data?.sessionId !== uuidToDelete) return;

                if (e.data.success) {
                    if (timeoutId) clearTimeout(timeoutId);
                    window.removeEventListener('message', resultListener);
                    removePendingDeleteRoute(uuidToDelete);
                } else {
                    fallbackToApi();
                }
            };

            window.addEventListener('message', resultListener);
            timeoutId = setTimeout(fallbackToApi, FIBER_RESULT_TIMEOUT_MS);

            window.postMessage({
                type: FIBER_REQ,
                sessionId: uuidToDelete
            }, '*');

            if (!readEnabledFlag()) {
                detachListeners();
            }
        }

        return { deleteTrackedAndClear, handOffToServiceWorker };
    }

    const bundle = { create };

    root.__DSS_TempChatDelete_coordinator = bundle;

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
