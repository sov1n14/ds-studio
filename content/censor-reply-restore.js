/**
 * DS studio — Censor Reply Restore
 * Intercepts XHR SSE responses, detects DOM-based censorship, and re-injects
 * the original model response into the page.
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
    // Subsystem F: Markdown → HTML renderer
    // ────────────────────────────────────────────

    _renderInline(text) {
        let result = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        result = result
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer"><span>$1</span></a>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong><span>$1</span></strong>')
            .replace(/\*([^*]+)\*/g, '<em><span>$1</span></em>');
        return result;
    },

    _renderMarkdown(text) {
        if (!text) return '';
        const lines = text.split('\n');
        const tokens = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('```')) {
                const lang = trimmed.slice(3).trim();
                const codeLines = [];
                i++;
                while (i < lines.length && !lines[i].trim().startsWith('```')) {
                    codeLines.push(lines[i]);
                    i++;
                }
                i++;
                const code = codeLines.join('\n');
                tokens.push({ type: 'code', lang, code });
                continue;
            }

            if (trimmed.startsWith('#')) {
                const level = trimmed.match(/^#{1,6}/)[0].length;
                const content = this._renderInline(trimmed.slice(level).trim());
                tokens.push({ type: 'heading', level, content });
                i++;
                continue;
            }

            if (/^-{3,}$/.test(trimmed)) {
                tokens.push({ type: 'hr' });
                i++;
                continue;
            }

            if (trimmed.startsWith('> ')) {
                const quoteLines = [];
                while (i < lines.length && lines[i].trim().startsWith('> ')) {
                    quoteLines.push(lines[i].trim().slice(2));
                    i++;
                }
                tokens.push({ type: 'blockquote', content: this._renderInline(quoteLines.join('\n')) });
                continue;
            }

            if (/^- /.test(trimmed) || /^\* /.test(trimmed)) {
                const items = [];
                while (i < lines.length && (/^- /.test(lines[i].trim()) || /^\* /.test(lines[i].trim()))) {
                    items.push(this._renderInline(lines[i].trim().slice(2).trim()));
                    i++;
                }
                tokens.push({ type: 'ul', items });
                continue;
            }

            if (/^\d+\.\s/.test(trimmed)) {
                const items = [];
                while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
                    items.push(this._renderInline(lines[i].trim().replace(/^\d+\.\s/, '')));
                    i++;
                }
                tokens.push({ type: 'ol', items });
                continue;
            }

            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                const rows = [];
                while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
                    rows.push(lines[i]);
                    i++;
                }
                tokens.push({ type: 'table', rows });
                continue;
            }

            if (trimmed === '') {
                i++;
                continue;
            }

            const paraLines = [];
            while (i < lines.length && lines[i].trim() !== '') {
                paraLines.push(lines[i].trim());
                i++;
            }
            tokens.push({ type: 'paragraph', content: this._renderInline(paraLines.join(' ')) });
        }

        return this._renderTokens(tokens);
    },

    _renderTokens(tokens) {
        let html = '';
        for (const t of tokens) {
            switch (t.type) {
                case 'paragraph':
                    html += `<p class="ds-markdown-paragraph"><span>${t.content}</span></p>\n`;
                    break;
                case 'heading':
                    html += `<h${t.level}><span>${t.content}</span></h${t.level}>\n`;
                    break;
                case 'hr':
                    html += '<hr>\n';
                    break;
                case 'blockquote':
                    html += `<blockquote><p class="ds-markdown-paragraph"><span>${t.content}</span></p></blockquote>\n`;
                    break;
                case 'ul':
                    html += '<ul>\n';
                    for (const item of t.items) {
                        html += `  <li><p><span>${item}</span></p></li>\n`;
                    }
                    html += '</ul>\n';
                    break;
                case 'ol':
                    html += '<ol start="1">\n';
                    for (const item of t.items) {
                        html += `  <li><p><span>${item}</span></p></li>\n`;
                    }
                    html += '</ol>\n';
                    break;
                case 'code':
                    html += '<div class="md-code-block md-code-block-dark">';
                    if (t.lang) {
                        html += `<div class="md-code-block-header"><span class="md-code-lang">${t.lang}</span></div>`;
                    }
                    html += `<pre><span>${this._escapeHtml(t.code)}</span></pre></div>\n`;
                    break;
                case 'table':
                    html += this._renderTable(t.rows);
                    break;
            }
        }
        return html;
    },

    _renderTable(rows) {
        if (rows.length < 2) return '';
        const headerCells = rows[0].split('|').filter(c => c.trim() !== '');
        const bodyRows = rows.slice(2);
        let html = '<div class="ds-scroll-area"><table><thead><tr>';
        for (const cell of headerCells) {
            html += `<th><span>${this._renderInline(cell.trim())}</span></th>`;
        }
        html += '</tr></thead><tbody>';
        for (const row of bodyRows) {
            const cells = row.split('|').filter(c => c.trim() !== '');
            html += '<tr>';
            for (const cell of cells) {
                html += `<td><span>${this._renderInline(cell.trim())}</span></td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>\n';
        return html;
    },

    _escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
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
    // Subsystem E: Message ID association & content injection
    // ────────────────────────────────────────────

    _getMessageIdFromElement(msgEl) {
        const virtualItem = msgEl.closest('[data-virtual-list-item-key]');
        if (virtualItem) {
            const key = virtualItem.getAttribute('data-virtual-list-item-key');
            if (this._keyToMessageId.has(key)) {
                const mid = this._keyToMessageId.get(key);
                // 同步清除 pendingQueue 中相同 messageId 的條目，避免後續 queue 後備誤配
                if (this._pendingQueue.length > 0) {
                    const midStr = String(mid);
                    const before = this._pendingQueue.length;
                    this._pendingQueue = this._pendingQueue.filter(function (q) { return String(q) !== midStr; });
                }
                return mid;
            }
        }

        // 嘗試用儲存記錄匹配：在 _pendingQueue 盲目取用前，先以 prompt_key 找到確定對應的 messageId
        const storedId = this._resolveMessageIdFromStorage(msgEl);
        if (storedId !== null) {
            // 解析路徑的 log 已在 _resolveMessageIdFromStorage 內輸出
            // 同步清除 pendingQueue 中相同 messageId 的條目，避免後續 queue 後備誤配
            if (this._pendingQueue.length > 0) {
                const storedIdStr = String(storedId);
                const before = this._pendingQueue.length;
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
        var currentSessionId = null;
        var urlMatch = window.location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/);
        if (urlMatch) currentSessionId = urlMatch[1];

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
        var virtualItem = msgEl.closest('[data-virtual-list-item-key]');
        if (virtualItem) {
            this._keyToMessageId.set(virtualItem.getAttribute('data-virtual-list-item-key'), chosen.message_id);
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

        const virtualItem = msgEl.closest('[data-virtual-list-item-key]');
        if (virtualItem) {
            this._keyToMessageId.set(virtualItem.getAttribute('data-virtual-list-item-key'), messageId);
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
            responseHtml += '<div class="restored-badge">⚠ 已復原內容（後續對話無法沿用）</div>';
            restoredEl.innerHTML = responseHtml;

            mainContent.parentNode.insertBefore(restoredEl, mainContent.nextSibling);

            if (hasThink) {
                // 有 THINK 且有 RESPONSE 內容
                const thinkContainer = msgEl.querySelector('._74c0879');
                if (thinkContainer) {
                    thinkContainer.classList.add('restored-content');
                    const thinkContentEl = thinkContainer.querySelector('.ds-think-content');
                    if (thinkContentEl) {
                        const thinkBody = thinkContentEl.querySelector('._9ecc93a');
                        if (thinkBody) {
                            thinkBody.innerHTML = '';
                        }
                        let markdownEl = thinkContentEl.querySelector('.ds-markdown');
                        if (!markdownEl) {
                            markdownEl = document.createElement('div');
                            markdownEl.className = 'ds-markdown';
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
            let responseHtml = '<div class="restored-badge">⚠ 已復原內容（模型在思考階段被屏蔽，僅恢復思考內容；後續對話無法沿用）</div>';
            restoredEl.innerHTML = responseHtml;

            mainContent.parentNode.insertBefore(restoredEl, mainContent.nextSibling);

            const thinkContainer = msgEl.querySelector('._74c0879');
            if (thinkContainer) {
                thinkContainer.classList.add('restored-content');
                const thinkContentEl = thinkContainer.querySelector('.ds-think-content');
                if (thinkContentEl) {
                    const thinkBody = thinkContentEl.querySelector('._9ecc93a');
                    if (thinkBody) {
                        thinkBody.innerHTML = '';
                    }
                    let markdownEl = thinkContentEl.querySelector('.ds-markdown');
                    if (!markdownEl) {
                        markdownEl = document.createElement('div');
                        markdownEl.className = 'ds-markdown';
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

    _buildThinkBlock(thinkFragment, elapsedSecs) {
        const container = document.createElement('div');
        container.className = '_74c0879';
        container.setAttribute('style',
            '--collapsible-area-title-height: 38px;' +
            '--group-title-sticky-base-top: 0px;' +
            '--group-title-sticky-top: calc(var(--group-title-sticky-base-top) - ' +
            'var(--ds-virtual-list-transform-y) + var(--ds-virtual-list-ios-compensation-y));'
        );

        const header = document.createElement('div');
        header.className = '_245c867 _34a54ec';
        header.style.cursor = 'pointer';
        header.addEventListener('click', function () {
            const isCollapsed = container.getAttribute('data-ht-collapsed') === '1';
            if (isCollapsed) {
                container.setAttribute('data-ht-collapsed', '0');
            } else {
                container.setAttribute('data-ht-collapsed', '1');
            }
            // 切換思考內容的顯示狀態
            const thinkContent = container.querySelector('.ds-think-content');
            if (thinkContent) {
                thinkContent.style.display = isCollapsed ? 'block' : 'none';
            }
            // 切換箭頭 SVG 路徑
            const arrowIcon = container.querySelector('._5ab5d64 > .ds-icon:not(._970ac5e) svg path');
            if (arrowIcon) {
                arrowIcon.setAttribute('d', isCollapsed
                    ? 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'
                    : 'M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z'
                );
            }
        });
        header.innerHTML = [
            '<div class="_5ab5d64">',
            '<div class="ds-icon _970ac5e" style="font-size: 16px; width: 16px; height: 16px;">',
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">',
            '<path d="M8.00192 6.64454C8.75026 6.64454 9.35732 7.25169 9.35739 8.00001C9.35739 8.74838 8.7503 9.35548 8.00192 9.35548C7.25367 9.35533 6.64743 8.74829 6.64743 8.00001C6.6475 7.25178 8.25371 6.64468 8.00192 6.64454Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M9.97165 1.29981C11.5853 0.718916 13.271 0.642197 14.3144 1.68555C15.3577 2.72902 15.2811 4.41466 14.7002 6.02833C14.4707 6.66561 14.1504 7.32937 13.75 8.00001C14.1504 8.67062 14.4707 9.33444 14.7002 9.97169C15.2811 11.5854 15.3578 13.271 14.3144 14.3145C13.271 15.3579 11.5854 15.2811 9.97165 14.7002C9.3344 14.4708 8.67059 14.1505 7.99997 13.75C7.32933 14.1505 6.66558 14.4708 6.02829 14.7002C4.41461 15.2811 2.72899 15.3578 1.68552 14.3145C0.642155 13.271 0.71887 11.5854 1.29977 9.97169C1.52915 9.33454 1.84865 8.67049 2.24899 8.00001C1.84866 7.32953 1.52915 6.66544 1.29977 6.02833C0.718852 4.41459 0.64207 2.729 1.68552 1.68555C2.72897 0.642112 4.41456 0.718887 6.02829 1.29981C6.66541 1.52918 7.32949 1.8487 7.99997 2.24903C8.67045 1.84869 9.33451 1.52919 9.97165 1.29981ZM12.9404 9.2129C12.4391 9.893 11.8616 10.5681 11.2148 11.2149C10.568 11.8616 9.89296 12.4391 9.21286 12.9404C9.62532 13.1579 10.0271 13.338 10.4121 13.4766C11.9146 14.0174 12.9172 13.8738 13.3955 13.3955C13.8737 12.9173 14.0174 11.9146 13.4765 10.4121C13.3379 10.0271 13.1578 9.62535 12.9404 9.2129ZM3.05856 9.2129C2.84121 9.62523 2.66197 10.0272 2.52341 10.4121C1.98252 11.9146 2.12627 12.9172 2.60446 13.3955C3.08278 13.8737 4.08544 14.0174 5.58786 13.4766C5.97264 13.338 6.37389 13.1577 6.7861 12.9404C6.10624 12.4393 5.43168 11.8614 4.78513 11.2149C4.13823 10.5679 3.55992 9.89313 3.05856 9.2129ZM7.99899 3.792C7.23179 4.31419 6.45306 4.95512 5.70407 5.70411C4.95509 6.45309 4.31415 7.23184 3.79196 7.99903C4.3143 8.76666 4.95471 9.54653 5.70407 10.2959C6.45309 11.0449 7.23271 11.6848 7.99997 12.207C8.76725 11.6848 9.54683 11.0449 10.2959 10.2959C11.0449 9.54686 11.6848 8.76729 12.207 8.00001C11.6848 7.23275 11.0449 6.45312 10.2959 5.70411C9.5465 4.95475 8.76662 4.31434 7.99899 3.792ZM5.58786 2.52344C4.08533 1.98255 3.08272 2.12625 2.60446 2.6045C2.12621 3.08275 1.98252 4.08536 2.52341 5.5879C2.66189 5.97253 2.8414 6.37409 3.05856 6.78614C3.55983 6.10611 4.1384 5.43189 4.78513 4.78516C5.43186 4.13843 6.10606 3.55987 6.7861 3.0586C6.37405 2.84144 5.97249 2.66192 5.58786 2.52344ZM13.3955 2.6045C12.9172 2.12631 11.9146 1.98257 10.4121 2.52344C10.0272 2.66201 9.62519 2.84125 9.21286 3.0586C9.8931 3.55996 10.5679 4.13827 11.2148 4.78516C11.8614 5.43172 12.4392 6.10627 12.9404 6.78614C13.1577 6.37393 13.338 5.97267 13.4765 5.5879C14.0174 4.08549 13.8736 3.08281 13.3955 2.6045Z" fill="currentColor"/>',
            '</svg></div>',
            '<span class="_5255ff8 _4d41763">' +
            '已思考（用時 ' + (elapsedSecs ? Math.round(elapsedSecs) : '') + ' 秒）' +
            '</span>',
            '<div class="ds-icon" style="font-size: 14px; width: 14px; height: 14px;">',
            '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">',
            '<path d="M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z" fill="currentColor"/>',
            '</svg></div>',
            '</div>',
            '<div class="c99b79f8" style="opacity: 0;"></div>'
        ].join('');
        container.appendChild(header);

        const spacer = document.createElement('div');
        spacer.className = 'c2b72bb8';
        container.appendChild(spacer);

        const thinkContent = document.createElement('div');
        thinkContent.className = 'e1675d8b ds-think-content _767406f';

        const loadingDots = document.createElement('div');
        loadingDots.className = 'ddd26891 _9b52f6c';
        loadingDots.setAttribute('style', 'width: 16px; height: 16px;');
        loadingDots.innerHTML = '<div class="a510c7ce _0652043"></div>';
        thinkContent.appendChild(loadingDots);

        const sep = document.createElement('div');
        sep.className = '_9ecc93a';
        thinkContent.appendChild(sep);

        const md = document.createElement('div');
        md.className = 'ds-markdown';
        md.setAttribute('style', '--ds-md-zoom: 1.143;');
        md.innerHTML = this._renderMarkdown(thinkFragment.content);
        thinkContent.appendChild(md);

        container.appendChild(thinkContent);
        // 為 HideThinking 相容性添加容器點擊處理器
        container.addEventListener('click', function (e) {
            if (e.target !== container) return;
            var isCollapsed = this.getAttribute('data-ht-collapsed') === '1';
            var tc = this.querySelector('.ds-think-content');
            if (tc) {
                tc.style.display = isCollapsed ? 'none' : 'block';
            }
        });

        const footer = document.createElement('div');
        footer.className = '_8f7678d';
        container.appendChild(footer);

        return container;
    },

    // ────────────────────────────────────────────
    // Subsystem G: Storage management
    // ────────────────────────────────────────────

    async _saveFragment(record) {
        // 以 session-scoped key 儲存，防止不同聊天的相同數字 message_id 互相覆蓋
        const sessionId = record.chat_session_id || null;
        const storeKey = this._recordKey(sessionId, record.message_id);
        this._restoredMessages[storeKey] = {
            message_id: record.message_id,
            fragments: record.fragments,
            restored_at: Date.now(),
            thinking_elapsed_secs: record.thinking_elapsed_secs || 0,
            censored: true,
            chat_session_id: sessionId,
            prompt_key: record.prompt_key || null
        };

        this._evictOldest();

        await StorageManager.saveRestoredMessages(this._restoredMessages);
    },

    _evictOldest() {
        const entries = Object.entries(this._restoredMessages);
        if (entries.length <= this.STORAGE_MAX_ENTRIES) return;

        entries.sort((a, b) => a[1].restored_at - b[1].restored_at);
        const toDelete = entries.length - this.STORAGE_MAX_ENTRIES;
        for (let i = 0; i < toDelete; i++) {
            delete this._restoredMessages[entries[i][0]];
        }
    },

    async _loadRestoredMessages() {
        try {
            const data = await StorageManager.getRestoredMessages();
            const raw = data[StorageManager.KEYS.RESTORED_MESSAGES] || {};

            // 清潔策略：移除沒有 censored === true 旗標的項目，同時遷移舊格式 key。
            // 舊格式：key 為純 message_id 數字字串（不含 '::'）
            // 新格式：key 為 "{sessionId}::{messageId}"
            const cleanedData = {};
            var didMigrate = false;
            for (const key in raw) {
                const record = raw[key];
                if (!record || record.censored !== true) continue;

                if (key.indexOf('::') === -1) {
                    // 舊版 key — 以記錄內嵌的 chat_session_id 重新編 key
                    const newKey = this._recordKey(record.chat_session_id, record.message_id);
                    cleanedData[newKey] = record;
                    didMigrate = true;
                } else {
                    cleanedData[key] = record;
                }
            }
            this._restoredMessages = cleanedData;

            // 若有清除或遷移，寫回儲存
            const rawCount = Object.keys(raw).length;
            const cleanedCount = Object.keys(cleanedData).length;
            if (didMigrate || cleanedCount !== rawCount) {
                await StorageManager.saveRestoredMessages(cleanedData);
            }
        } catch (e) {
            this._restoredMessages = {};
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
        var msgEls = document.querySelectorAll('.ds-message._63c77b1');
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
        var totalRecords = Object.keys(this._restoredMessages).length;
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
                var virtualItem = domList[i].closest('[data-virtual-list-item-key]');
                if (virtualItem) {
                    var key = virtualItem.getAttribute('data-virtual-list-item-key');
                    this._keyToMessageId.set(key, recList[i].message_id);
                }
                this._injectRestoredContent(domList[i], recList[i]);
                matchedAny = true;
            }
        }

        return matchedAny;
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

if (typeof document !== 'undefined' && document.documentElement) {
    CensorReplyRestore.start();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CensorReplyRestore;
}
