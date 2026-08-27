/**
 * DS studio — Censor Reply Restore :: DOM Inject
 * 復原內容注入子系統。由 censor-reply-restore.dom.js 以 Object.assign 合入。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const selectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {
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
                // _hasStoredRecordsApplied 在成功後設為 true，避免每次 MutationObserver 觸發都重掃。
                if (!this._hasStoredRecordsApplied) {
                    const didRestore = this._tryRestoreFromStoredRecords();
                    if (didRestore) {
                        this._hasStoredRecordsApplied = true;
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

        /**
         * 建立復原內容容器（class / style / innerHTML 皆與原有 DOM 結構一致）。
         * @param {string} innerHtml
         * @returns {HTMLElement}
         */
        _createRestoredContainer(innerHtml) {
            const restoredEl = document.createElement('div');
            restoredEl.className = 'ds-markdown ds-assistant-message-main-content restored-content';
            restoredEl.setAttribute('style', '--ds-md-zoom: 1.143;');
            restoredEl.innerHTML = innerHtml;
            return restoredEl;
        },

        /**
         * 將 THINK 內容注入既有思考容器；若頁面尚無容器，改為在 restoredEl 前插入自建思考區塊。
         * @param {Element} msgEl
         * @param {string} thinkContent
         * @param {Object} record
         * @param {HTMLElement} restoredEl
         */
        _injectThinkContent(msgEl, thinkContent, record, restoredEl) {
            const thinkContainer = msgEl.querySelector(selectors.THINK_BLOCK_SELECTOR);
            if (!thinkContainer) {
                const thinkEl = this._buildThinkBlock({ content: thinkContent }, record.thinking_elapsed_secs);
                if (restoredEl.parentNode) {
                    restoredEl.parentNode.insertBefore(thinkEl, restoredEl);
                }
                return;
            }

            thinkContainer.classList.add('restored-content');
            const thinkContentEl = thinkContainer.querySelector(selectors.THINK_CONTENT_SELECTOR);
            if (!thinkContentEl) return;

            const thinkBody = thinkContentEl.querySelector(selectors.THINK_SEPARATOR_SELECTOR);
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
        },

        _injectRestoredContent(msgEl, record) {
            const fragments = record.fragments || [];
            if (fragments.length === 0) return;

            const extracted = this._extractRenderableFragments(fragments);
            const { hasThink, hasResponse, thinkContent, responseContent } = extracted;

            if (!hasThink && !hasResponse) return;

            const mainContent = msgEl.querySelector(selectors.ASSISTANT_MAIN_CONTENT_SELECTOR);
            if (!mainContent) return;

            // 隱藏原始被審查內容
            if (!mainContent.classList.contains('dss-censored-hidden')) {
                mainContent.classList.add('dss-censored-hidden');
            }

            // 有 RESPONSE 則渲染回覆內容；否則為思考階段即被屏蔽，僅顯示 think-only 徽章
            const innerHtml = hasResponse
                ? this._renderMarkdown(responseContent) + '<div class="restored-badge">' + dsI18n.t('restoredBadge') + '</div>'
                : '<div class="restored-badge">' + dsI18n.t('restoredBadgeThinkOnly') + '</div>';

            const restoredEl = this._createRestoredContainer(innerHtml);
            mainContent.parentNode.insertBefore(restoredEl, mainContent.nextSibling);

            if (hasThink) {
                this._injectThinkContent(msgEl, thinkContent, record, restoredEl);
            }
        },
    };

    root.__DS_CensorReplyRestore_dom_inject = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;

})(globalThis);
