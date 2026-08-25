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
     * @param {string} type - 訊息型別常數
     * @param {object} payload - 路由所需欄位（{uuid}）
     * @param {string} context - 記錄用的呼叫點名稱
     */
    function sendPendingStoreRoute(type, payload, context) {
        Promise.resolve(chrome.runtime.sendMessage({ type, ...payload }))
            .then((response) => { if (response?.ok === false) throw new Error(response.error); })
            .catch((err) => console.error(`[DSS] temporary-chat-delete.coordinator ${context}:`, err));
    }

    /** 自跨裝置待刪佇列移除指定 UUID（確認刪除成功後呼叫）。 */
    function removePendingDeleteRoute(uuid) {
        sendPendingStoreRoute(
            globalThis.DSS_MSG_REMOVE_PENDING_DELETE,
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
         * 刪除已追蹤的臨時對話並清除追蹤狀態。
         * Guard clause：無追蹤 UUID 或無 token 時立即返回。
         * keepalive=true → 以 keepalive fetch 執行（分頁關閉情境）。
         * keepalive=false → 在 content script 以重試機制執行（導航情境）。
         * @param {{ keepalive?: boolean }} [options]
         */
        function deleteTrackedAndClear({ keepalive = false } = {}) {
            if (!state.trackedTemporaryUuid) return;
            if (!state.capturedAuthToken) return;

            const uuidToDelete = state.trackedTemporaryUuid;
            const tokenSnapshot = state.capturedAuthToken;
            state.trackedTemporaryUuid = null;
            tracking.saveTrackedUuid(null);
            // 追蹤結束：停止心跳（防禦性參照，缺失不拋）
            root.TemporaryChatHeartbeat?.stop?.();

            // deleteTrackedAndClear 僅於離開情境呼叫（SPA 離開或分頁/瀏覽器關閉），
            // 故此處由本機開啟集合中移除該 UUID（best-effort，不阻塞刪除流程）。
            sendPendingStoreRoute(
                globalThis.DSS_MSG_REMOVE_OPEN_UUID,
                { uuid: uuidToDelete },
                'removeOpenUuid'
            );

            if (keepalive) {
                // 分頁/瀏覽器關閉：直接以 keepalive fetch 執行刪除，確認成功後才移除待刪佇列項目
                TemporaryChatDeleteApi.deleteChatSession(uuidToDelete, tokenSnapshot, { keepalive: true })
                    .then((isOk) => { if (isOk) removePendingDeleteRoute(uuidToDelete); })
                    .catch(() => {});
                // teardown 期間 .then 可能不執行 → 項目留在 sync 佇列，交由 onStartup 補救（confirmed-deletion invariant）
            } else {
                // 導航觸發：優先透過 MAIN world 的 React Fiber 刪除，失敗則 fallback 到 API 刪除
                const FIBER_REQ = globalThis.DSS_FIBER_DELETE_MESSAGE_TYPE;
                const FIBER_RES = globalThis.DSS_FIBER_DELETE_RESULT_TYPE;

                let fallbackTriggered = false;
                let timeoutId = null;

                const fallbackToApi = async () => {
                    if (fallbackTriggered) return;
                    fallbackTriggered = true;
                    window.removeEventListener('message', resultListener);
                    if (timeoutId) clearTimeout(timeoutId);
                    const isOk = await TemporaryChatDeleteApi.deleteChatSessionWithRetry(uuidToDelete, tokenSnapshot);
                    if (isOk) {
                        removePendingDeleteRoute(uuidToDelete);
                    } else {
                        // 情境存活但重試耗盡 → 保留佇列項目，請 SW 排程 alarm 重試
                        chrome.runtime.sendMessage({
                            type: globalThis.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE,
                            chatUuid: uuidToDelete,
                        });
                        // 同步歸零本項 lease，讓其他裝置可立即接手（保留佇列項目，不移除）
                        sendPendingStoreRoute(
                            globalThis.DSS_MSG_RELEASE_LEASE,
                            { uuid: uuidToDelete },
                            'releaseLease'
                        );
                    }
                };

                const resultListener = (e) => {
                    if (e.source !== window) return;
                    if (e.data?.type !== FIBER_RES) return;
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
            }

            if (!readEnabledFlag()) {
                detachListeners();
            }
        }

        return { deleteTrackedAndClear };
    }

    const bundle = { create };

    root.__DSS_TempChatDelete_coordinator = bundle;

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
