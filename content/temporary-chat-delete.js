/**
 * DS studio — Temporary Chat Delete
 * 單一職責：管理臨時對話的刪除邏輯。
 * 臨時對話的定義：切換開啟時，由新對話建立請求（/api/v0/chat_session/create）觸發標記的對話。
 * 歷史對話（直接導航至已存在對話）永遠不會被刪除。
 * 常數由 temporary-chat-constants.js 在前載入提供。
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

    // 偵測到 create 請求後設為 true，等待導航事件落地後標記具體 UUID
    let _isPendingCreate = false;

    // Navigation API navigate 事件中設定，阻止 beforeunload 重複刪除同一次離開
    let _suppressNextUnloadDelete = false;

    // 鍵盤補充刷新旗標（F5 / Ctrl+R / Cmd+R）
    let _isKeyboardRefresh = false;

    // 監聽器是否已掛載（避免重複 add/remove）
    let _isListening = false;

    // ── sessionStorage 工具 ──────────────────────────────────────────────────

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
     * 讀取 sessionStorage 啟用旗標；缺少或無法解析時預設 false。
     * @returns {boolean}
     */
    function readEnabledFlag() {
        try {
            const STORAGE_KEY = _getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled');
            return sessionStorage.getItem(STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    }

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

    // ── 刪除 API ─────────────────────────────────────────────────────────────

    /**
     * 呼叫 DeepSeek API 刪除指定聊天 session。
     * Guard clauses：無 token 或無 UUID 時立即返回。
     * @param {string} chatUuid
     * @param {{ keepalive?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async function deleteChatSession(chatUuid, { keepalive = false } = {}) {
        if (!_capturedAuthToken) return;
        if (!chatUuid) return;

        try {
            await fetch('https://chat.deepseek.com/api/v0/chat_session/delete', {
                method: 'POST',
                keepalive,
                headers: {
                    'authorization': _capturedAuthToken,
                    'content-type': 'application/json',
                    'x-app-version': '2.0.0',
                    'x-client-bundle-id': 'com.deepseek.chat',
                    'x-client-locale': 'zh_Hant',
                    'x-client-platform': 'web',
                    'x-client-timezone-offset': '28800',
                    'x-client-version': '2.0.0',
                },
                body: JSON.stringify({ chat_session_id: chatUuid }),
            });
        } catch {
            // 靜默忽略網路錯誤（keepalive 呼叫不保證回應可讀取）
        }
    }

    /**
     * 刪除已追蹤的臨時對話並清除追蹤狀態。
     * Guard clause：無追蹤 UUID 或無 token 時立即返回。
     * 刪除後重新評估是否需要保留監聽器。
     * @param {{ keepalive?: boolean }} [options]
     */
    function deleteTrackedAndClear({ keepalive = false } = {}) {
        if (!_trackedTemporaryUuid) return;
        if (!_capturedAuthToken) return;

        const uuidToDelete = _trackedTemporaryUuid;
        _trackedTemporaryUuid = null;
        saveTrackedUuid(null);

        deleteChatSession(uuidToDelete, { keepalive });

        // 刪除後：若切換已關閉且無追蹤對話，可卸載監聽器
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
     * 僅在切換開啟時設定待定旗標；標記動作延至 navigate 事件落地後執行。
     * @param {MessageEvent} e
     */
    function handleCreateMessage(e) {
        if (e.source !== window) return;
        if (e.data?.type !== _getConst('DSS_CHAT_CREATE_MESSAGE_TYPE', 'DSS_CHAT_CREATE_DETECTED')) return;
        if (!readEnabledFlag()) return;
        _isPendingCreate = true;
    }

    /**
     * 統一處理所有 postMessage（根據 type 路由至對應處理器）。
     * @param {MessageEvent} e
     */
    function handleWindowMessage(e) {
        handleAuthMessage(e);
        handleCreateMessage(e);
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
            deleteTrackedAndClear({ keepalive: true });
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
     * 僅在 _suppressNextUnloadDelete 為 false 時刪除追蹤中的臨時對話。
     */
    function handleBeforeUnload() {
        if (_suppressNextUnloadDelete) return;
        if (_isKeyboardRefresh) return;

        const currentUuid = extractUuidFromUrl();
        if (!currentUuid) return;
        if (currentUuid !== _trackedTemporaryUuid) return;
        if (!_capturedAuthToken) return;

        // deleteTrackedAndClear 內部會清除 _trackedTemporaryUuid，防止重複刪除
        deleteTrackedAndClear({ keepalive: true });
    }

    /**
     * 處理 dss-temporary-chat-changed CustomEvent，根據新狀態調整監聽器。
     * 切換關閉時：若仍有追蹤對話則保留監聽器以等待刪除機會；否則卸載。
     * @param {CustomEvent} e
     */
    function handleToggleChanged(e) {
        const isEnabled = e.detail?.isEnabled === true;
        if (isEnabled) {
            attachListeners();
        } else {
            // 切換關閉：若有追蹤對話需保留監聽器（用於後續離開時刪除）
            if (!_trackedTemporaryUuid) {
                detachListeners();
            }
            // 有追蹤對話時保持監聽器，待 handleNavigationEvent/handleBeforeUnload 完成刪除
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
     * 初始化模組：從 sessionStorage 讀取初始狀態，並決定是否掛載監聽器。
     * 監聽器啟動條件：切換開啟 OR 有未刪除的追蹤對話（跨刷新恢復）。
     */
    function init() {
        const CHANGED_EVENT = _getConst('DSS_TEMP_CHAT_CHANGED_EVENT', 'dss-temporary-chat-changed');
        window.addEventListener(CHANGED_EVENT, handleToggleChanged);

        // 從 sessionStorage 恢復跨刷新狀態
        _trackedTemporaryUuid = loadTrackedUuid();

        const isEnabled = readEnabledFlag();
        if (isEnabled || _trackedTemporaryUuid) {
            attachListeners();
        }
    }

    return {
        init,
        // 供單元測試使用的函式與狀態存取器匯出
        deleteChatSession,
        extractUuidFromUrl,
        readEnabledFlag,
        loadTrackedUuid,
        saveTrackedUuid,
        handleAuthMessage,
        handleCreateMessage,
        handleWindowMessage,
        handleBeforeUnload,
        handleNavigationEvent,
        handleRefreshKeydown,
        handleToggleChanged,
        deleteTrackedAndClear,
        attachListeners,
        detachListeners,
        __getState: () => ({
            capturedAuthToken: _capturedAuthToken,
            trackedTemporaryUuid: _trackedTemporaryUuid,
            isPendingCreate: _isPendingCreate,
            suppressNextUnloadDelete: _suppressNextUnloadDelete,
            isKeyboardRefresh: _isKeyboardRefresh,
            isListening: _isListening,
        }),
        __setState: (s) => {
            if ('capturedAuthToken' in s) _capturedAuthToken = s.capturedAuthToken;
            if ('trackedTemporaryUuid' in s) _trackedTemporaryUuid = s.trackedTemporaryUuid;
            if ('isPendingCreate' in s) _isPendingCreate = s.isPendingCreate;
            if ('suppressNextUnloadDelete' in s) _suppressNextUnloadDelete = s.suppressNextUnloadDelete;
            if ('isKeyboardRefresh' in s) _isKeyboardRefresh = s.isKeyboardRefresh;
            if ('isListening' in s) _isListening = s.isListening;
        },
        __resetState: () => {
            _capturedAuthToken = null;
            _trackedTemporaryUuid = null;
            _isPendingCreate = false;
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
