/**
 * DS studio — Go To Top (Entry)
 * 將「回到頂部」按鈕注入原生 go-bottom 按鈕的包裝容器，
 * 利用頁面自身佈局定位，不再使用 position:fixed 座標計算。
 *
 * 架構決策（v2.6.2+）：
 *   - 主路徑：將 GoTop 按鈕以 insertBefore 注入原生按鈕的直接父層容器
 *     (aaff8b8f，full-page.html line 1015)，由 flexbox 自動排列位置。
 *   - Solo 路徑：找不到原生按鈕但包裝容器存在時，使用 solo 模式注入。
 *   - 無降級 fixed 路徑：若兩條路徑均失敗則放棄注入，不建立按鈕。
 *   - MutationObserver 監控包裝容器，偵測 React re-render 後重新注入。
 *   - _tryConnectDom 以 INJECT_PARENT_SELECTOR 或 _getNativeButton() 作為就緒判斷，
 *     避免過早注入至 notification overlay。
 *
 * 載入順序（manifest.json content_scripts）：
 *   1. go-top.locate.js → 掛載 globalThis.__DS_GoToTop_locate
 *   2. go-top.render.js → 掛載 globalThis.__DS_GoToTop_render
 *   3. go-top.scroll.js → 掛載 globalThis.__DS_GoToTop_scroll
 *   4. go-top.js        → Object.assign 合併後呼叫 GoToTop.init()
 */
const GoToTop = {
    // === 常數 ===
    SCROLL_STEP_FACTOR: 0.9,
    TIMEOUT: 30000,
    OBSERVER_DEBOUNCE: 50,
    ANCHOR_POLL_INTERVAL: 100,
    MAX_ANCHOR_RETRIES: 5,
    // 包裝容器 observer 去抖動延遲（ms）
    WRAPPER_OBSERVER_DEBOUNCE: 80,
    // 原生按鈕 DOM 結構常數（依 go-bottom.html 實際捕獲值確認）
    NATIVE_BTN_TAG: 'div',
    // 穩定的 ds-* class（刻意排除雜湊 class _0706cde，避免 React 重繪後 class 失效）
    NATIVE_BTN_CLASSES: 'ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ds-button--m ds-button--icon-relative-m ds-button--floating',
    // 原生按鈕的 inline CSS 變數（控制尺寸、顏色、hover 效果）
    NATIVE_BTN_INLINE_STYLE: '--dsl-button-color: var(--dsw-alias-button-floating-fill); --dsl-button-height: 34px; --dsl-button-hover-color: var(--dsw-alias-button-floating-hover); --dsl-button-icon-size: 14px;',
    // stacked 模式中 GoTop 與原生按鈕之間的間距（px）
    STACK_GAP_PX: 8,

    // === CSS Class 選擇器 ===
    // 錨點選擇器：先用有兩個雜湊 class 的精確組合，再退回只有 _9663006，最後退回 data 屬性首項
    // confirmed in full-page.html line 327: <div class="_9663006 _2c189bc" data-virtual-list-item-key="1">
    ANCHOR_SELECTOR: '._9663006._2c189bc',
    ANCHOR_SELECTOR_FALLBACK1: '._9663006',
    ANCHOR_SELECTOR_FALLBACK2: '[data-virtual-list-item-key="1"]',
    // 訊息選擇器：先用雜湊組合，再退回 class-substring 比對
    // confirmed in full-page.html line 328: <div class="d29f3d7d ds-message _63c77b1">
    FIRST_MSG_SELECTOR: '.ds-message._63c77b1',
    // 虛擬列表容器：用於找到正確的滾動容器
    // confirmed in full-page.html line 323: <div class="ds-virtual-list-items _6f2c522">
    VIRTUAL_LIST_SELECTOR: '.ds-virtual-list-items._6f2c522',
    VIRTUAL_LIST_FALLBACK: '[class*="ds-virtual-list-items"]',
    // 原生按鈕選擇器：精確雜湊 class 優先，再退回穩定 ds-* class 組合
    // confirmed in go-bottom.html: <div role="button" class="ds-button ... ds-button--floating _0706cde ...">
    NATIVE_BTN_SELECTOR: '._0706cde:not(.dsw-gotop)',
    DEGRADED_THRESHOLD: 3,
    INJECT_PARENT_SELECTOR: '.aaff8b8f',
    INJECT_PARENT_FALLBACK: '._871cbca > div:nth-child(2)',
    OUTER_WRAPPER_SELECTOR: '._871cbca',

    // === 狀態 ===
    enabled: false,
    _masterEnabled: false,
    _button: null,
    // 注入模式：'injected'（主路徑，stacked）或 'wrapper-solo'（solo 路徑）
    _injectionMode: null,
    _scrollContainer: null,
    _observer: null,
    _routeObserver: null,
    // 包裝容器變動監控器，用於偵測 React re-render 後重新注入
    _wrapperObserver: null,
    _wrapperObserverTimer: null,
    _scrollListener: null,
    _locked: false,
    _degraded: false,
    _missCount: 0,
    // 首次成功找到 DOM 後才開始累積 miss 計數
    _hasSeenDom: false,
    _scrollPromise: null,
    _scrollResolve: null,
    _scrollReject: null,
    _popstateHandler: null,
    _observerTimer: null,
    // 問題 1：enable() 重試計時器
    _enableRetryTimer: null,
    _enableRetryCount: 0,
    _lastPath: '',

    // ─────────────────────────────
    //  Private: Observers & listeners
    // ─────────────────────────────

    /**
     * Watch the DOM for structural changes (new messages, SPA re-renders).
     * Debounces calls to _evaluateVisibility.
     */
    _startObserver() {
        if (this._observer) return;
        this._observer = new MutationObserver(() => {
            clearTimeout(this._observerTimer);
            this._observerTimer = setTimeout(() => {
                this._evaluateVisibility();
            }, this.OBSERVER_DEBOUNCE);
        });
        this._observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
        });
    },

    _stopObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        clearTimeout(this._observerTimer);
        this._observerTimer = null;
    },

    /**
     * Listen for scroll events on the container (throttled to 100ms).
     * 每次呼叫前先確認快取容器仍有效；若容器已變換則先解除舊監聽再重新附加。
     */
    _startScrollListener() {
        if (this._scrollListener && this._scrollContainer) return;

        if (!this._scrollContainer ||
            this._scrollContainer.scrollHeight <= this._scrollContainer.clientHeight) {
            return;
        }

        let lastCall = 0;
        this._scrollListener = () => {
            const now = Date.now();
            if (now - lastCall < 100) return;
            lastCall = now;
            this._evaluateVisibility();
        };
        this._scrollContainer.addEventListener('scroll', this._scrollListener, { passive: true });
    },

    _stopScrollListener() {
        if (this._scrollListener && this._scrollContainer) {
            this._scrollContainer.removeEventListener('scroll', this._scrollListener);
        }
        this._scrollListener = null;
    },

    /**
     * Watch for SPA route changes via MutationObserver + popstate.
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

    // ─────────────────────────────
    //  Private: Route change handler
    // ─────────────────────────────

    /**
     * Handle SPA route changes: abort active scroll, reset state, re-inject.
     * 重設 _hasSeenDom 讓新對話頁面的 DOM miss 不計入降級計數。
     */
    _onRouteChange() {
        // 取消進行中的滾動
        if (this._locked && this._scrollReject) {
            this._scrollReject({ success: false, reason: 'aborted' });
        }

        // 清除啟用重試計時器
        clearTimeout(this._enableRetryTimer);
        this._enableRetryTimer = null;
        this._enableRetryCount = 0;

        // 重設所有狀態
        this._locked = false;
        this._scrollPromise = null;
        this._scrollResolve = null;
        this._scrollReject = null;
        this._missCount = 0;
        this._degraded = false;
        // 路由切換後 DOM 重新掛載，重設首次見到 DOM 的旗標
        this._hasSeenDom = false;

        // 移除舊按鈕（新路由需重新注入至新包裝容器）
        if (this._button) {
            this._button.remove();
            this._button = null;
            this._injectionMode = null;
        }
        this._stopWrapperObserver();

        // 停止舊容器的 scroll 監聽器
        this._stopScrollListener();
        this._scrollContainer = null;

        // DOM 穩定後驅動 gated 重試迴圈：等待 .aaff8b8f／原生按鈕就緒後再注入並重連容器、監聽器與視覺狀態
        setTimeout(() => {
            this._tryConnectDom();
        }, 100);
    },

    // ─────────────────────────────
    //  Public: Export overlay helpers
    // ─────────────────────────────

    /**
     * Show a loading overlay while the full conversation is being loaded.
     * @param {string} [text] - Custom text; defaults to Chinese loading message.
     */
    _showExportOverlay(text) {
        let overlay = document.getElementById('dss-export-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'dss-export-overlay';
            overlay.style.cssText = [
                'position:fixed',
                'top:0',
                'left:0',
                'width:100%',
                'height:100%',
                'z-index:9999',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'background:rgba(0,0,0,0.5)',
                'color:#fff',
                'font-size:16px',
                'font-family:sans-serif',
            ].join(';') + ';';
            overlay.textContent = text || '正在載入完整對話，請稍候…';
            document.body.appendChild(overlay);
        } else {
            overlay.style.display = 'flex';
            if (text) overlay.textContent = text;
        }
    },

    /**
     * Hide the export loading overlay.
     */
    _hideExportOverlay() {
        const overlay = document.getElementById('dss-export-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    },

    // ─────────────────────────────
    //  Public: Lifecycle
    // ─────────────────────────────

    /**
     * Enable the go-top feature: inject button, start observers.
     * 若 DOM 尚未掛載，以輪詢方式重試直到首次找到 DOM 或超過最大重試次數（≈10s）。
     */
    enable() {
        if (this.enabled) return;
        this.enabled = true;

        this._startObserver();
        this._startRouteObserver();

        // 嘗試注入按鈕；若 DOM 尚未準備好則重試
        this._tryConnectDom();
    },

    /**
     * 嘗試注入按鈕、找到滾動容器並附加 scroll 監聽器。
     * 就緒條件：INJECT_PARENT_SELECTOR（.aaff8b8f）已掛載，或原生按鈕已出現。
     * 若尚未就緒則排程重試，最多 120 次（約 60 秒）；超過上限直接放棄，不注入任何按鈕。
     */
    _tryConnectDom() {
        const MAX_RETRIES = 120;
        const RETRY_INTERVAL = 500;

        // 就緒判斷：輸入區包裝容器或原生按鈕任一已掛載即視為就緒
        const isInputAreaReady = !!document.querySelector(this.INJECT_PARENT_SELECTOR);
        const isNativeBtnReady = !!this._getNativeButton();

        if (isInputAreaReady || isNativeBtnReady) {
            const isInjected = this._injectButton();

            // 找到滾動容器並啟動監聽（以 anchor 定位，anchor 此時可能已存在）
            const anchor = this._getAnchor();
            if (anchor) {
                const container = this._findScrollContainer(anchor);
                if (container &&
                    container !== document.scrollingElement &&
                    container !== document.documentElement) {
                    this._scrollContainer = container;
                }
            }
            this._startScrollListener();
            this._evaluateVisibility();
            this._enableRetryCount = 0;
            return;
        }

        // DOM 尚未就緒，排程重試
        this._enableRetryCount = (this._enableRetryCount || 0) + 1;
        if (this._enableRetryCount > MAX_RETRIES) {
            // 超過上限：放棄注入，不建立任何按鈕
            this._enableRetryCount = 0;
            return;
        }
        clearTimeout(this._enableRetryTimer);
        this._enableRetryTimer = setTimeout(() => {
            if (this.enabled) this._tryConnectDom();
        }, RETRY_INTERVAL);
    },

    /**
     * Disable the go-top feature: stop observers, remove button, reset state.
     */
    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        this._locked = false;
        this._stopObserver();
        this._stopScrollListener();
        this._stopRouteObserver();
        this._stopWrapperObserver();

        if (this._button) {
            this._button.remove();
            this._button = null;
            this._injectionMode = null;
        }

        clearTimeout(this._enableRetryTimer);
        this._enableRetryTimer = null;
        this._enableRetryCount = 0;

        this._scrollContainer = null;
        this._scrollPromise = null;
        this._scrollResolve = null;
        this._scrollReject = null;
        this._missCount = 0;
        this._degraded = false;
        this._hasSeenDom = false;
    },

    /**
     * Initialize state from storage and enable the feature if the
     * extension master switch is active. GoToTop has no per-feature toggle.
     */
    async init() {
        // 讀取擴充功能主開關狀態（唯一的啟用條件）
        const data = await new Promise((resolve) => {
            chrome.storage.local.get(
                [StorageManager.KEYS.IS_ENABLED],
                resolve
            );
        });

        this._masterEnabled = data[StorageManager.KEYS.IS_ENABLED] ?? false;

        this.setupStorageListener();

        // GoToTop 完全由主開關控制，無其他切換開關
        if (this._masterEnabled) {
            this.enable();
        }
    },

    /**
     * Listen for runtime storage changes to toggle the feature on/off.
     */
    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            // 擴充功能主開關 — 僅有此控制項
            if (changes[StorageManager.KEYS.IS_ENABLED]) {
                this._masterEnabled = changes[StorageManager.KEYS.IS_ENABLED].newValue;
                if (this._masterEnabled) {
                    this.enable();
                } else {
                    this.disable();
                }
            }
        });
    },

    /**
     * Full cleanup: disable and remove all listeners.
     */
    destroy() {
        this.disable();
    }
};

// 合併 DOM bundle 與 Scroll bundle（bundle 檔案須在 manifest 中先於此檔案載入）
(function (root) {
    Object.assign(GoToTop, root.__DS_GoToTop_locate || {}, root.__DS_GoToTop_render || {}, root.__DS_GoToTop_scroll || {});
})(typeof globalThis !== 'undefined' ? globalThis : window);

// Auto-start
GoToTop.init();

// Expose on window for content-script.js cross-module access
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.GoToTop = GoToTop;
}

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoToTop;
}
