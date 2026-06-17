/**
 * DS studio — Temporary Chat Delete
 * 單一職責：管理臨時對話的刪除邏輯。
 * 功能僅在 dss-temporary-chat-enabled 旗標為 'true' 時啟動。
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
    let _isPageRefresh = false;
    let _isEnabled = false;

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

    // ── 事件處理器 ───────────────────────────────────────────────────────────

    /**
     * 處理來自 MAIN world XHR hook 的授權 token 訊息。
     * 僅在功能啟用時儲存 token。
     * @param {MessageEvent} e
     */
    function handleAuthMessage(e) {
        if (!_isEnabled) return;
        if (e.source !== window) return;
        if (e.data?.type !== 'DSS_AUTH_CAPTURED') return;
        _capturedAuthToken = e.data.authorization || null;
    }

    /**
     * 處理 Navigation API navigate 事件，偵測瀏覽器重新整理。
     * @param {NavigateEvent} event
     */
    function handleNavigationEvent(event) {
        _isPageRefresh = (event.navigationType === 'reload');
    }

    /**
     * 鍵盤事件補充偵測（F5 / Ctrl+R / Cmd+R），與 Navigation API 並行。
     * @param {KeyboardEvent} e
     */
    function handleRefreshKeydown(e) {
        if (e.key === 'F5' ||
            (e.ctrlKey && e.key.toLowerCase() === 'r') ||
            (e.metaKey && e.key.toLowerCase() === 'r')) {
            _isPageRefresh = true;
        }
    }

    /**
     * beforeunload 處理器：功能啟用且非重新整理時，刪除當前對話。
     */
    function handleBeforeUnload() {
        if (!_isEnabled) return;
        if (_isPageRefresh) return;

        const chatUuid = extractUuidFromUrl();
        if (!chatUuid) return;
        if (!_capturedAuthToken) return;

        deleteChatSession(chatUuid, { keepalive: true });
    }

    /**
     * 處理 dss-chat-left CustomEvent（使用者離開對話，SPA 導航）。
     * @param {CustomEvent} e
     */
    function handleChatLeft(e) {
        if (!_isEnabled) return;
        const chatUuid = e.detail?.chatUuid;
        if (!chatUuid) return;
        deleteChatSession(chatUuid);
    }

    /**
     * 處理 dss-temporary-chat-changed CustomEvent，根據新狀態啟用或停用功能。
     * @param {CustomEvent} e
     */
    function handleToggleChanged(e) {
        const isEnabled = e.detail?.isEnabled === true;
        if (isEnabled) {
            enable();
        } else {
            disable();
        }
    }

    // ── 生命週期 ─────────────────────────────────────────────────────────────

    /**
     * 啟用刪除功能：重置刷新旗標並登錄所有事件監聽器。
     */
    function enable() {
        if (_isEnabled) return;
        _isEnabled = true;
        _isPageRefresh = false;

        window.addEventListener('message', handleAuthMessage);
        window.addEventListener('beforeunload', handleBeforeUnload);

        const CHAT_LEFT_EVENT = _getConst('DSS_CHAT_LEFT_EVENT', 'dss-chat-left');
        window.addEventListener(CHAT_LEFT_EVENT, handleChatLeft);

        if (typeof window.navigation !== 'undefined') {
            window.navigation.addEventListener('navigate', handleNavigationEvent);
        }
        document.addEventListener('keydown', handleRefreshKeydown, true);
    }

    /**
     * 停用刪除功能：移除所有事件監聽器並清空 token。
     */
    function disable() {
        if (!_isEnabled) return;
        _isEnabled = false;
        _capturedAuthToken = null;
        _isPageRefresh = false;

        window.removeEventListener('message', handleAuthMessage);
        window.removeEventListener('beforeunload', handleBeforeUnload);

        const CHAT_LEFT_EVENT = _getConst('DSS_CHAT_LEFT_EVENT', 'dss-chat-left');
        window.removeEventListener(CHAT_LEFT_EVENT, handleChatLeft);

        if (typeof window.navigation !== 'undefined') {
            window.navigation.removeEventListener('navigate', handleNavigationEvent);
        }
        document.removeEventListener('keydown', handleRefreshKeydown, true);
    }

    /**
     * 初始化模組：從 sessionStorage 讀取初始狀態，並監聽切換事件。
     */
    function init() {
        const CHANGED_EVENT = _getConst('DSS_TEMP_CHAT_CHANGED_EVENT', 'dss-temporary-chat-changed');
        window.addEventListener(CHANGED_EVENT, handleToggleChanged);

        // 依 sessionStorage 初始狀態決定是否立即啟用
        if (readEnabledFlag()) {
            enable();
        }
    }

    return {
        init,
        // 供單元測試使用的函式與狀態存取器匯出
        deleteChatSession,
        extractUuidFromUrl,
        readEnabledFlag,
        handleAuthMessage,
        handleBeforeUnload,
        handleChatLeft,
        handleToggleChanged,
        handleRefreshKeydown,
        enable,
        disable,
        __getState: () => ({
            capturedAuthToken: _capturedAuthToken,
            isPageRefresh: _isPageRefresh,
            isEnabled: _isEnabled,
        }),
        __setState: (s) => {
            if ('capturedAuthToken' in s) _capturedAuthToken = s.capturedAuthToken;
            if ('isPageRefresh' in s) _isPageRefresh = s.isPageRefresh;
            if ('isEnabled' in s) _isEnabled = s.isEnabled;
        },
        __resetState: () => {
            _capturedAuthToken = null;
            _isPageRefresh = false;
            _isEnabled = false;
        },
    };
})();

// Auto-start
TemporaryChatDelete.init();

// Test export（瀏覽器中為 no-op）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemporaryChatDelete;
}
