/**
 * DS studio — Temporary Chat Delete / 追蹤狀態部件
 * 單一職責：擁有共享狀態物件、UUID 的 sessionStorage 持久化，以及 create + completion
 * 的 co-occurrence 偵測。
 * 常數由 temporary-chat-constants.js 在前載入提供（classic script，無 ESM import）。
 * 無載入期副作用：入口檔 temporary-chat-delete.js 負責組合本部件。
 */
(function (root) {
    'use strict';

    // 常數參照：classic script 的 top-level const 不會掛上 globalThis，故保留硬編碼 fallback
    const _getConst = (name, fallback) =>
        (typeof globalThis !== 'undefined' && globalThis[name] !== undefined)
            ? globalThis[name]
            : (typeof window !== 'undefined' && window[name] !== undefined)
                ? window[name]
                : fallback;

    // Session id 擷取共用工具（瀏覽器：chat-session-id.js 在前載入；Node.js 測試：直接 require）
    const chatSessionId = root.DSSChatSessionId ||
        (typeof require !== 'undefined' ? require('./chat-session-id.js') : {});

    const CO_OCCURRENCE_WINDOW_MS = 1000;

    /**
     * 建立唯一的共享狀態物件。所有部件皆以參照共用此物件，不得自行保存旗標副本。
     * 啟用旗標不在此處：由 TemporaryChatEnabledFlag 集中持有。
     */
    function createState() {
        return {
            capturedAuthToken: null,
            // 追蹤中的臨時對話 UUID（null 表示無追蹤；同步至 sessionStorage 以跨刷新保存）
            trackedTemporaryUuid: null,
            // co-occurrence 視窗信號旗標
            createDetected: false,
            completionDetected: false,
            // create + completion 於視窗內同時出現時為 true，觸發 UUID 標記
            isPendingCreate: false,
            coOccurrenceTimer: null,
            // Navigation API navigate 事件中設定，阻止 beforeunload 重複刪除同一次離開
            suppressNextUnloadDelete: false,
            // 鍵盤補充刷新旗標（F5 / Ctrl+R / Cmd+R）
            isKeyboardRefresh: false,
            // 監聽器是否已掛載（避免重複 add/remove）
            isListening: false,
        };
    }

    /**
     * 從 sessionStorage 讀取追蹤中的臨時對話 UUID。
     * @returns {string|null}
     */
    function loadTrackedUuid() {
        try {
            const key = _getConst('DSS_TEMP_CHAT_UUID_KEY', 'dss-temporary-chat-uuid');
            return sessionStorage.getItem(key) || null;
        } catch {
            return null;
        }
    }

    /**
     * 將追蹤中的臨時對話 UUID 持久化至 sessionStorage。
     * @param {string|null} uuid
     */
    function saveTrackedUuid(uuid) {
        try {
            const key = _getConst('DSS_TEMP_CHAT_UUID_KEY', 'dss-temporary-chat-uuid');
            if (uuid) {
                sessionStorage.setItem(key, uuid);
            } else {
                sessionStorage.removeItem(key);
            }
        } catch {
            // 靜默忽略（隱私模式或儲存空間不足）
        }
    }

    /**
     * 從 URL（可為完整 href 或僅 pathname）擷取聊天 UUID（格式：/a/chat/s/<uuid>）。
     * 實作委派 DSSChatSessionId.extractChatSessionId()，傳入完整 href 或僅 pathname 皆可。
     * @param {string} [urlOrPath] - 預設使用 window.location.pathname
     * @returns {string|null}
     */
    function extractUuidFromUrl(urlOrPath) {
        return chatSessionId.extractChatSessionId(urlOrPath);
    }

    /**
     * 綁定共享狀態，回傳追蹤相關操作。
     * @param {object} state - createState() 產生的共享狀態物件
     */
    function create(state) {
        if (!state) throw new Error('[DSS] temporary-chat-delete.tracking: create(state) requires the shared state object');

        /**
         * 標記指定 UUID 為追蹤中的臨時對話（同時持久化並登記待刪佇列）。
         * @param {string} uuid
         */
        function trackUuid(uuid) {
            state.trackedTemporaryUuid = uuid;
            saveTrackedUuid(uuid);
            TemporaryChatPendingStore.trackForDeletion(uuid);
            state.isPendingCreate = false;
        }

        /**
         * 檢查 create 與 completion 兩個信號是否在視窗內同時出現。
         * 若已同時出現：清除計時器並設定 isPendingCreate。
         * 若只有單一信號：啟動超時計時器，逾時後重置兩個旗標。
         */
        function checkCoOccurrence() {
            if (state.createDetected && state.completionDetected) {
                clearTimeout(state.coOccurrenceTimer);
                state.coOccurrenceTimer = null;
                state.createDetected = false;
                state.completionDetected = false;
                state.isPendingCreate = true;

                // 競態修正：若 SPA 在 co-occurrence 完成前已導航至新對話，立即標記
                const currentUuid = extractUuidFromUrl();
                if (currentUuid) {
                    trackUuid(currentUuid);
                }
                return;
            }
            if (state.coOccurrenceTimer === null) {
                state.coOccurrenceTimer = setTimeout(() => {
                    state.createDetected = false;
                    state.completionDetected = false;
                    state.coOccurrenceTimer = null;
                }, CO_OCCURRENCE_WINDOW_MS);
            }
        }

        return { loadTrackedUuid, saveTrackedUuid, extractUuidFromUrl, trackUuid, checkCoOccurrence };
    }

    const bundle = { createState, create, loadTrackedUuid, saveTrackedUuid, extractUuidFromUrl };

    root.__DSS_TempChatDelete_tracking = bundle;

    // Test export（瀏覽器中為 no-op）
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : window);
