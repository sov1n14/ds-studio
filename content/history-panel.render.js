/**
 * DS Studio — Full Conversation History Panel Render Bundle
 * DOM-only 渲染層：建立面板、依 thread 資料填充內容、搜尋 / 跳轉 / 開關生命週期。
 * 不存取 IndexedDB 或 chrome.storage；資料由呼叫端（entry 層）以
 * window.__DS_HistoryPanel_idb.loadActiveThread(sessionId) 取得後傳入 renderThread。
 */
(function (root) {
    'use strict';

    /**
     * i18n 輔助：優先透過專案運行時 i18n（utils/i18n.js 的 dsI18n.t()）取得翻譯字串，
     * 缺漏或尚未載入時回退繁體中文預設文字。
     * @param {string} key
     * @param {string} fallbackZhTW
     * @returns {string}
     */
    function t(key, fallbackZhTW) {
        const dsI18nRef = (typeof globalThis !== 'undefined' && globalThis.dsI18n) ||
            (typeof window !== 'undefined' && window.dsI18n);
        if (dsI18nRef && typeof dsI18nRef.t === 'function') {
            const msg = dsI18nRef.t(key);
            if (msg && msg !== key) return msg;
        }
        return fallbackZhTW;
    }

    /**
     * 依 role 回傳顯示標籤。
     * @param {string} role - 'USER' | 'ASSISTANT'
     * @returns {string}
     */
    function roleLabel(role) {
        if (role === 'USER') return t('historyPanelRoleUser', '你');
        return t('historyPanelRoleAssistant', 'AI 助理');
    }

    /**
     * 依 reason 回傳空狀態 / 錯誤狀態文字。
     * @param {string} reason
     * @returns {string}
     */
    function emptyStateText(reason) {
        if (reason === 'NO_RECORD') return t('historyPanelEmptyNoRecord', '找不到此對話的歷史紀錄。');
        if (reason === 'NO_MESSAGES') return t('historyPanelEmptyNoMessages', '此對話尚無任何訊息。');
        if (reason === 'DB_ERROR') return t('historyPanelEmptyDbError', '讀取歷史紀錄時發生錯誤，請稍後再試。');
        return t('historyPanelEmptyDbError', '讀取歷史紀錄時發生錯誤，請稍後再試。');
    }

    /**
     * 建立單一訊息列元素。
     * @param {Object} message - { messageId, parentId, role, insertedAt, fragments }
     * @returns {HTMLElement}
     */
    function createMessageRow(message) {
        const row = document.createElement('div');
        row.className = 'dss-history-msg ' + (message.role === 'USER' ? 'dss-history-msg--user' : 'dss-history-msg--assistant');
        row.dataset.messageId = message.messageId || '';

        const label = document.createElement('div');
        label.className = 'dss-history-msg__label';
        label.textContent = roleLabel(message.role);
        row.appendChild(label);

        const fragments = Array.isArray(message.fragments) ? message.fragments : [];
        const thinkFragments = fragments.filter((f) => f.type === 'THINK');
        const contentFragments = fragments.filter((f) => f.type !== 'THINK');

        if (thinkFragments.length > 0) {
            const details = document.createElement('details');
            details.className = 'dss-history-think';
            const summary = document.createElement('summary');
            summary.className = 'dss-history-think__summary';
            summary.textContent = t('historyPanelThinking', '思考過程');
            details.appendChild(summary);

            const thinkBody = document.createElement('div');
            thinkBody.className = 'dss-history-think__body';
            thinkBody.textContent = thinkFragments.map((f) => f.content || '').join('\n\n');
            details.appendChild(thinkBody);

            row.appendChild(details);
        }

        const body = document.createElement('div');
        body.className = 'dss-history-msg__body';
        body.textContent = contentFragments.map((f) => f.content || '').join('\n\n');
        row.appendChild(body);

        return row;
    }

    /**
     * 清除面板既有搜尋高亮與比對狀態。
     * @param {Object} state - panelEl._historyState
     */
    function resetSearchState(state) {
        state.query = '';
        state.matches = [];
        state.matchIndex = -1;
    }

    /**
     * 重新套用高亮：先移除所有既有 mark，再依 query 重新掃描每個訊息 body / think 區塊的文字節點。
     * 使用 textContent 重建搜尋來源，並以 createElement('mark') + createTextNode 手動組裝，
     * 避免任何 innerHTML 注入風險。
     * @param {HTMLElement} listEl - 訊息清單容器
     * @param {Object} state - panelEl._historyState
     */
    function applyHighlight(listEl, state) {
        const targets = listEl.querySelectorAll('.dss-history-msg__body, .dss-history-think__body');
        state.matches = [];

        targets.forEach((el) => {
            const rawText = el.dataset.rawText !== undefined ? el.dataset.rawText : el.textContent;
            el.dataset.rawText = rawText;

            if (!state.query) {
                el.textContent = rawText;
                return;
            }

            const lowerText = rawText.toLowerCase();
            const lowerQuery = state.query.toLowerCase();
            if (lowerQuery === '' || lowerText.indexOf(lowerQuery) === -1) {
                el.textContent = rawText;
                return;
            }

            el.textContent = '';
            let cursor = 0;
            let searchStart = 0;
            let foundIndex;
            while ((foundIndex = lowerText.indexOf(lowerQuery, searchStart)) !== -1) {
                if (foundIndex > cursor) {
                    el.appendChild(document.createTextNode(rawText.slice(cursor, foundIndex)));
                }
                const mark = document.createElement('mark');
                mark.className = 'dss-history-highlight';
                mark.textContent = rawText.slice(foundIndex, foundIndex + state.query.length);
                el.appendChild(mark);
                state.matches.push(mark);
                cursor = foundIndex + state.query.length;
                searchStart = cursor;
            }
            if (cursor < rawText.length) {
                el.appendChild(document.createTextNode(rawText.slice(cursor)));
            }
        });

        state.matchIndex = state.matches.length > 0 ? 0 : -1;
    }

    /**
     * 更新搜尋比對計數文字並捲動至目前比對項目。
     * @param {HTMLElement} panelEl
     */
    function updateMatchUi(panelEl) {
        const state = panelEl._historyState;
        const counterEl = panelEl.querySelector('.dss-history-match-counter');
        const total = state.matches.length;

        state.matches.forEach((mark, idx) => {
            mark.classList.toggle('dss-history-highlight--current', idx === state.matchIndex);
        });

        if (counterEl) {
            counterEl.textContent = total === 0 ? '0 / 0' : (state.matchIndex + 1) + ' / ' + total;
        }

        if (state.matchIndex >= 0 && state.matches[state.matchIndex]) {
            state.matches[state.matchIndex].scrollIntoView({ block: 'center' });
        }
    }

    /**
     * 執行搜尋（每次輸入時重新掃描）。
     * @param {HTMLElement} panelEl
     * @param {string} query
     */
    function runSearch(panelEl, query) {
        const state = panelEl._historyState;
        state.query = query || '';
        const listEl = panelEl.querySelector('.dss-history-list');
        applyHighlight(listEl, state);
        updateMatchUi(panelEl);
    }

    /**
     * 移動至上一個 / 下一個比對項目。
     * @param {HTMLElement} panelEl
     * @param {number} delta - +1 或 -1
     */
    function stepMatch(panelEl, delta) {
        const state = panelEl._historyState;
        if (state.matches.length === 0) return;
        state.matchIndex = (state.matchIndex + delta + state.matches.length) % state.matches.length;
        updateMatchUi(panelEl);
    }

    /**
     * 建立面板 DOM（不附加到 document，由呼叫端決定掛載時機）。
     * @param {Object} options
     * @param {Function} options.onExport - Export 按鈕點擊回呼
     * @param {Function} options.onClose - Close 按鈕 / 背景點擊 / Esc 回呼
     * @returns {HTMLElement} 面板根節點（overlay）
     */
    function createPanel({ onExport, onClose } = {}) {
        const overlay = document.createElement('div');
        overlay.className = 'dss-history-overlay';
        overlay.style.display = 'none';

        const card = document.createElement('div');
        card.className = 'dss-history-panel';

        // ── Header ──
        const header = document.createElement('div');
        header.className = 'dss-history-header';

        const titleEl = document.createElement('div');
        titleEl.className = 'dss-history-title';
        titleEl.textContent = t('historyPanelTitle', '完整對話紀錄');
        header.appendChild(titleEl);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'dss-history-close-btn';
        closeBtn.textContent = t('historyPanelClose', '關閉');
        closeBtn.addEventListener('click', () => {
            close(overlay);
            if (typeof onClose === 'function') onClose();
        });
        header.appendChild(closeBtn);

        card.appendChild(header);

        // ── Toolbar ──
        const toolbar = document.createElement('div');
        toolbar.className = 'dss-history-toolbar';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'dss-history-search-input';
        searchInput.placeholder = t('historyPanelSearchPlaceholder', '搜尋對話內容…');
        searchInput.addEventListener('input', () => runSearch(overlay, searchInput.value));
        toolbar.appendChild(searchInput);

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'dss-history-search-btn dss-history-search-btn--prev';
        prevBtn.textContent = '‹';
        prevBtn.addEventListener('click', () => stepMatch(overlay, -1));
        toolbar.appendChild(prevBtn);

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'dss-history-search-btn dss-history-search-btn--next';
        nextBtn.textContent = '›';
        nextBtn.addEventListener('click', () => stepMatch(overlay, 1));
        toolbar.appendChild(nextBtn);

        const counterEl = document.createElement('span');
        counterEl.className = 'dss-history-match-counter';
        counterEl.textContent = '0 / 0';
        toolbar.appendChild(counterEl);

        const jumpOldestBtn = document.createElement('button');
        jumpOldestBtn.type = 'button';
        jumpOldestBtn.className = 'dss-history-jump-btn';
        jumpOldestBtn.textContent = t('historyPanelJumpOldest', '跳到最舊');
        jumpOldestBtn.addEventListener('click', () => {
            const listEl = overlay.querySelector('.dss-history-list');
            if (listEl && listEl.firstElementChild) listEl.firstElementChild.scrollIntoView({ block: 'start' });
        });
        toolbar.appendChild(jumpOldestBtn);

        const jumpNewestBtn = document.createElement('button');
        jumpNewestBtn.type = 'button';
        jumpNewestBtn.className = 'dss-history-jump-btn';
        jumpNewestBtn.textContent = t('historyPanelJumpNewest', '跳到最新');
        jumpNewestBtn.addEventListener('click', () => {
            const listEl = overlay.querySelector('.dss-history-list');
            if (listEl && listEl.lastElementChild) listEl.lastElementChild.scrollIntoView({ block: 'end' });
        });
        toolbar.appendChild(jumpNewestBtn);

        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'dss-history-export-btn';
        exportBtn.textContent = t('historyPanelExport', '匯出');
        exportBtn.addEventListener('click', () => {
            if (typeof onExport === 'function') onExport();
        });
        toolbar.appendChild(exportBtn);

        card.appendChild(toolbar);

        // ── Message list ──
        const listEl = document.createElement('div');
        listEl.className = 'dss-history-list';
        card.appendChild(listEl);

        overlay.appendChild(card);

        // 背景點擊關閉（僅點擊 overlay 本身，不含卡片內部）
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close(overlay);
                if (typeof onClose === 'function') onClose();
            }
        });

        // 內部狀態：搜尋比對 + Esc 監聽器參照
        overlay._historyState = {
            query: '',
            matches: [],
            matchIndex: -1,
            escHandler: null,
        };

        return overlay;
    }

    /**
     * 清空並依 threadResult 重新填充訊息清單。
     * @param {HTMLElement} panelEl - createPanel 回傳的根節點
     * @param {Object} threadResult - loadActiveThread 回傳值
     */
    function renderThread(panelEl, threadResult) {
        if (!panelEl) return;

        const listEl = panelEl.querySelector('.dss-history-list');
        const titleEl = panelEl.querySelector('.dss-history-title');
        if (!listEl) return;

        listEl.textContent = '';
        resetSearchState(panelEl._historyState);
        const counterEl = panelEl.querySelector('.dss-history-match-counter');
        if (counterEl) counterEl.textContent = '0 / 0';

        if (!threadResult || !threadResult.ok) {
            if (titleEl) titleEl.textContent = t('historyPanelTitle', '完整對話紀錄');
            const emptyEl = document.createElement('div');
            emptyEl.className = 'dss-history-empty';
            emptyEl.textContent = emptyStateText(threadResult && threadResult.reason);
            listEl.appendChild(emptyEl);
            return;
        }

        if (titleEl) titleEl.textContent = threadResult.title || t('historyPanelTitle', '完整對話紀錄');

        const messages = Array.isArray(threadResult.messages) ? threadResult.messages : [];
        messages.forEach((message) => {
            listEl.appendChild(createMessageRow(message));
        });
    }

    /**
     * 顯示面板並啟用 Esc 關閉監聽。
     * @param {HTMLElement} panelEl
     */
    function open(panelEl) {
        if (!panelEl) return;
        panelEl.style.display = '';

        const state = panelEl._historyState;
        if (state && !state.escHandler) {
            state.escHandler = (e) => {
                if (e.key === 'Escape') {
                    close(panelEl);
                }
            };
            document.addEventListener('keydown', state.escHandler);
        }
    }

    /**
     * 隱藏面板並移除 Esc 關閉監聽。
     * @param {HTMLElement} panelEl
     */
    function close(panelEl) {
        if (!panelEl) return;
        panelEl.style.display = 'none';

        const state = panelEl._historyState;
        if (state && state.escHandler) {
            document.removeEventListener('keydown', state.escHandler);
            state.escHandler = null;
        }
    }

    const api = { createPanel, renderThread, open, close };

    // 瀏覽器 classic script 環境：掛至全域命名空間
    root.__DS_HistoryPanel_render = api;

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
