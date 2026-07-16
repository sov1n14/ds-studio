/**
 * DS studio — Full Conversation History Panel (Entry)
 * 將「開啟完整對話歷史」按鈕注入 go-top 按鈕旁的同一個包裝容器，
 * 沿用 GoToTop 的 DOM 定位與注入策略（見 go-top.js 檔頭說明）。
 *
 * 架構決策：
 *   - 本檔僅負責生命週期（注入 / 移除按鈕、開關監聽、SPA 路由重置），
 *     不重新實作 IndexedDB 讀取、面板渲染、Markdown 匯出邏輯。
 *   - 按鈕注入：clone window.DSstudio.GoToTop 已注入的原生按鈕節點，
 *     繼承其 ds-* 樣式；以 dss-history-open 作為唯一標記 class。
 *   - MutationObserver 監控 body，偵測 React re-render 後重新注入按鈕
 *     （沿用 go-top.js 的包裝容器 observer 概念）。
 *
 * 載入順序（manifest.json content_scripts）：
 *   1. utils/storage-manager*.js  → StorageManager
 *   2. utils/i18n.js              → dsI18n
 *   3. content/go-top*.js         → window.DSstudio.GoToTop（提供按鈕定位/樣式基礎）
 *   4. content/history-panel.idb.js     → window.__DS_HistoryPanel_idb
 *   5. content/history-panel.render.js  → window.__DS_HistoryPanel_render
 *   6. content/history-panel.export.js  → window.__DS_HistoryPanel_export
 *   7. content/history-panel.js         → 本檔（Object.assign 之後呼叫 init()）
 */
const HistoryPanel = {
    // === 常數 ===
    OPEN_BTN_CLASS: 'dss-history-open',
    OBSERVER_DEBOUNCE: 80,
    STACK_GAP_PX: 8,
    SESSION_PATH_REGEX: /\/a\/chat\/s\/([a-f0-9-]+)/,

    // === 狀態 ===
    enabled: false,
    _masterEnabled: false,
    _button: null,
    _panelEl: null,
    _currentThread: null,
    _bodyObserver: null,
    _bodyObserverTimer: null,
    _routeObserver: null,
    _popstateHandler: null,
    _lastPath: '',

    // ─────────────────────────────
    //  Private: Session helpers
    // ─────────────────────────────

    /**
     * 從目前 URL 路徑取得對話 session id。
     * 與 content-script.js 的 extractUuidFromUrl() 邏輯相同；因該函式為模組層級
     * 私有函式、未掛載於 window.DSstudio，故此處保留一份最小複製（專案內既有慣例，
     * 參見 temporary-chat-delete.js / popup.preset-manager.js 各自的複製版本）。
     * @returns {string|null}
     */
    _getSessionId() {
        const match = window.location.pathname.match(this.SESSION_PATH_REGEX);
        return match ? match[1] : null;
    },

    // ─────────────────────────────
    //  Private: Button injection
    // ─────────────────────────────

    /**
     * 尋找可作為 clone 樣式來源的原生／GoToTop 按鈕。
     * @returns {HTMLElement|null}
     */
    _findStyleSourceButton() {
        const goTop = window.DSstudio && window.DSstudio.GoToTop;
        if (!goTop) return null;
        if (goTop._button) return goTop._button;
        if (typeof goTop._getNativeButton === 'function') return goTop._getNativeButton();
        return null;
    },

    /**
     * 找出按鈕應注入的父容器（沿用 GoToTop 的包裝容器選擇器）。
     * @returns {HTMLElement|null}
     */
    _findInjectParent() {
        const goTop = window.DSstudio && window.DSstudio.GoToTop;
        const source = this._findStyleSourceButton();
        if (source && source.parentElement) return source.parentElement;
        if (goTop && goTop.INJECT_PARENT_SELECTOR) {
            const parent = document.querySelector(goTop.INJECT_PARENT_SELECTOR);
            if (parent) return parent;
        }
        return null;
    },

    /**
     * 歷史面板圖示（時鐘 + 指針，代表「歷史紀錄」，與 go-top 的向上箭頭明確區隔）。
     * @returns {string}
     */
    _iconSvg() {
        return [
            '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"',
            ' xmlns="http://www.w3.org/2000/svg">',
            '<circle cx="7" cy="7.5" r="5.25" stroke="currentColor" stroke-width="1.2"/>',
            '<path d="M7 4.5V7.5L9 9" stroke="currentColor" stroke-width="1.2"',
            ' stroke-linecap="round" stroke-linejoin="round"/>',
            '<path d="M4.5 1.5H9.5" stroke="currentColor" stroke-width="1.2"',
            ' stroke-linecap="round"/>',
            '</svg>'
        ].join('');
    },

    /**
     * 依「參照元素」（go-top 按鈕或原生按鈕，兩者擇一，取決於哪個實際存在）計算
     * 本按鈕的堆疊間距，使其恰好疊放於參照元素上方 STACK_GAP_PX px，避免視覺重疊。
     * 邏輯與 go-top.render.js 的 _applyStackedOffset 相同，僅參照對象不同。
     * @param {HTMLElement} btn
     * @param {HTMLElement} referenceEl
     */
    _applyStackOffset(btn, referenceEl) {
        const refStyle = getComputedStyle(referenceEl);
        const refMarginBottom = parseFloat(refStyle.marginBottom) || 0;
        const refHeight = referenceEl.offsetHeight || 34;
        btn.style.position = 'absolute';
        btn.style.bottom = '100%';
        btn.style.marginBottom = `${refMarginBottom + refHeight + this.STACK_GAP_PX}px`;

        const refRight = parseFloat(refStyle.right);
        btn.style.right = !isNaN(refRight) ? `${refRight}px` : '12px';
    },

    /**
     * 注入開啟按鈕；若已存在則不重複注入。
     * @returns {boolean} 是否已成功注入或已存在
     */
    _injectButton() {
        const source = this._findStyleSourceButton();

        const existing = document.querySelector('.' + this.OPEN_BTN_CLASS);
        if (existing) {
            this._button = existing;
            if (source) this._applyStackOffset(existing, source);
            return true;
        }

        const parent = this._findInjectParent();
        if (!source || !parent) return false;

        const btn = source.cloneNode(true);
        // 移除 go-top 專屬 class 與原生定位雜湊 class，避免被誤認為同一顆按鈕或繼承其定位
        btn.classList.remove('dsw-gotop', 'dsw-gotop--solo', 'dsw-gotop--stacked', '_0706cde');
        btn.classList.add(this.OPEN_BTN_CLASS);
        btn.removeAttribute('id');
        btn.removeAttribute('style');
        const label = (typeof dsI18n !== 'undefined') ? dsI18n.t('historyPanelLabel') : '完整對話歷史面板';
        btn.setAttribute('aria-label', label);
        btn.title = label;

        const iconEl = btn.querySelector('.ds-button__icon');
        if (iconEl) iconEl.innerHTML = this._iconSvg();

        this._applyStackOffset(btn, source);
        btn.addEventListener('click', () => this._handleOpenClick());

        parent.insertBefore(btn, parent.firstChild);
        this._button = btn;
        return true;
    },

    _removeButton() {
        if (this._button) {
            this._button.remove();
            this._button = null;
        }
    },

    // ─────────────────────────────
    //  Private: Panel lifecycle
    // ─────────────────────────────

    /**
     * 延遲建立面板（首次點擊時才建立並掛載至 body），之後重複使用同一節點。
     * @returns {HTMLElement}
     */
    _ensurePanel() {
        if (this._panelEl) return this._panelEl;
        this._panelEl = window.__DS_HistoryPanel_render.createPanel({
            onExport: () => window.__DS_HistoryPanel_export.downloadMarkdown(this._currentThread),
            onClose: () => window.__DS_HistoryPanel_render.close(this._panelEl),
        });
        document.body.appendChild(this._panelEl);
        return this._panelEl;
    },

    /**
     * 開啟按鈕點擊：讀取當前對話的完整紀錄，渲染並開啟面板。
     */
    async _handleOpenClick() {
        const sessionId = this._getSessionId();
        if (!sessionId) return;

        this._currentThread = await window.__DS_HistoryPanel_idb.loadActiveThread(sessionId);
        const panelEl = this._ensurePanel();
        window.__DS_HistoryPanel_render.renderThread(panelEl, this._currentThread);
        window.__DS_HistoryPanel_render.open(panelEl);
    },

    // ─────────────────────────────
    //  Private: Observers
    // ─────────────────────────────

    /**
     * 監控 body 變動，偵測按鈕被 React 重新渲染移除後即時補注入。
     */
    _startBodyObserver() {
        if (this._bodyObserver) return;
        this._bodyObserver = new MutationObserver(() => {
            clearTimeout(this._bodyObserverTimer);
            this._bodyObserverTimer = setTimeout(() => {
                if (this.enabled && !document.querySelector('.' + this.OPEN_BTN_CLASS)) {
                    this._injectButton();
                }
            }, this.OBSERVER_DEBOUNCE);
        });
        this._bodyObserver.observe(document.body, { childList: true, subtree: true });
    },

    _stopBodyObserver() {
        if (this._bodyObserver) {
            this._bodyObserver.disconnect();
            this._bodyObserver = null;
        }
        clearTimeout(this._bodyObserverTimer);
        this._bodyObserverTimer = null;
    },

    /**
     * 監控 SPA 路由變化（MutationObserver + popstate），沿用 go-top.js 的作法。
     */
    _startRouteObserver() {
        if (this._routeObserver) return;
        this._lastPath = window.location.pathname;

        this._routeObserver = new MutationObserver(() => {
            if (window.location.pathname !== this._lastPath) {
                this._lastPath = window.location.pathname;
                this._onRouteChange();
            }
        });
        this._routeObserver.observe(document.body, { childList: true, subtree: true });

        this._popstateHandler = () => {
            if (window.location.pathname !== this._lastPath) {
                this._lastPath = window.location.pathname;
                this._onRouteChange();
            }
        };
        window.addEventListener('popstate', this._popstateHandler);
    },

    _stopRouteObserver() {
        if (this._routeObserver) {
            this._routeObserver.disconnect();
            this._routeObserver = null;
        }
        if (this._popstateHandler) {
            window.removeEventListener('popstate', this._popstateHandler);
            this._popstateHandler = null;
        }
    },

    /**
     * 路由切換：重置目前對話快取、關閉面板（若開啟中）、重新評估按鈕注入。
     */
    _onRouteChange() {
        this._currentThread = null;
        if (this._panelEl) {
            window.__DS_HistoryPanel_render.close(this._panelEl);
        }
        this._removeButton();
        if (this.enabled) {
            setTimeout(() => this._injectButton(), 100);
        }
    },

    // ─────────────────────────────
    //  Public: Lifecycle
    // ─────────────────────────────

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this._startBodyObserver();
        this._startRouteObserver();
        this._injectButton();
    },

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this._stopBodyObserver();
        this._stopRouteObserver();
        this._removeButton();
        if (this._panelEl) {
            window.__DS_HistoryPanel_render.close(this._panelEl);
        }
    },

    /**
     * 讀取主開關與本功能開關，兩者皆為真時啟用；並訂閱 storage 異動即時反應。
     */
    async init() {
        const data = await new Promise((resolve) => {
            chrome.storage.local.get(
                [StorageManager.KEYS.IS_ENABLED, StorageManager.KEYS.HISTORY_PANEL_ENABLED],
                resolve
            );
        });

        this._masterEnabled = data[StorageManager.KEYS.IS_ENABLED] ?? false;
        const isFeatureEnabled = data[StorageManager.KEYS.HISTORY_PANEL_ENABLED] ??
            StorageManager.DEFAULTS[StorageManager.KEYS.HISTORY_PANEL_ENABLED];

        this._setupStorageListener();

        if (this._masterEnabled && isFeatureEnabled) {
            this.enable();
        }
    },

    /**
     * 監聽主開關與本功能開關的即時異動，切換啟用 / 停用狀態。
     */
    _setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            if (changes[StorageManager.KEYS.IS_ENABLED]) {
                this._masterEnabled = changes[StorageManager.KEYS.IS_ENABLED].newValue;
                if (this._masterEnabled) {
                    chrome.storage.local.get([StorageManager.KEYS.HISTORY_PANEL_ENABLED], (data) => {
                        const isFeatureEnabled = data[StorageManager.KEYS.HISTORY_PANEL_ENABLED] ??
                            StorageManager.DEFAULTS[StorageManager.KEYS.HISTORY_PANEL_ENABLED];
                        if (isFeatureEnabled) this.enable();
                    });
                } else {
                    this.disable();
                }
            }

            if (changes[StorageManager.KEYS.HISTORY_PANEL_ENABLED]) {
                if (!this._masterEnabled) return;
                if (changes[StorageManager.KEYS.HISTORY_PANEL_ENABLED].newValue) {
                    this.enable();
                } else {
                    this.disable();
                }
            }
        });
    },

    destroy() {
        this.disable();
    }
};

// Auto-start
HistoryPanel.init();

// Expose on window for content-script.js cross-module access
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.HistoryPanel = HistoryPanel;
}

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HistoryPanel;
}
