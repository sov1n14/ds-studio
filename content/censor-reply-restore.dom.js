/**
 * DS studio — Censor Reply Restore :: DOM Bundle
 * DOM 注入、fragment 萃取、messageId 解析等子系統。由 censor-reply-restore.js 以 Object.assign 合入。
 */
(function (root) {
    'use strict';

    // Session id 擷取共用工具（瀏覽器：chat-session-id.js 在前載入；Node.js 測試：直接 require）
    const chatSessionId = root.DSSChatSessionId ||
        (typeof require !== 'undefined' ? require('./chat-session-id.js') : {});

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const selectors = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {

        // ────────────────────────────────────────────
        // Subsystem E: Fragment extraction helper
        // ────────────────────────────────────────────

        _extractRenderableFragments(fragments) {
            const thinkParts = [];
            let responseContent = '';
            let hasResponse = false;
            for (const f of fragments) {
                if (!f || !f.type) continue;
                if (f.type === 'THINK') {
                    if (typeof f.content === 'string' && f.content) thinkParts.push(f.content);
                } else if (f.type === 'RESPONSE') {
                    if (typeof f.content === 'string') {
                        responseContent += f.content;
                        hasResponse = true;
                    }
                }
            }
            return {
                thinkContent: thinkParts.join('\n\n'),
                hasThink: thinkParts.length > 0,
                responseContent,
                hasResponse,
            };
        },

        // ────────────────────────────────────────────
        // Subsystem E: Message ID association helpers
        // ────────────────────────────────────────────

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
            // 此處獨立於 _currentSessionId 自行讀取 URL：本函式為純查詢，不得呼叫會清除執行期狀態的 _checkSessionChange()
            var currentSessionId = chatSessionId.extractChatSessionId();

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
                var alreadyMapped = false;
                this._keyToMessageId.forEach(function (v) {
                    if (String(v) === String(rec.message_id)) alreadyMapped = true;
                });
                if (!alreadyMapped) candidates.push(rec);
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

        _tryRestoreMessage(msgEl) {
            // 每次進入前偵測 SPA 聊天切換，清除過期執行期狀態
            this._checkSessionChange();

            const toolbarGroup = this._getToolbarGroup(msgEl);
            if (!toolbarGroup) {
                return;
            }
            if (!this._isCensored(toolbarGroup)) {
                return;
            }

            if (msgEl.querySelector('.restored-content')) {
                return;
            }

            let messageId = this._getMessageIdFromElement(msgEl);
            if (!messageId) {
                // _getMessageIdFromElement 已嘗試 _resolveMessageIdFromStorage；
                // 若仍無結果且儲存掃描尚未成功套用過，觸發一次完整掃描（DOM 已渲染後的後備路徑）。
                // _storedRecordsApplied 在成功後設為 true，避免每次 MutationObserver 觸發都重掃。
                if (!this._storedRecordsApplied) {
                    const didRestore = this._tryRestoreFromStoredRecords();
                    if (didRestore) {
                        this._storedRecordsApplied = true;
                        // 完整掃描已直接注入內容，本次呼叫無需繼續
                        return;
                    }
                }
                return;
            }

            // 以 session-scoped key 查找記錄，避免跨聊天的 message_id 數字碰撞
            var lookupKey = this._recordKey(this._currentSessionId, messageId);
            const record = this._restoredMessages[lookupKey];
            if (!record) {
                return;
            }

            const virtualItem = msgEl.closest(selectors.VIRTUAL_ITEM_KEY_SELECTOR);
            if (virtualItem) {
                this._keyToMessageId.set(virtualItem.getAttribute(selectors.VIRTUAL_ITEM_KEY_ATTR), messageId);
            }

            this._injectRestoredContent(msgEl, record);
        },

        // ────────────────────────────────────────────
        // Subsystem E: Content injection
        // ────────────────────────────────────────────

        _injectRestoredContent(msgEl, record) {
            const fragments = record.fragments || [];
            if (fragments.length === 0) return;

            const extracted = this._extractRenderableFragments(fragments);
            const { hasThink, hasResponse, thinkContent, responseContent } = extracted;

            if (!hasThink && !hasResponse) return;

            const mainContent = msgEl.querySelector('.ds-assistant-message-main-content');
            if (!mainContent) return;

            // Hide original censored content
            if (!mainContent.classList.contains('dss-censored-hidden')) {
                mainContent.classList.add('dss-censored-hidden');
            }

            if (hasResponse) {
                // 正常情況：有 RESPONSE 內容
                const restoredEl = document.createElement('div');
                restoredEl.className = 'ds-markdown ds-assistant-message-main-content restored-content';
                restoredEl.setAttribute('style', '--ds-md-zoom: 1.143;');
                let responseHtml = this._renderMarkdown(responseContent);
                responseHtml += '<div class="restored-badge">' + dsI18n.t('restoredBadge') + '</div>';
                restoredEl.innerHTML = responseHtml;

                mainContent.parentNode.insertBefore(restoredEl, mainContent.nextSibling);

                if (hasThink) {
                    // 有 THINK 且有 RESPONSE 內容
                    const thinkContainer = msgEl.querySelector('._74c0879');
                    if (thinkContainer) {
                        thinkContainer.classList.add('restored-content');
                        const thinkContentEl = thinkContainer.querySelector(selectors.THINK_CONTENT_SELECTOR);
                        if (thinkContentEl) {
                            const thinkBody = thinkContentEl.querySelector('._9ecc93a');
                            if (thinkBody) {
                                thinkBody.innerHTML = '';
                            }
                            let markdownEl = thinkContentEl.querySelector(selectors.MARKDOWN_SELECTOR);
                            if (!markdownEl) {
                                markdownEl = document.createElement('div');
                                markdownEl.className = selectors.MARKDOWN_CLASS;
                                if (thinkBody) {
                                    thinkBody.after(markdownEl);
                                } else {
                                    thinkContentEl.appendChild(markdownEl);
                                }
                            }
                            markdownEl.innerHTML = this._renderMarkdown(thinkContent);
                            markdownEl.setAttribute('style', '--ds-md-zoom: 1.143;');
                        }
                    } else {
                        const thinkEl = this._buildThinkBlock({ content: thinkContent }, record.thinking_elapsed_secs);
                        if (restoredEl.parentNode) {
                            restoredEl.parentNode.insertBefore(thinkEl, restoredEl);
                        }
                    }
                }
            } else {
                // 情況 A：無 RESPONSE，只有 THINK（模型在思考階段被屏蔽）
                const restoredEl = document.createElement('div');
                restoredEl.className = 'ds-markdown ds-assistant-message-main-content restored-content';
                restoredEl.setAttribute('style', '--ds-md-zoom: 1.143;');
                let responseHtml = '<div class="restored-badge">' + dsI18n.t('restoredBadgeThinkOnly') + '</div>';
                restoredEl.innerHTML = responseHtml;

                mainContent.parentNode.insertBefore(restoredEl, mainContent.nextSibling);

                const thinkContainer = msgEl.querySelector('._74c0879');
                if (thinkContainer) {
                    thinkContainer.classList.add('restored-content');
                    const thinkContentEl = thinkContainer.querySelector(selectors.THINK_CONTENT_SELECTOR);
                    if (thinkContentEl) {
                        const thinkBody = thinkContentEl.querySelector('._9ecc93a');
                        if (thinkBody) {
                            thinkBody.innerHTML = '';
                        }
                        let markdownEl = thinkContentEl.querySelector(selectors.MARKDOWN_SELECTOR);
                        if (!markdownEl) {
                            markdownEl = document.createElement('div');
                            markdownEl.className = selectors.MARKDOWN_CLASS;
                            if (thinkBody) {
                                thinkBody.after(markdownEl);
                            } else {
                                thinkContentEl.appendChild(markdownEl);
                            }
                        }
                        markdownEl.innerHTML = this._renderMarkdown(thinkContent);
                        markdownEl.setAttribute('style', '--ds-md-zoom: 1.143;');
                    }
                } else {
                    const thinkEl = this._buildThinkBlock({ content: thinkContent }, record.thinking_elapsed_secs);
                    if (restoredEl.parentNode) {
                        restoredEl.parentNode.insertBefore(thinkEl, restoredEl);
                    }
                }
            }
        },

        // ────────────────────────────────────────────
        // Subsystem E: Stored-records restore scan
        // ────────────────────────────────────────────

        _tryRestoreFromStoredRecords() {
            // 進入時先偵測聊天切換
            this._checkSessionChange();

            // 1. 從 URL 解析當前 session ID；明確要求非 falsy，避免跨 session 誤配
            var currentSessionId = this._currentSessionId;

            // 明確規則：session ID 為 falsy → 禁止任何 storage 比對
            if (!currentSessionId) {
                return false;
            }

            // 2. 收集 DOM 中尚未復原且被審查的 assistant 訊息（按 DOM 順序）
            var msgEls = document.querySelectorAll(selectors.ASSISTANT_MESSAGE_SELECTOR);
            var unrestoredEls = [];
            for (var i = 0; i < msgEls.length; i++) {
                var el = msgEls[i];
                if (el.querySelector('.restored-content')) continue;
                var toolbar = this._getToolbarGroup(el);
                if (!toolbar || !this._isCensored(toolbar)) continue;
                unrestoredEls.push(el);
            }
            if (unrestoredEls.length === 0) {
                return false;
            }

            // 3. 建立 DOM 的 prompt_key 分組對應表
            var domByPrompt = {};
            for (var i = 0; i < unrestoredEls.length; i++) {
                var key = this._getPrecedingUserPromptKey(unrestoredEls[i]);
                if (!key) continue;
                if (!domByPrompt[key]) domByPrompt[key] = [];
                domByPrompt[key].push(unrestoredEls[i]);
            }
            if (Object.keys(domByPrompt).length === 0) {
                return false;
            }

            // 4. 過濾 records 至當前 session + censored
            // 遍歷 session-scoped key 格式的記錄，明確排除 falsy session ID 的記錄
            var sessionRecords = [];
            for (var storeKey in this._restoredMessages) {
                var rec = this._restoredMessages[storeKey];
                if (rec.censored !== true) continue;
                // 明確規則：記錄的 session ID 為 falsy → 禁止比對
                if (!rec.chat_session_id) continue;
                if (rec.chat_session_id !== currentSessionId) continue;
                if (!rec.prompt_key) continue;  // 無錨點的舊版記錄跳過
                sessionRecords.push(rec);
            }

            if (sessionRecords.length === 0) {
                return false;
            }

            // 5. 將 records 依 prompt_key 分組
            var recordsByPrompt = {};
            for (var i = 0; i < sessionRecords.length; i++) {
                var rec = sessionRecords[i];
                var key = rec.prompt_key;
                if (!recordsByPrompt[key]) recordsByPrompt[key] = [];
                recordsByPrompt[key].push(rec);
            }

            // 6. 對兩邊都存在的 prompt_key：將 records 依 message_id 排序後逐對匹配
            var matchedAny = false;
            for (var promptKey in domByPrompt) {
                if (!recordsByPrompt[promptKey]) {
                    continue;
                }
                var domList = domByPrompt[promptKey];
                var recList = recordsByPrompt[promptKey];
                // 以 message_id 遞增排序（重複 prompt 的平局處理）
                recList.sort(function (a, b) { return String(a.message_id).localeCompare(String(b.message_id)); });
                var pairs = Math.min(domList.length, recList.length);
                for (var i = 0; i < pairs; i++) {
                    var virtualItem = domList[i].closest(selectors.VIRTUAL_ITEM_KEY_SELECTOR);
                    if (virtualItem) {
                        var key = virtualItem.getAttribute(selectors.VIRTUAL_ITEM_KEY_ATTR);
                        this._keyToMessageId.set(key, recList[i].message_id);
                    }
                    this._injectRestoredContent(domList[i], recList[i]);
                    matchedAny = true;
                }
            }

            return matchedAny;
        },
    };

    root.__DS_CensorReplyRestore_dom = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
