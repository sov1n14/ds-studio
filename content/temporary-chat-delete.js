/**
 * DS studio — Temporary Chat Delete
 * 單一職責：管理臨時對話的刪除邏輯。
 * 臨時對話的定義：切換開啟時，由 create + completion API 共同觸發標記的對話。
 * 歷史對話（直接導航至已存在對話）永遠不會被刪除。
 * 常數由 temporary-chat-constants.js 在前載入提供。
 * 刪除 API 由 temporary-chat-delete-api.js 提供（TemporaryChatDeleteApi）。
 */

const TemporaryChatDelete = (() => {
    'use strict';

    // ── 常數參照（由 temporary-chat-constants.js 在前載入） ──────────────────
    const _getConst = (name, fallback) =>
        (typeof globalThis !== 'undefined' && globalThis[name] !== undefined)
            ? globalThis[name]
            : (typeof window !== 'undefined' && window[name] !== undefined)
                ? window[name]
                : fallback;

    // ── 私有模組狀態 ─────────────────────────────────────────────────────────
    let _capturedAuthToken = null;

    // 追蹤中的臨時對話 UUID（null 表示無追蹤；同步至 sessionStorage 以跨刷新保存）
    let _trackedTemporaryUuid = null;

    // Gap 1：啟用旗標快取（由 chrome.storage.session 同步，取代 sessionStorage 讀取）
    let _enabledFlagCache = false;

    // Gap 2：co-occurrence 視窗信號旗標
    let _createDetected = false;     // 偵測到 create API 請求
    let _completionDetected = false; // 偵測到 completion API 請求

    // 當 create + completion 在 1000ms 內同時出現時設為 true，觸發 UUID 標記
    let _isPendingCreate = false;

    // co-occurrence 超時計時器 handle
    let _coOccurrenceTimer = null;

    // Navigation API navigate 事件中設定，阻止 beforeunload 重複刪除同一次離開
    let _suppressNextUnloadDelete = false;

    // 鍵盤補充刷新旗標（F5 / Ctrl+R / Cmd+R）
    let _isKeyboardRefresh = false;

    // 監聽器是否已掛載（避免重複 add/remove）
    let _isListening = false;

    // ── sessionStorage 工具（UUID 追蹤用，跨刷新保存） ───────────────────────

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

    // ── Gap 1：chrome.storage.session 啟用旗標 ──────────────────────────────

    /**
     * 讀取啟用旗標快取（由 initEnabledFlagFromStorage 與 onChanged 維護）。
     * @returns {boolean}
     */
    function readEnabledFlag() {
        return _enabledFlagCache;
    }

    /**
     * 從 chrome.storage.session 讀取啟用旗標並更新快取。
     * 在 init() 中 await，確保監聽器掛載前狀態已就緒。
     * @returns {Promise<void>}
     */
    async function initEnabledFlagFromStorage() {
        const key = _getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled');
        try {
            const result = await chrome.storage.local.get([key]);
            _enabledFlagCache = result[key] === true;
        } catch {
            _enabledFlagCache = false;
        }
    }

    // chrome.storage.onChanged：跨分頁即時同步啟用旗標
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const key = _getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled');
        if (!(key in changes)) return;
        const isNowEnabled = changes[key].newValue === true;
        _enabledFlagCache = isNowEnabled;
        if (!isNowEnabled && !_trackedTemporaryUuid) {
            detachListeners();
        } else if (isNowEnabled) {
            attachListeners();
        }
    });

    // ── 純工具函式 ───────────────────────────────────────────────────────────

    /**
     * 從 URL pathname 擷取聊天 UUID（格式：/a/chat/s/<uuid>）。
     * @param {string} [pathname] - 預設使用 window.location.pathname
     * @returns {string|null}
     */
    function extractUuidFromUrl(pathname) {
        const path = pathname !== undefined ? pathname : window.location.pathname;
        const match = path.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
        return match ? match[1] : null;
    }

    // ── Gap 2：co-occurrence 視窗（1000ms 內 create + completion 同時出現） ──

    /**
     * 檢查兩個信號是否在視窗內同時出現。
     * 若已同時出現：清除計時器並設定 _isPendingCreate。
     * 若只有單一信號：啟動 1000ms 超時計時器，逾時後重置兩個旗標。
     */
    function checkCoOccurrence() {
        if (_createDetected && _completionDetected) {
            clearTimeout(_coOccurrenceTimer);
            _coOccurrenceTimer = null;
            _createDetected = false;
            _completionDetected = false;
            _isPendingCreate = true;

            // Race-condition fix: if SPA already navigated to the new
            // conversation before co-occurrence completed, track immediately.
            const currentUuid = extractUuidFromUrl();
            if (currentUuid) {
                _trackedTemporaryUuid = currentUuid;
                saveTrackedUuid(currentUuid);
                _isPendingCreate = false;
            }
            return;
        }
        if (_coOccurrenceTimer === null) {
            _coOccurrenceTimer = setTimeout(() => {
                _createDetected = false;
                _completionDetected = false;
                _coOccurrenceTimer = null;
            }, 1000);
        }
    }

    // ── 刪除協調 ─────────────────────────────────────────────────────────────

    /**
     * 刪除已追蹤的臨時對話並清除追蹤狀態。
     * Guard clause：無追蹤 UUID 或無 token 時立即返回。
     * keepalive=true → 路由至 Service Worker（分頁關閉情境）。
     * keepalive=false → 在 content script 以重試機制執行（導航情境）。
     * @param {{ keepalive?: boolean }} [options]
     */
    function deleteTrackedAndClear({ keepalive = false } = {}) {
        if (!_trackedTemporaryUuid) return;
        if (!_capturedAuthToken) return;

        const uuidToDelete = _trackedTemporaryUuid;
        const tokenSnapshot = _capturedAuthToken;
        _trackedTemporaryUuid = null;
        saveTrackedUuid(null);

        if (keepalive) {
            // 分頁/瀏覽器關閉：透過 Service Worker 執行 keepalive fetch
            chrome.runtime.sendMessage({
                type: _getConst('DSS_SW_DELETE_MESSAGE_TYPE', 'DSS_DELETE_TEMP_CHAT'),
                chatUuid: uuidToDelete,
                authToken: tokenSnapshot,
            });
        } else {
            // 導航觸發：優先透過 MAIN world 的 React Fiber 刪除，失敗則 fallback 到 API 刪除
            const FIBER_REQ = _getConst('DSS_FIBER_DELETE_MESSAGE_TYPE', 'DSS_FIBER_DELETE_SESSION');
            const FIBER_RES = _getConst('DSS_FIBER_DELETE_RESULT_TYPE', 'DSS_FIBER_DELETE_RESULT');
            
            let fallbackTriggered = false;
            let timeoutId = null;

            const fallbackToApi = () => {
                if (fallbackTriggered) return;
                fallbackTriggered = true;
                window.removeEventListener('message', resultListener);
                if (timeoutId) clearTimeout(timeoutId);
                TemporaryChatDeleteApi.deleteChatSessionWithRetry(uuidToDelete, tokenSnapshot);
            };

            const resultListener = (e) => {
                if (e.source !== window) return;
                if (e.data?.type !== FIBER_RES) return;
                if (e.data?.sessionId !== uuidToDelete) return;

                if (e.data.success) {
                    if (timeoutId) clearTimeout(timeoutId);
                    window.removeEventListener('message', resultListener);
                } else {
                    fallbackToApi();
                }
            };

            window.addEventListener('message', resultListener);
            timeoutId = setTimeout(fallbackToApi, 3000);

            window.postMessage({
                type: FIBER_REQ,
                sessionId: uuidToDelete
            }, '*');
        }

        if (!readEnabledFlag()) {
            detachListeners();
        }
    }

    // ── 事件處理器 ───────────────────────────────────────────────────────────

    /**
     * 處理來自 MAIN world XHR hook 的授權 token 訊息（DSS_AUTH_CAPTURED）。
     * 無論切換狀態如何皆保存 token（離開時刪除可能在切換關閉後才發生）。
     * @param {MessageEvent} e
     */
    function handleAuthMessage(e) {
        if (e.source !== window) return;
        if (e.data?.type !== 'DSS_AUTH_CAPTURED') return;
        _capturedAuthToken = e.data.authorization || null;
    }

    /**
     * 處理來自 MAIN world 的新對話建立偵測訊息（DSS_CHAT_CREATE_DETECTED）。
     * 設定 _createDetected 並進入 co-occurrence 視窗檢查。
     * @param {MessageEvent} e
     */
    function handleCreateMessage(e) {
        if (e.source !== window) return;
        if (e.data?.type !== _getConst('DSS_CHAT_CREATE_MESSAGE_TYPE', 'DSS_CHAT_CREATE_DETECTED')) return;
        if (!readEnabledFlag()) return;
        _createDetected = true;
        checkCoOccurrence();
    }

    /**
     * 處理來自 MAIN world 的 completion API 偵測訊息（DSS_CHAT_COMPLETION_DETECTED）。
     * 設定 _completionDetected 並進入 co-occurrence 視窗檢查。
     * @param {MessageEvent} e
     */
    function handleCompletionMessage(e) {
        if (e.source !== window) return;
        if (e.data?.type !== _getConst('DSS_CHAT_COMPLETION_MESSAGE_TYPE', 'DSS_CHAT_COMPLETION_DETECTED')) return;
        if (!readEnabledFlag()) return;
        _completionDetected = true;
        checkCoOccurrence();
    }

    /**
     * 統一處理所有 postMessage（根據 type 路由至對應處理器）。
     * @param {MessageEvent} e
     */
    function handleWindowMessage(e) {
        handleAuthMessage(e);
        handleCreateMessage(e);
        handleCompletionMessage(e);
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
        const isRefresh = isReloadOrSameUrl || _isKeyboardRefresh;

        _suppressNextUnloadDelete = isRefresh;
        _isKeyboardRefresh = false;

        const fromUuid = extractUuidFromUrl();

        // 離開臨時對話：非刷新且有追蹤 UUID 且與當前頁面 UUID 吻合
        if (!isRefresh && fromUuid && fromUuid === _trackedTemporaryUuid && _capturedAuthToken) {
            deleteTrackedAndClear({ keepalive: false });
        }

        // 標記新建立的臨時對話：有待定旗標且目的地是對話頁面
        if (_isPendingCreate && readEnabledFlag()) {
            const destinationUuid = extractUuidFromUrl(new URL(destinationUrl).pathname);
            if (destinationUuid) {
                _trackedTemporaryUuid = destinationUuid;
                saveTrackedUuid(destinationUuid);
                _isPendingCreate = false;
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
            _isKeyboardRefresh = true;
        }
    }

    /**
     * beforeunload 處理器：涵蓋分頁關閉與 Navigation API 未處理的完整頁面導航。
     * keepalive=true 路由至 Service Worker 以確保關閉時請求仍能發出。
     */
    function handleBeforeUnload() {
        if (_suppressNextUnloadDelete) return;
        if (_isKeyboardRefresh) return;

        const currentUuid = extractUuidFromUrl();
        if (!currentUuid) return;
        if (currentUuid !== _trackedTemporaryUuid) return;
        if (!_capturedAuthToken) return;

        // keepalive: true → 透過 SW 發送，確保分頁關閉後請求仍送出
        deleteTrackedAndClear({ keepalive: true });
    }

    /**
     * 處理 dss-temporary-chat-changed CustomEvent，根據新狀態調整監聽器。
     * 切換關閉時：若仍有追蹤對話則保留監聽器以等待刪除機會；否則卸載。
     * @param {CustomEvent} e
     */
    function handleToggleChanged(e) {
        const isEnabled = e.detail?.isEnabled === true;
        _enabledFlagCache = isEnabled;          // 立即同步快取，確保後續 readEnabledFlag() 回傳正確值
        if (isEnabled) {
            attachListeners();
        } else {
            // 切換關閉：若有追蹤對話需保留監聽器（用於後續離開時刪除）
            if (!_trackedTemporaryUuid) {
                detachListeners();
            }
        }
    }

    // ── 監聽器生命週期 ───────────────────────────────────────────────────────

    /**
     * 掛載所有事件監聽器（冪等：已掛載時直接返回）。
     */
    function attachListeners() {
        if (_isListening) return;
        _isListening = true;

        window.addEventListener('message', handleWindowMessage);
        window.addEventListener('beforeunload', handleBeforeUnload);

        if (typeof window.navigation !== 'undefined') {
            window.navigation.addEventListener('navigate', handleNavigationEvent);
        }
        document.addEventListener('keydown', handleRefreshKeydown, true);
    }

    /**
     * 卸載所有事件監聽器（冪等：未掛載時直接返回）。
     */
    function detachListeners() {
        if (!_isListening) return;
        _isListening = false;

        window.removeEventListener('message', handleWindowMessage);
        window.removeEventListener('beforeunload', handleBeforeUnload);

        if (typeof window.navigation !== 'undefined') {
            window.navigation.removeEventListener('navigate', handleNavigationEvent);
        }
        document.removeEventListener('keydown', handleRefreshKeydown, true);
    }

    // ── 初始化 ───────────────────────────────────────────────────────────────

    /**
     * 初始化模組：從 chrome.storage.session 讀取啟用旗標，
     * 從 sessionStorage 恢復追蹤 UUID，並決定是否掛載監聽器。
     * @returns {Promise<void>}
     */
    async function init() {
        const CHANGED_EVENT = _getConst('DSS_TEMP_CHAT_CHANGED_EVENT', 'dss-temporary-chat-changed');
        window.addEventListener(CHANGED_EVENT, handleToggleChanged);

        await initEnabledFlagFromStorage();

        _trackedTemporaryUuid = loadTrackedUuid();

        if (_enabledFlagCache || _trackedTemporaryUuid) {
            attachListeners();
        }
    }

    return {
        init,
        // 供單元測試使用的函式與狀態存取器匯出
        extractUuidFromUrl,
        readEnabledFlag,
        initEnabledFlagFromStorage,
        loadTrackedUuid,
        saveTrackedUuid,
        handleAuthMessage,
        handleCreateMessage,
        handleCompletionMessage,
        handleWindowMessage,
        handleBeforeUnload,
        handleNavigationEvent,
        handleRefreshKeydown,
        handleToggleChanged,
        deleteTrackedAndClear,
        checkCoOccurrence,
        attachListeners,
        detachListeners,
        __getState: () => ({
            capturedAuthToken: _capturedAuthToken,
            trackedTemporaryUuid: _trackedTemporaryUuid,
            enabledFlagCache: _enabledFlagCache,
            createDetected: _createDetected,
            completionDetected: _completionDetected,
            isPendingCreate: _isPendingCreate,
            coOccurrenceTimer: _coOccurrenceTimer,
            suppressNextUnloadDelete: _suppressNextUnloadDelete,
            isKeyboardRefresh: _isKeyboardRefresh,
            isListening: _isListening,
        }),
        __setState: (s) => {
            if ('capturedAuthToken' in s) _capturedAuthToken = s.capturedAuthToken;
            if ('trackedTemporaryUuid' in s) _trackedTemporaryUuid = s.trackedTemporaryUuid;
            if ('enabledFlagCache' in s) _enabledFlagCache = s.enabledFlagCache;
            if ('createDetected' in s) _createDetected = s.createDetected;
            if ('completionDetected' in s) _completionDetected = s.completionDetected;
            if ('isPendingCreate' in s) _isPendingCreate = s.isPendingCreate;
            if ('coOccurrenceTimer' in s) _coOccurrenceTimer = s.coOccurrenceTimer;
            if ('suppressNextUnloadDelete' in s) _suppressNextUnloadDelete = s.suppressNextUnloadDelete;
            if ('isKeyboardRefresh' in s) _isKeyboardRefresh = s.isKeyboardRefresh;
            if ('isListening' in s) _isListening = s.isListening;
        },
        __resetState: () => {
            _capturedAuthToken = null;
            _trackedTemporaryUuid = null;
            _enabledFlagCache = false;
            _createDetected = false;
            _completionDetected = false;
            _isPendingCreate = false;
            _coOccurrenceTimer = null;
            _suppressNextUnloadDelete = false;
            _isKeyboardRefresh = false;
            _isListening = false;
        },
    };
})();

// Auto-start
TemporaryChatDelete.init();

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatDelete;
}
