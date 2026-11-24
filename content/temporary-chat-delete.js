/**
 * DS studio — Temporary Chat Delete（入口檔）
 * 單一職責：組合各部件、擁有監聽器生命週期與初始化流程。
 * 臨時對話的定義：本文件內 create 回應建立、且首次送出（completion）時切換為開啟的對話。
 * 歷史對話（直接導航至已存在對話）永遠不會被刪除。
 *
 * 載入順序（manifest.json 必須依此順序）：
 *   1. temporary-chat-constants.js   （常數）
 *   2. temporary-chat-enabled-flag.js（啟用旗標，經 background 設定路由；需 utils/message-constants.js 先行載入）
 *   3. background/pending-store.js / temporary-chat-delete-api.js
 *   4. temporary-chat-delete.tracking.js
 *   5. temporary-chat-delete.coordinator.js
 *   6. temporary-chat-delete.handlers.js
 *   7. temporary-chat-delete.js      （本檔）
 */

const TemporaryChatDelete = (() => {
    'use strict';

    const _root = globalThis;

    /**
     * 取得部件 bundle，缺少時以載入順序錯誤明確失敗。
     * @param {string} globalName
     */
    function _requirePart(globalName) {
        const part = _root[globalName];
        if (!part) {
            throw new Error(`[DSS] temporary-chat-delete: ${globalName} is missing — load the temporary-chat-delete.* part files before this entry file`);
        }
        return part;
    }

    /**
     * 取得共享啟用旗標模組（temporary-chat-enabled-flag.js）。
     */
    function _flag() {
        const flag = _root.TemporaryChatEnabledFlag;
        if (!flag) {
            throw new Error('[DSS] temporary-chat-delete: TemporaryChatEnabledFlag is missing — load content/temporary-chat-enabled-flag.js before this entry file');
        }
        return flag;
    }

    /** 讀取啟用旗標（同步，來源為共享旗標模組的快取）。 */
    const readEnabledFlag = () => _flag().isEnabled();

    /** 僅更新啟用旗標快取，不經 background 設定路由寫入。 */
    const setEnabledFlagCache = (isEnabled) => _flag().__setCache(isEnabled);

    /** 以 DSS_GET_SETTINGS 向 background 索取啟用旗標並更新快取。 */
    const initEnabledFlagFromStorage = () => _flag().initFromStorage();

    // ── 部件組合（單一共享狀態物件，以參照傳遞給所有部件） ──────────────────
    const _trackingPart = _requirePart('__DSS_TempChatDelete_tracking');
    const _coordinatorPart = _requirePart('__DSS_TempChatDelete_coordinator');
    const _handlersPart = _requirePart('__DSS_TempChatDelete_handlers');

    const state = _trackingPart.createState();
    const tracking = _trackingPart.create(state);
    const coordinator = _coordinatorPart.create(state, {
        tracking,
        readEnabledFlag,
        detachListeners: () => detachListeners(),
    });
    const handlers = _handlersPart.create(state, {
        tracking,
        deleteTrackedAndClear: coordinator.deleteTrackedAndClear,
        handOffToServiceWorker: coordinator.handOffToServiceWorker,
        readEnabledFlag,
        setEnabledFlagCache,
        attachListeners: () => attachListeners(),
        detachListeners: () => detachListeners(),
    });

    // ── 監聽器生命週期（留在入口檔，切斷部件間的循環依賴） ──────────────────

    /**
     * 掛載所有事件監聽器（冪等：已掛載時直接返回）。
     * 必須使用 handlers 上的同一份函式參照，否則卸載會靜默失效。
     * 由卸載轉為掛載的那一刻（切換開啟），把關閉期間只留在本分頁記憶體的 token 交給背景一次。
     */
    function attachListeners() {
        if (state.isListening) return;
        state.isListening = true;

        window.addEventListener('message', handlers.handleWindowMessage);
        window.addEventListener('beforeunload', handlers.handleBeforeUnload);
        // 失效 toast 刷新前發出（content/invalidation-toast.js），用以抑制 beforeunload 刪除
        window.addEventListener('dss-intentional-reload', handlers.handleIntentionalReload);

        if (typeof window.navigation !== 'undefined') {
            window.navigation.addEventListener('navigate', handlers.handleNavigationEvent);
        }
        document.addEventListener('keydown', handlers.handleRefreshKeydown, true);
        handlers.relayAuthToken(state.capturedAuthToken);
    }

    /**
     * 卸載所有事件監聽器（冪等：未掛載時直接返回）。
     */
    function detachListeners() {
        if (!state.isListening) return;
        state.isListening = false;
        // 卸載監聽器同時停止心跳（防禦性參照，缺失不拋）
        _root.TemporaryChatHeartbeat?.stop?.();

        window.removeEventListener('message', handlers.handleWindowMessage);
        window.removeEventListener('beforeunload', handlers.handleBeforeUnload);
        window.removeEventListener('dss-intentional-reload', handlers.handleIntentionalReload);

        if (typeof window.navigation !== 'undefined') {
            window.navigation.removeEventListener('navigate', handlers.handleNavigationEvent);
        }
        document.removeEventListener('keydown', handlers.handleRefreshKeydown, true);
    }

    /**
     * 啟用旗標跨情境變更時的反應（由旗標模組的 subscribe 呼叫）。
     * @param {boolean} isNowEnabled
     */
    function handleEnabledFlagChanged(isNowEnabled) {
        if (!isNowEnabled && !state.trackedTemporaryUuid) {
            detachListeners();
        } else if (isNowEnabled) {
            attachListeners();
        }
    }

    /**
     * 常駐的授權 token 擷取：頁面載入即掛載、不隨切換卸載。
     * MAIN world hook 只在 token 值改變時才 postMessage，若僅在切換開啟後才擷取，切換關閉期間送出的唯一一次 DSS_AUTH_CAPTURED 會遺失，之後離開時即無 token 可刪除。
     * 監聽器卸載期間（切換關閉）只把 token 留在本分頁記憶體，不傳背景、不寫儲存；切換開啟時由 attachListeners 交給背景。
     * 監聽器已掛載時由 handleWindowMessage 處理 auth，此處跳過以免重複處理。
     * @param {MessageEvent} e
     */
    function handleResidentAuthMessage(e) {
        if (state.isListening) return;
        handlers.holdAuthMessage(e);
    }

    // ── 初始化 ───────────────────────────────────────────────────────────────

    /**
     * 初始化模組：訂閱啟用旗標變更、從 sessionStorage 恢復追蹤 UUID、
     * 經 background 設定路由讀取啟用旗標，並決定是否掛載監聽器。
     * @returns {Promise<void>}
     */
    async function init() {
        const CHANGED_EVENT = globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_CHANGED_EVENT;
        window.addEventListener(CHANGED_EVENT, handlers.handleToggleChanged);
        // 常駐 session 觀察器：不隨切換卸載，切換開啟前的 create 與首次送出狀態也須被記錄
        window.addEventListener('message', handlers.handleSessionMessage);
        // 常駐 auth 擷取：切換關閉時只在記憶體保存 token，供之後開啟切換的離開刪除使用
        window.addEventListener('message', handleResidentAuthMessage);

        const flag = _flag();
        flag.startSync();
        flag.subscribe(handleEnabledFlagChanged);

        // 先恢復追蹤 UUID，再掛載監聽器，確保 handleWindowMessage 在 await 之前即已就緒
        state.trackedTemporaryUuid = tracking.loadTrackedUuid();
        // 刷新後恢復追蹤即續傳心跳（防禦性參照，缺失不拋）
        if (state.trackedTemporaryUuid) _root.TemporaryChatHeartbeat?.start?.(state.trackedTemporaryUuid);

        if (state.trackedTemporaryUuid) {
            attachListeners();
        }

        await flag.initFromStorage();

        // await 返回後，若啟用旗標為 true 且監聽器尚未掛載，補充掛載
        if (flag.isEnabled() && !state.isListening) {
            attachListeners();
        }
    }

    return {
        init,
        state,
        // 供單元測試使用的函式與狀態存取器匯出
        extractUuidFromUrl: tracking.extractUuidFromUrl,
        readEnabledFlag,
        initEnabledFlagFromStorage,
        loadTrackedUuid: tracking.loadTrackedUuid,
        saveTrackedUuid: tracking.saveTrackedUuid,
        recordCreatedSession: tracking.recordCreatedSession,
        recordCompletionSession: tracking.recordCompletionSession,
        deleteTrackedAndClear: coordinator.deleteTrackedAndClear,
        handOffToServiceWorker: coordinator.handOffToServiceWorker,
        handleAuthMessage: handlers.handleAuthMessage,
        handleCreateMessage: handlers.handleCreateMessage,
        handleCompletionMessage: handlers.handleCompletionMessage,
        handleSessionMessage: handlers.handleSessionMessage,
        handleHistoryNavMessage: handlers.handleHistoryNavMessage,
        handleWindowMessage: handlers.handleWindowMessage,
        handleBeforeUnload: handlers.handleBeforeUnload,
        handleNavigationEvent: handlers.handleNavigationEvent,
        handleRefreshKeydown: handlers.handleRefreshKeydown,
        handleToggleChanged: handlers.handleToggleChanged,
        attachListeners,
        detachListeners,
    };
})();

// Auto-start：入口檔的刻意啟動點（各部件本身無載入期副作用）
TemporaryChatDelete.init();

// Test export（瀏覽器中為 no-op）
// Stryker disable all: equivalent mutants — module type check is environment-dependent, untestable in Node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatDelete;
}
// Stryker restore all
