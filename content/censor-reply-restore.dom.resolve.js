/**
 * DS studio — Censor Reply Restore :: DOM Resolve
 * messageId 解析輔助函式。由 censor-reply-restore.dom.js 以 Object.assign 合入。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const selectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {
        _getMessageIdFromElement(msgEl) {
            const virtualItem = msgEl.closest(selectors.VIRTUAL_ITEM_KEY_SELECTOR);
            if (virtualItem) {
                const key = virtualItem.getAttribute(selectors.VIRTUAL_ITEM_KEY_ATTR);
                if (this._keyToMessageId.has(key)) {
                    const mid = this._keyToMessageId.get(key);
                    // 同步清除 pendingQueue 中相同 messageId 的條目，避免後續 queue 後備誤配
                    if (this._pendingQueue.length > 0) {
                        const midStr = String(mid);
                        this._pendingQueue = this._pendingQueue.filter(function (q) { return String(q) !== midStr; });
                    }
                    return mid;
                }
            }

            // 嘗試用儲存記錄匹配：在 _pendingQueue 盲目取用前，先以 prompt_key 找到確定對應的 messageId
            const storedId = this._resolveMessageIdFromStorage(msgEl);
            if (storedId !== null) {
                // 同步清除 pendingQueue 中相同 messageId 的條目，避免後續 queue 後備誤配
                if (this._pendingQueue.length > 0) {
                    const storedIdStr = String(storedId);
                    this._pendingQueue = this._pendingQueue.filter(function (q) { return String(q) !== storedIdStr; });
                }
                return storedId;
            }

            // 後備：僅當訊息的 prompt_key 未命中任何儲存記錄時才使用 pendingQueue
            // 這樣可以避免將 live XHR 的 messageId 誤植到舊的未復原訊息上
            if (this._pendingQueue.length > 0) {
                const candidateId = this._pendingQueue[0];

                // 驗證 queue 候選與 DOM 元素的 prompt_key 是否相符，防止跨訊息誤配
                const elementPromptKey = this._getPrecedingUserPromptKey(msgEl);
                if (elementPromptKey) {
                    // 元素有可讀取的 prompt_key — 與候選記錄比對
                    const candidateRecord = this._restoredMessages[this._recordKey(this._currentSessionId, candidateId)];
                    if (candidateRecord && candidateRecord.prompt_key) {
                        if (candidateRecord.prompt_key !== elementPromptKey) {
                            // prompt 不符 — 拒絕消費 queue，等候自己的 fragment 抵達
                            return null;
                        }
                    }
                    // 候選記錄不存在（尚未儲存）或 prompt_key 相符 — 允許消費
                }
                // 元素無法取得 prompt_key（DOM 變體最後手段）— 維持原有行為

                const mid = this._pendingQueue.shift();
                return mid;
            }

            return null;
        },

        /**
         * 以 prompt_key + session_id 從儲存記錄中解析單一 DOM 元素的 messageId。
         * 若找到唯一比對，同時寫入 _keyToMessageId 以供後續快速查詢。
         * 純查詢函式：不修改 _pendingQueue、不觸發 inject。
         * @param {Element} msgEl
         * @returns {string|number|null}
         */
        _resolveMessageIdFromStorage(msgEl) {
            // 取得當前 session ID；明確要求非 falsy，避免 null !== null 意外通過
            // 純查詢：直接讀取已由 _checkSessionChange() 維護的 _currentSessionId，不重新解析 URL
            var currentSessionId = this._currentSessionId;

            // 明確規則：任一端 session ID 為 falsy → 禁止比對
            if (!currentSessionId) return null;

            // 取得此 DOM 元素對應的 prompt_key
            var promptKey = this._getPrecedingUserPromptKey(msgEl);
            if (!promptKey) return null;

            // 找出該 session + prompt_key 下所有未使用過的儲存記錄
            // 遍歷時使用 session-scoped key 格式驗證記錄所屬 session
            var candidates = [];
            for (var storeKey in this._restoredMessages) {
                var rec = this._restoredMessages[storeKey];
                if (rec.censored !== true) continue;
                // 明確規則：記錄的 session ID 為 falsy → 禁止比對
                if (!rec.chat_session_id) continue;
                if (rec.chat_session_id !== currentSessionId) continue;
                if (rec.prompt_key !== promptKey) continue;
                // 若此 messageId 已有對應的 virtualItem key，視為已使用
                if (this._findKeyForMessageId(rec.message_id) !== null) continue;
                candidates.push(rec);
            }

            if (candidates.length === 0) return null;

            // 依 message_id 遞增取第一筆（與 _tryRestoreFromStoredRecords 的排序策略一致）
            candidates.sort(function (a, b) {
                return String(a.message_id).localeCompare(String(b.message_id));
            });

            var chosen = candidates[0];
            // 將對應關係寫入 _keyToMessageId 以供後續快速查詢
            var virtualItem = msgEl.closest(selectors.VIRTUAL_ITEM_KEY_SELECTOR);
            if (virtualItem) {
                this._keyToMessageId.set(virtualItem.getAttribute(selectors.VIRTUAL_ITEM_KEY_ATTR), chosen.message_id);
            }
            return chosen.message_id;
        },
    };

    root.__DS_CensorReplyRestore_dom_resolve = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(globalThis);
