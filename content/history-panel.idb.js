/**
 * DS studio — History Panel IndexedDB Data Layer
 * 讀取 DeepSeek 頁面自身的 IndexedDB（deepseek-chat / history-message），
 * 將樹狀訊息結構重建為當前分支的時間序陣列，供渲染/匯出層使用。
 *
 * 僅使用 window.indexedDB，不使用任何 chrome.* API，不碰觸 DOM。
 */
(function (root) {
    'use strict';

    const DB_NAME = 'deepseek-chat';
    const STORE_NAME = 'history-message';
    // 樹狀結構中代表「無父節點」的 parent_id 值
    const ROOT_PARENT_IDS = ['0', 'null', 'undefined'];

    /**
     * Parse the fragments field (JSON string or already-array) into a clean array.
     * @param {string|Array|null|undefined} rawFragments
     * @returns {Array<{type: string, content: string}>}
     */
    function parseFragments(rawFragments) {
        if (!rawFragments) return [];

        if (Array.isArray(rawFragments)) {
            return rawFragments.map((fragment) => ({
                type: fragment && fragment.type,
                content: fragment && fragment.content,
            }));
        }

        if (typeof rawFragments !== 'string') return [];

        try {
            const parsed = JSON.parse(rawFragments);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((fragment) => ({
                type: fragment && fragment.type,
                content: fragment && fragment.content,
            }));
        } catch (error) {
            return [];
        }
    }

    /**
     * @param {string|null|undefined} parentId
     * @returns {boolean} True when parentId marks the root of the tree.
     */
    function isRootParentId(parentId) {
        if (parentId === null || parentId === undefined) return true;
        return ROOT_PARENT_IDS.includes(String(parentId));
    }

    /**
     * Fallback sort: oldest → newest by numeric inserted_at.
     * 僅在 currentMessageId 於訊息集合中找不到對應節點時使用，
     * 屬於降級策略，回傳結果順序可能與實際分支不完全一致。
     * @param {Array} messages
     * @returns {Array}
     */
    function sortByInsertedAtAscending(messages) {
        return [...messages].sort((a, b) => Number(a.inserted_at) - Number(b.inserted_at));
    }

    /**
     * Reconstruct the active branch (oldest → newest) by walking parent_id
     * links upward from currentMessageId.
     * @param {Array} messages - Raw chat_messages array (tree, unordered).
     * @param {string|number|null|undefined} currentMessageId
     * @returns {Array} Oldest → newest raw message objects.
     */
    function buildActiveThread(messages, currentMessageId) {
        if (!messages || messages.length === 0) return [];

        const messagesById = new Map();
        for (const message of messages) {
            messagesById.set(String(message.message_id), message);
        }

        const hasCurrentMessage = currentMessageId !== null &&
            currentMessageId !== undefined &&
            messagesById.has(String(currentMessageId));

        // 降級：找不到 currentMessageId 對應節點時，回傳全部訊息並依時間排序
        if (!hasCurrentMessage) {
            return sortByInsertedAtAscending(messages);
        }

        const thread = [];
        const visitedIds = new Set();
        let cursorId = String(currentMessageId);

        while (cursorId && messagesById.has(cursorId) && !visitedIds.has(cursorId)) {
            visitedIds.add(cursorId);
            const message = messagesById.get(cursorId);
            thread.push(message);

            if (isRootParentId(message.parent_id)) break;
            cursorId = String(message.parent_id);
        }

        return thread.reverse();
    }

    /**
     * Build the active thread and map each raw message into a clean shape.
     * @param {Array} rawMessages
     * @param {string|number|null|undefined} currentMessageId
     * @returns {Array<{messageId: string, parentId: string|null, role: string, insertedAt: number, fragments: Array}>}
     */
    function normalizeThread(rawMessages, currentMessageId) {
        if (!rawMessages || rawMessages.length === 0) return [];

        const activeThread = buildActiveThread(rawMessages, currentMessageId);

        return activeThread.map((message) => ({
            messageId: String(message.message_id),
            parentId: isRootParentId(message.parent_id) ? null : String(message.parent_id),
            role: message.role,
            insertedAt: Number(message.inserted_at),
            fragments: parseFragments(message.fragments),
        }));
    }

    /**
     * Open the deepseek-chat database.
     * @returns {Promise<IDBDatabase>}
     */
    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(DB_NAME);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get a single record from the history-message store by key.
     * @param {IDBDatabase} db
     * @param {string} sessionId
     * @returns {Promise<Object|undefined>}
     */
    function getRecord(db, sessionId) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(sessionId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Load the active conversation thread for a given session from IndexedDB.
     * @param {string} sessionId
     * @returns {Promise<{ok: true, sessionId: string, title: string, currentMessageId: string, messages: Array}|{ok: false, reason: string}>}
     */
    async function loadActiveThread(sessionId) {
        if (!sessionId) return { ok: false, reason: 'NO_SESSION_ID' };

        let db = null;
        try {
            db = await openDatabase();
            const record = await getRecord(db, sessionId);

            if (!record) return { ok: false, reason: 'NO_RECORD' };

            const chatSession = record.data && record.data.chat_session;
            const chatMessages = record.data && record.data.chat_messages;

            if (!chatMessages || chatMessages.length === 0) {
                return { ok: false, reason: 'NO_MESSAGES' };
            }

            const currentMessageId = chatSession && chatSession.current_message_id;
            const messages = normalizeThread(chatMessages, currentMessageId);

            return {
                ok: true,
                sessionId,
                title: chatSession && chatSession.title,
                currentMessageId: currentMessageId !== undefined && currentMessageId !== null
                    ? String(currentMessageId)
                    : null,
                messages,
            };
        } catch (error) {
            return { ok: false, reason: 'DB_ERROR' };
        } finally {
            if (db) db.close();
        }
    }

    const api = {
        parseFragments,
        buildActiveThread,
        normalizeThread,
        loadActiveThread,
    };

    root.__DS_HistoryPanel_idb = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
