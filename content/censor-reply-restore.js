/**
 * DS studio — Censor Reply Restore (Entry)
 * 攔截 XHR SSE 回應、偵測 DOM 審查，並將原始模型回覆重新注入頁面。
 *
 * 載入順序（manifest.json 中 bundle 必須先於 entry）：
 *   1. censor-reply-restore.markdown.js  → globalThis.__DS_CensorReplyRestore_markdown
 *   2. censor-reply-restore.dom.js       → globalThis.__DS_CensorReplyRestore_dom
 *   3. censor-reply-restore.storage.js   → globalThis.__DS_CensorReplyRestore_storage
 *   4. censor-reply-restore.js           （本檔，Object.assign 合入以上三個 bundle）
 */
const CensorReplyRestore = {
    RESTORED_MESSAGES_KEY: 'restored_messages',
    STORAGE_MAX_ENTRIES: 200,

    enabled: false,
    _observer: null,
    _xhrHooked: false,
    _pendingQueue: [],
    _keyToMessageId: new Map(),
    _restoredMessages: {},
    // 記錄儲存記錄是否已全域套用過一次（避免每次 MutationObserver 觸發都做完整掃描）
    _storedRecordsApplied: false,
    // 追蹤目前已知的 session ID，用於 SPA 切換聊天時清除過期執行期狀態
    _currentSessionId: null,

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
        var newSessionId = null;
        var urlMatch = window.location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
        if (urlMatch) newSessionId = urlMatch[1];

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
        const virtualItem = assistantMsgEl.closest('[data-virtual-list-item-key]');
        if (!virtualItem) return null;
        let prev = virtualItem.previousElementSibling;
        while (prev) {
            const msgEl = prev.querySelector('.ds-message');
            if (msgEl) {
                const userMsg = msgEl.querySelector('.fbb737a4');
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
        let buttons = toolbarGroupEl.querySelectorAll('.ds-icon-button');
        if (buttons.length === 0) {
            buttons = toolbarGroupEl.querySelectorAll('[role="button"].ds-button.ds-button--icon');
        }
        if (buttons.length < 5) return false;
        const isDisabled = (btn) =>
            // 舊版：同時需要 class 與 aria 屬性
            (btn.classList.contains('ds-icon-button--disabled') && btn.getAttribute('aria-disabled') === 'true') ||
            // 新版：僅需 ds-button--disabled class（部分停用按鈕不帶 aria-disabled 屬性）
            btn.classList.contains('ds-button--disabled');
        return isDisabled(buttons[1]) && isDisabled(buttons[4]);
    },

    _getToolbarGroup(messageEl) {
        // 工具欄是 messageEl 的兄弟元素 — 在虛擬列表項目容器中搜尋
        const container = messageEl.closest('[data-virtual-list-item-key]') || messageEl.parentElement;
        if (container) {
            const toolbar = container.querySelector('.ds-flex._965abe9');
            if (toolbar) return toolbar;

            // 後備方案：尋找容器中任何有 5 個以上 icon buttons 的 .ds-flex
            const allFlex = container.querySelectorAll('.ds-flex');
            for (let i = 0; i < allFlex.length; i++) {
                if (allFlex[i].querySelectorAll('.ds-icon-button, [role="button"].ds-button.ds-button--icon').length >= 5) return allFlex[i];
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
        var msgs = document.querySelectorAll('.ds-message._63c77b1');
        for (var mi = 0; mi < msgs.length; mi++) {
            this._tryRestoreMessage(msgs[mi]);
        }
    },

    // ────────────────────────────────────────────
    // Subsystem H: SSE event parser
    // ────────────────────────────────────────────

    /**
     * 解析單行 SSE data 事件，支援多種事件格式與 CONTENT_FILTER 檢測。
     * 處理順序（依優先級）：
     *   1. INITIAL RESPONSE — 初始化 state（messageId, fragments, started）
     *   2. BATCH — 遞迴解析子操作，攜帶父路徑
     *   3. SHORT FORMAT — 純字串值（無 p/o）追加到最後 fragment 內容
     *   4. APPEND string — 字串追加到最後 fragment 內容
     *   5. APPEND array — 新增 fragments
     *   6. SET / implicit SET — 路徑比對（CONTENT_FILTER、內容追加、elapsed_secs、FINISHED）
     *
     * @param {Object} state - 解析狀態（原地修改）
     * @param {string} line - SSE data 行 (e.g. 'data: {"o":"SET","p":"...","v":"..."}')
     * @param {string} [parentPath] - BATCH 遞迴用的父路徑
     */
    _parseSseEvent(state, line, parentPath) {
        if (!line || !line.startsWith('data: ')) return;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) return;

        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            return;
        }

        // ── 1. INITIAL RESPONSE EVENT ──
        // 格式：{"v":{"response":{"message_id":N, "fragments":[...]}}}
        if (parsed.v && typeof parsed.v === 'object' && parsed.v.response) {
            const resp = parsed.v.response;
            state.messageId = resp.message_id;
            state.thinkingEnabled = resp.thinking_enabled;
            state.started = true;
            if (Array.isArray(resp.fragments)) {
                state.fragments = resp.fragments
                    .filter(Boolean)
                    .map(function (f) { return Object.assign({}, f); });
            }
            return;
        }

        // ── 2. BATCH：將每個子操作重新包裝為 data 行後遞迴解析，並攜帶父路徑 ──
        if (parsed.o === 'BATCH' && Array.isArray(parsed.v)) {
            const batchParentP = parsed.p || parentPath || '';
            for (let i = 0; i < parsed.v.length; i++) {
                this._parseSseEvent(state, 'data: ' + JSON.stringify(parsed.v[i]), batchParentP);
            }
            return;
        }

        // ── 3. SHORT FORMAT：無路徑的純字串值，追加到最後一個 fragment 內容 ──
        // 格式：{"v":"..."}（無 p 也無 o）
        if (typeof parsed.v === 'string' && !parsed.o && !parsed.p) {
            const last = state.fragments[state.fragments.length - 1];
            if (last) {
                last.content = (last.content || '') + parsed.v;
            }
            return;
        }

        // ── 4. APPEND string：追加到最後一個 fragment 的內容 ──
        if (parsed.o === 'APPEND' && typeof parsed.v === 'string') {
            const last = state.fragments[state.fragments.length - 1];
            if (last) {
                last.content = (last.content || '') + parsed.v;
            }
            return;
        }

        // ── 5. APPEND array：新增 fragments ──
        if (parsed.o === 'APPEND' && Array.isArray(parsed.v)) {
            state.fragments.push.apply(state.fragments, parsed.v);
            return;
        }

        // ── 6. SET / implicit SET ──
        // 處理 SET 操作、隱含 SET（有 p 但無 o）、以及 /content 隱含追加
        if (parsed.o === 'SET' || (!parsed.o && parsed.p)) {
            // 拼接父路徑與子路徑，處理 BATCH 子操作中的相對路徑（如 "status" → "response/status"）
            const childPath = parsed.p || '';
            const path = (parentPath && childPath && !childPath.startsWith('/'))
                ? parentPath + '/' + childPath
                : childPath;

            // CONTENT_FILTER 檢測（既有邏輯）
            if ((path.endsWith('/status') || path.endsWith('/quasi_status')) && parsed.v === 'CONTENT_FILTER') {
                state.censored = true;
            }

            // /content 隱含追加：字串值追加到最後一個 fragment 的內容
            // 必須 return 防止 fall-through 到 FINISHED 檢查
            if (path.endsWith('/content') && typeof parsed.v === 'string') {
                const last = state.fragments[state.fragments.length - 1];
                if (last) {
                    last.content = (last.content || '') + parsed.v;
                }
                return;
            }

            // /elapsed_secs 追蹤（不回傳，允許繼續執行 FINISHED 檢查）
            if (path.endsWith('/elapsed_secs') && typeof parsed.v === 'number') {
                state.thinkingElapsedSecs = parsed.v;
            }

            // FINISHED / CONTENT_FILTER 最終狀態（既有邏輯）
            if (parsed.v === 'FINISHED' || parsed.v === 'CONTENT_FILTER') {
                state.finished = true;
            }
            return;
        }
    },

    // ────────────────────────────────────────────
    // Subsystem A: XHR hook (main-world injection)
    // ────────────────────────────────────────────

    _installXhrHook() {
        if (this._xhrHooked) return;
        this._xhrHooked = true;

        if (typeof document === 'undefined' || !document.documentElement) {
            return;
        }

        try {
            // Inject sse-parser.js first (dependency of censor-xhr-hook.js)
            var sseParserScript = document.createElement('script');
            sseParserScript.src = chrome.runtime.getURL('content/sse-parser.js');
            document.documentElement.appendChild(sseParserScript);
            sseParserScript.remove();

            var script = document.createElement('script');
            script.src = chrome.runtime.getURL('content/censor-xhr-hook.js');
            document.documentElement.appendChild(script);
            script.remove();

            // 注入 history navigation hook，補強 Navigation API 不穩定的 SPA 導航偵測
            var historyHookScript = document.createElement('script');
            historyHookScript.src = chrome.runtime.getURL('content/temporary-chat-history-hook.js');
            document.documentElement.appendChild(historyHookScript);
            historyHookScript.remove();

            var fiberScript = document.createElement('script');
            fiberScript.src = chrome.runtime.getURL('content/temporary-chat-fiber-delete.js');
            document.documentElement.appendChild(fiberScript);
            fiberScript.remove();
        } catch (e) {
            return;
        }

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
            ? node.querySelectorAll('.ds-message')
            : [];
        for (const msgEl of messages) {
            this._tryRestoreMessage(msgEl);
        }

        if (node.classList && node.classList.contains('ds-message')) {
            this._tryRestoreMessage(node);
            return;
        }

        // Node 既不是 .ds-message 也不包含任何 .ds-message — 檢查它是否被添加到一個
        // 已經有兄弟 .ds-message 的虛擬列表項目內（例如，工具欄在消息之後添加）
        if (node.closest && messages.length === 0) {
            const virtualItem = node.closest('[data-virtual-list-item-key]');
            if (virtualItem) {
                const siblingMsg = virtualItem.querySelector('.ds-message');
                if (siblingMsg) {
                    this._tryRestoreMessage(siblingMsg);
                }
            }
        }
    },

    applyToExisting() {
        const messages = document.querySelectorAll('.ds-message._63c77b1');
        messages.forEach((el) => this._tryRestoreMessage(el));
        this._tryRestoreFromStoredRecords();
    },

    // ────────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────────

    async clearAllRestoredMessages() {
        this._restoredMessages = {};
        this._keyToMessageId.clear();
        await StorageManager.saveRestoredMessages({});
    },

    enable() {
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        this._installXhrHook();
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
        root.__DS_CensorReplyRestore_storage || {});
})(typeof globalThis !== 'undefined' ? globalThis : window);

if (typeof document !== 'undefined' && document.documentElement) {
    CensorReplyRestore.start();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CensorReplyRestore;
}
