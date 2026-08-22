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
 *   6. censor-reply-restore.js             （本檔，Object.assign 合入以上四個 bundle）
 */
// Session id 擷取共用工具（瀏覽器：chat-session-id.js 在前載入；Node.js 測試：直接 require）
var __DS_CensorChatSessionId = (typeof globalThis !== 'undefined' ? globalThis : window).DSSChatSessionId ||
    (typeof require !== 'undefined' ? require('./chat-session-id.js') : {});

// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
var __DS_CensorSelectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

// key <-> messageId 雙向對應表（瀏覽器：censor-reply-restore.keymap.js 在前載入；Node.js 測試：直接 require）
var __DS_CensorKeyToMessageIdMap = (typeof globalThis !== 'undefined' ? globalThis : window).__DS_CensorKeyToMessageIdMap ||
    (typeof require !== 'undefined' ? require('./censor-reply-restore.keymap.js') : null);

const CensorReplyRestore = {
    STORAGE_MAX_ENTRIES: 200,

    enabled: false,
    _observer: null,
    _isFragmentListenerStarted: false,
    _pendingQueue: [],
    // 實際儲存體；外部一律透過下方存取子讀寫 _keyToMessageId。
    __keyToMessageIdStore: new __DS_CensorKeyToMessageIdMap(),
    // 整份重新指派（切換聊天、測試 fixture）時自動包成 KeyToMessageIdMap，確保反向索引永遠與當下這張表一致。
    get _keyToMessageId() {
        return this.__keyToMessageIdStore;
    },
    set _keyToMessageId(map) {
        this.__keyToMessageIdStore = map instanceof __DS_CensorKeyToMessageIdMap ? map : new __DS_CensorKeyToMessageIdMap(map);
    },
    _restoredMessages: {},
    // 記錄儲存記錄是否已全域套用過一次（避免每次 MutationObserver 觸發都做完整掃描）
    _storedRecordsApplied: false,
    // 追蹤目前已知的 session ID，用於 SPA 切換聊天時清除過期執行期狀態
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
    // 格式："{sessionId}::{messageId}"，sessionId 為 null 時用 'nosession' 代替。
    // 設計說明：messageId 在各函式中仍以原始值（數字/字串）傳遞作為 map/queue 的索引，
    // 只有在實際讀寫 _restoredMessages 時才透過此函式取得含 session 的複合 key，
    // 確保 live-XHR 路徑（push messageId → inject via _restoredMessages lookup）行為不變。
    _recordKey(sessionId, messageId) {
        return String(sessionId || 'nosession') + '::' + String(messageId);
    },

    // ── Session change detection ─────────────
    // 從 URL 擷取當前 session ID，若已切換聊天則清除過期執行期狀態。
    // 清除規則：
    //   - null → non-null：品牌新聊天剛取得 ID，不清除 queue（第一則訊息的 fragment 可能已在 queue 中）
    //   - non-null → different non-null：切換到另一個聊天，清除所有執行期狀態
    //   - non-null → null：離開聊天頁面（如聊天列表），清除所有執行期狀態
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
        this._storedRecordsApplied = false;
        this._currentSessionId = newSessionId;
    },

    _getPrecedingUserPromptKey(assistantMsgEl) {
        const virtualItem = assistantMsgEl.closest(__DS_CensorSelectors.VIRTUAL_ITEM_KEY_SELECTOR);
        if (!virtualItem) return null;
        let prev = virtualItem.previousElementSibling;
        while (prev) {
            const msgEl = prev.querySelector(__DS_CensorSelectors.MESSAGE_SELECTOR);
            if (msgEl) {
                const userMsg = msgEl.querySelector(__DS_CensorSelectors.USER_CONTENT_SELECTOR);
                if (userMsg) {
                    return this._normalizePrompt(msgEl.textContent);
                }
            }
            prev = prev.previousElementSibling;
        }
        return null;
    },

    // ────────────────────────────────────────────
    // Subsystem D: Censorship detection
    // ────────────────────────────────────────────

    _isCensored(toolbarGroupEl) {
        if (!toolbarGroupEl || !toolbarGroupEl.querySelectorAll) return false;
        // 舊設計系統：.ds-icon-button；新設計系統：.ds-button.ds-button--icon
        let buttons = toolbarGroupEl.querySelectorAll(__DS_CensorSelectors.ICON_BUTTON_SELECTOR);
        if (buttons.length === 0) {
            buttons = toolbarGroupEl.querySelectorAll(__DS_CensorSelectors.ICON_BUTTON_ROLE_SELECTOR);
        }
        if (buttons.length < 5) return false;
        const isDisabled = (btn) =>
            // 舊版：同時需要 class 與 aria 屬性
            (btn.classList.contains(__DS_CensorSelectors.ICON_BUTTON_DISABLED_CLASS) && btn.getAttribute('aria-disabled') === 'true') ||
            // 新版：僅需 ds-button--disabled class（部分停用按鈕不帶 aria-disabled 屬性）
            btn.classList.contains(__DS_CensorSelectors.BUTTON_DISABLED_CLASS);
        return isDisabled(buttons[1]) && isDisabled(buttons[4]);
    },

    _getToolbarGroup(messageEl) {
        // 工具欄是 messageEl 的兄弟元素 — 在虛擬列表項目容器中搜尋
        const container = messageEl.closest(__DS_CensorSelectors.VIRTUAL_ITEM_KEY_SELECTOR) || messageEl.parentElement;
        if (container) {
            const toolbar = container.querySelector(__DS_CensorSelectors.MESSAGE_TOOLBAR_SELECTOR);
            if (toolbar) return toolbar;

            // 後備方案：尋找容器中任何有 5 個以上 icon buttons 的 .ds-flex
            const allFlex = container.querySelectorAll(__DS_CensorSelectors.FLEX_ROW_SELECTOR);
            for (let i = 0; i < allFlex.length; i++) {
                if (allFlex[i].querySelectorAll(__DS_CensorSelectors.ICON_BUTTON_ANY_SELECTOR).length >= 5) return allFlex[i];
            }
        }

        return null;
    },

    // ────────────────────────────────────────────
    // Subsystem C: Fragment complete handler
    // ────────────────────────────────────────────

    _onFragmentComplete(data) {
        if (!this.enabled) {
            return;
        }
        // 偵測 SPA 聊天切換，確保 queue 與 map 不攜帶前一個聊天的過期狀態
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
        // 新的 live 訊息進入 — 重置掃描旗標，讓後續若有未復原舊訊息也能再次觸發完整掃描
        this._storedRecordsApplied = false;

        this._saveFragment({
            message_id: messageId,
            fragments: fragments,
            thinking_elapsed_secs: data.thinkingElapsedSecs || 0,
            chat_session_id: data.chatSessionId || null,
            prompt_key: this._normalizePrompt(data.promptText)
        });

        // MutationObserver 可能已經在 postMessage 傳遞之前就觸發了。
        // 現在 pendingQueue 中有了 messageId，再手動掃描一遍。
        var msgs = document.querySelectorAll(__DS_CensorSelectors.ASSISTANT_MESSAGE_SELECTOR);
        for (var mi = 0; mi < msgs.length; mi++) {
            this._tryRestoreMessage(msgs[mi]);
        }
    },

    // ────────────────────────────────────────────
    // Subsystem A: 接收 MAIN world 送回的片段
    // （MAIN world 腳本由 content/main-world-injector.js 於啟動時統一注入）
    // ────────────────────────────────────────────

    _startFragmentListener() {
        if (this._isFragmentListenerStarted) return;
        if (typeof window === 'undefined') return;
        this._isFragmentListenerStarted = true;

        window.addEventListener('message', (e) => {
            if (e.source !== window) return;
            if (e.data?.type !== 'DSS_FRAGMENT_COMPLETE') return;
            this._onFragmentComplete(e.data);
        });
    },

    // ────────────────────────────────────────────
    // MutationObserver
    // ────────────────────────────────────────────

    _startObserver() {
        if (this._observer) return;
        this._observer = new MutationObserver((mutations) => {
            if (!this.enabled) return;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this._scanNode(node);
                    }
                }
            }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
    },

    _stopObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    },

    _scanNode(node) {
        const messages = node.querySelectorAll
            ? node.querySelectorAll(__DS_CensorSelectors.MESSAGE_SELECTOR)
            : [];
        for (const msgEl of messages) {
            this._tryRestoreMessage(msgEl);
        }

        if (node.classList && node.classList.contains(__DS_CensorSelectors.MESSAGE_CLASS)) {
            this._tryRestoreMessage(node);
            return;
        }

        // Node 既不是 .ds-message 也不包含任何 .ds-message — 檢查它是否被添加到一個
        // 已經有兄弟 .ds-message 的虛擬列表項目內（例如，工具欄在消息之後添加）
        if (node.closest && messages.length === 0) {
            const virtualItem = node.closest(__DS_CensorSelectors.VIRTUAL_ITEM_KEY_SELECTOR);
            if (virtualItem) {
                const siblingMsg = virtualItem.querySelector(__DS_CensorSelectors.MESSAGE_SELECTOR);
                if (siblingMsg) {
                    this._tryRestoreMessage(siblingMsg);
                }
            }
        }
    },

    applyToExisting() {
        const messages = document.querySelectorAll(__DS_CensorSelectors.ASSISTANT_MESSAGE_SELECTOR);
        messages.forEach((el) => this._tryRestoreMessage(el));
        this._tryRestoreFromStoredRecords();
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

// ── 合入三個 bundle（必須在 auto-start 之前執行）──
(function (root) {
    Object.assign(CensorReplyRestore,
        root.__DS_CensorReplyRestore_markdown || {},
        root.__DS_CensorReplyRestore_dom || {},
        root.__DS_CensorReplyRestore_thinkblock || {},
        root.__DS_CensorReplyRestore_storage || {});
})(typeof globalThis !== 'undefined' ? globalThis : window);

if (typeof document !== 'undefined' && document.documentElement) {
    CensorReplyRestore.start();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CensorReplyRestore;
}
