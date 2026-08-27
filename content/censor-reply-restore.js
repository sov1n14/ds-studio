/**
 * DS studio — Censor Reply Restore (Entry)
 * 攔截 XHR SSE 回應、偵測 DOM 審查，並將原始模型回覆重新注入頁面。
 *
 * 載入順序（manifest.json 中 bundle 必須先於 entry）：
 *   1. censor-reply-restore.keymap.js      → globalThis.__DS_CensorKeyToMessageIdMap
 *   2. censor-reply-restore.markdown.js    → globalThis.__DS_CensorReplyRestore_markdown
 *   3. censor-reply-restore.dom.js         → globalThis.__DS_CensorReplyRestore_dom
 *   4. censor-reply-restore.thinkblock.js  → globalThis.__DS_CensorReplyRestore_thinkblock
 *   5. censor-reply-restore.storage.js     → globalThis.__DS_CensorReplyRestore_storage
 *   6. censor-reply-restore.detection.js   → globalThis.__DS_CensorReplyRestore_detection
 *   7. censor-reply-restore.observer.js    → globalThis.__DS_CensorReplyRestore_observer
 *   8. censor-reply-restore.js             （本檔，Object.assign 合入以上六個 bundle）
 */
// Session id 擷取共用工具（瀏覽器：chat-session-id.js 在前載入；Node.js 測試：直接 require）
var __DS_CensorChatSessionId = (globalThis).DSSChatSessionId ||
    (typeof require !== 'undefined' ? require('../utils/chat-session-id.js') : {});

// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
var __DS_CensorSelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

// key <-> messageId 雙向對應表（瀏覽器：censor-reply-restore.keymap.js 在前載入；Node.js 測試：直接 require）
var __DS_CensorKeyToMessageIdMap = (globalThis).__DS_CensorKeyToMessageIdMap ||
    (typeof require !== 'undefined' ? require('./censor-reply-restore.keymap.js') : null);

const CensorReplyRestore = {
    STORAGE_MAX_ENTRIES: 200,

    enabled: false,
    _observer: null,
    _isFragmentListenerStarted: false,
    _pendingQueue: [],
    // 實際儲存體；外部一律透過下方存取子讀寫 _keyToMessageId。
    __keyToMessageIdStore: new __DS_CensorKeyToMessageIdMap(),
    // 整份重新指派（切換聊天、測試 fixture）時自動包成 KeyToMessageIdMap
    get _keyToMessageId() {
        return this.__keyToMessageIdStore;
    },
    set _keyToMessageId(map) {
        this.__keyToMessageIdStore = map instanceof __DS_CensorKeyToMessageIdMap ? map : new __DS_CensorKeyToMessageIdMap(map);
    },
    _restoredMessages: {},
    // 記錄儲存記錄是否已全域套用過一次
    _hasStoredRecordsApplied: false,
    // 追蹤目前已知的 session ID
    _currentSessionId: null,

    /**
     * 反查目前對應到該 messageId 的 virtual-list-item key。純查詢函式，不修改任何狀態。
     * @param {string|number} messageId
     * @returns {string|null}
     */
    _findKeyForMessageId(messageId) {
        if (messageId === null || messageId === undefined) return null;
        return this._keyToMessageId.findKey(messageId);
    },

    // ── Normalize ───────────────────────────

    _normalizePrompt(text) {
        if (typeof text !== 'string' || !text) return '';
        return text.trim().replace(/\s+/g, ' ');
    },

    // ── Session-scoped record key ────────────
    _recordKey(sessionId, messageId) {
        return String(sessionId || 'nosession') + '::' + String(messageId);
    },

    // ── Session change detection ─────────────
    _checkSessionChange() {
        var newSessionId = __DS_CensorChatSessionId.extractChatSessionId();

        if (newSessionId === this._currentSessionId) return;

        // null → non-null：只更新 _currentSessionId，不清除 queue
        if (!this._currentSessionId && newSessionId) {
            this._currentSessionId = newSessionId;
            return;
        }

        // non-null → different non-null 或 non-null → null：清除所有執行期狀態
        this._keyToMessageId.clear();
        this._pendingQueue = [];
        this._hasStoredRecordsApplied = false;
        this._currentSessionId = newSessionId;
    },

    // ────────────────────────────────────────────
    // Subsystem C: Fragment complete handler
    // ────────────────────────────────────────────

    _onFragmentComplete(data) {
        if (!this.enabled) {
            return;
        }
        // 偵測 SPA 聊天切換
        this._checkSessionChange();

        const messageId = data.messageId;
        const fragments = data.fragments;
        if (!messageId || !fragments) {
            return;
        }

        // 防禦：僅當訊息被屏蔽時才儲存和入隊
        if (data.censored !== true) {
            return;
        }

        this._pendingQueue.push(messageId);
        // 新的 live 訊息進入 — 重置掃描旗標
        this._hasStoredRecordsApplied = false;

        this._saveFragment({
            message_id: messageId,
            fragments: fragments,
            thinking_elapsed_secs: data.thinkingElapsedSecs || 0,
            chat_session_id: data.chatSessionId || null,
            prompt_key: this._normalizePrompt(data.promptText)
        });

        // MutationObserver 可能已在 postMessage 之前觸發，手動掃描一遍
        var msgs = document.querySelectorAll(__DS_CensorSelectors.ASSISTANT_MESSAGE_SELECTOR);
        for (var mi = 0; mi < msgs.length; mi++) {
            this._tryRestoreMessage(msgs[mi]);
        }
    },

    // ────────────────────────────────────────────
    // Subsystem A: 接收 MAIN world 送回的片段
    // ────────────────────────────────────────────

    _startFragmentListener() {
        if (this._isFragmentListenerStarted) return;
        if (typeof window === 'undefined') return;
        this._isFragmentListenerStarted = true;

        window.addEventListener('message', (e) => {
            if (e.source !== window) return;
            if (e.data?.type !== globalThis.DSS_FRAGMENT_COMPLETE_TYPE) return;
            this._onFragmentComplete(e.data);
        });
    },

    // ────────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────────

    async clearAllRestoredMessages() {
        this._restoredMessages = {};
        this._keyToMessageId.clear();
        await StorageManager.clearRestoredMessages();
    },

    enable() {
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        this._startFragmentListener();
        this.applyToExisting();
        this._startObserver();
    },

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this._stopObserver();
    },

    async start() {
        await this._loadRestoredMessages();
        this.enable();

        // 註冊來自 popup 的訊息監聽器
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'clearRestoredMessages') {
                this.clearAllRestoredMessages();
                sendResponse({ success: true });
            }
        });
    }
};

// ── 合入所有 bundle（必須在 auto-start 之前執行）──
(function (root) {
    Object.assign(CensorReplyRestore,
        root.__DS_CensorReplyRestore_markdown || {},
        root.__DS_CensorReplyRestore_dom || {},
        root.__DS_CensorReplyRestore_thinkblock || {},
        root.__DS_CensorReplyRestore_storage || {},
        root.__DS_CensorReplyRestore_detection || {},
        root.__DS_CensorReplyRestore_observer || {});
})(globalThis);

if (typeof document !== 'undefined' && document.documentElement) {
    CensorReplyRestore.start();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CensorReplyRestore;
}
