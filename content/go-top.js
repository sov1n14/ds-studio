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
 *   1. utils/settings-message-constants.js → DSS_SETTINGS_MSG
 *   2. content/feature-toggle.js → globalThis.DSSFeatureToggle
 *   3. content/retry-until.js → globalThis.DSSRetryUntil
 *   4. go-top.locate.js → 掛載 globalThis.__DS_GoToTop_locate
 *   5. go-top.render.js → 掛載 globalThis.__DS_GoToTop_render
 *   6. go-top.scroll.js → 掛載 globalThis.__DS_GoToTop_scroll
 *   7. go-top.js        → Object.assign 合併後呼叫 GoToTop.init()
 *
 * 設定來源：主開關狀態由 registerFeatureToggle 經 background 的
 * DSS_GET_SETTINGS 與 DSS_SETTINGS_CHANGED 訊息路由取得。
 */

// 合併共用選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DSSelectorsGoTop = (typeof globalThis !== 'undefined' ? globalThis : window).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

const GoToTop = {
    // === 常數 ===
    TIMEOUT: 30000,
    OBSERVER_DEBOUNCE: 50,
    ANCHOR_POLL_INTERVAL: 100,
    MAX_ANCHOR_RETRIES: 5,
    // 包裝容器 observer 去抖動延遲（ms）
    WRAPPER_OBSERVER_DEBOUNCE: 80,
    // DOM 就緒輪詢：間隔 500ms、最多 120 次重試（約 60 秒）
    CONNECT_RETRY_INTERVAL: 500,
    MAX_CONNECT_RETRIES: 120,
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
    FIRST_MSG_SELECTOR: __DSSelectorsGoTop.ASSISTANT_MESSAGE_SELECTOR,
    // 虛擬列表容器：用於找到正確的滾動容器（單一來源定義於 content/ds-selectors.js）
    VIRTUAL_LIST_SELECTOR: __DSSelectorsGoTop.VIRTUAL_LIST_SELECTOR,
    VIRTUAL_LIST_FALLBACK: __DSSelectorsGoTop.VIRTUAL_LIST_FALLBACK,
    // 原生按鈕選擇器：精確雜湊 class 優先，再退回穩定 ds-* class 組合
    // confirmed in go-bottom.html: <div role="button" class="ds-button ... ds-button--floating _0706cde ...">
    NATIVE_BTN_SELECTOR: '._0706cde:not(.dsw-gotop)',
    INJECT_PARENT_SELECTOR: __DSSelectorsGoTop.FLOATING_BUTTON_BAR_SELECTOR,
    INJECT_PARENT_FALLBACK: __DSSelectorsGoTop.CONTENT_COLUMN_SELECTOR + ' > div:nth-child(2)',
    OUTER_WRAPPER_SELECTOR: __DSSelectorsGoTop.CONTENT_COLUMN_SELECTOR,

    // === 狀態 ===
    enabled: false,
    _masterEnabled: false,
    _button: null,
    // 注入模式：'injected'（主路徑，stacked）或 'wrapper-solo'（solo 路徑）
    _injectionMode: null,
    _scrollContainer: null,
    _observer: null,
    // 包裝容器變動監控器，用於偵測 React re-render 後重新注入
    _wrapperObserver: null,
    _wrapperObserverTimer: null,
    _scrollListener: null,
    _locked: false,
    // 首次成功找到 DOM 後才開始累積 miss 計數
    _hasSeenDom: false,
    _scrollPromise: null,
    _scrollReject: null,
    _popstateHandler: null,
    _observerTimer: null,
    // DOM 就緒輪詢的取消函式；僅在輪詢進行中持有，結束（就緒／放棄／取消）後歸零
    _cancelConnectRetry: null,
    // route change 後排程重連 DOM 的計時器（供 disable() 中止，避免關閉後仍重新注入）
    _routeChangeTimer: null,
    // registerFeatureToggle 的解除註冊函式
    _unregisterToggle: null,
    _lastPath: '',

    // ─────────────────────────────
    //  Private: Observers & listeners
    // ─────────────────────────────

    /**
     * Watch the DOM for structural changes (new messages, SPA re-renders).
     * Debounces route detection and _evaluateVisibility onto one observer.
     * 刻意不監聽 attributes：可見性僅取決於節點結構與滾動位置，
     * 且本功能自身會改寫按鈕 style，監聽屬性會造成回呼自我觸發。
     */
    _startObserver() {
        if (this._observer) return;
        this._observer = new MutationObserver(() => {
            clearTimeout(this._observerTimer);
            this._observerTimer = setTimeout(() => {
                // 路由切換與可見性判斷共用同一組去抖動的 DOM 變動事件
                if (this._handlePathChange()) return;
                this._evaluateVisibility();
            }, this.OBSERVER_DEBOUNCE);
        });
        this._observer.observe(document.body, {
            childList: true,
            subtree: true,
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
     * 比對 pathname 判斷是否發生 SPA 路由切換；已切換則觸發 _onRouteChange。
     * @returns {boolean} 是否偵測到路由切換
     */
    _handlePathChange() {
        const currentPath = window.location.pathname;
        if (currentPath === this._lastPath) return false;

        // 首次比對（_lastPath 尚未初始化）只記錄基準，不視為路由切換
        const isFirstSample = !this._lastPath;
        this._lastPath = currentPath;
        if (isFirstSample) return false;

        this._onRouteChange();
        return true;
    },

    /**
     * Watch for SPA route changes via popstate.
     * DOM 變動路徑的路由偵測已併入 _startObserver 的去抖動回呼。
     */
    _startRouteListener() {
        if (this._popstateHandler) return;
        this._lastPath = window.location.pathname;

        this._popstateHandler = () => {
            this._handlePathChange();
        };
        window.addEventListener('popstate', this._popstateHandler);
    },

    _stopRouteListener() {
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

        // 中止進行中的 DOM 就緒輪詢，新路由會重新起一輪
        this._stopConnectRetry();

        // 重設所有狀態
        this._locked = false;
        this._scrollPromise = null;
        this._scrollReject = null;
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
        clearTimeout(this._routeChangeTimer);
        this._routeChangeTimer = setTimeout(() => {
            this._tryConnectDom();
        }, 100);
    },

    // ─────────────────────────────
    //  Public: Lifecycle
    // ─────────────────────────────

    /**
     * Enable the go-top feature: inject button, start observers.
     * 若 DOM 尚未掛載，以輪詢方式重試直到首次找到 DOM 或超過最大重試次數（≈60s）。
     */
    enable() {
        if (this.enabled) return;
        this.enabled = true;

        this._startRouteListener();
        this._startObserver();

        // 嘗試注入按鈕；若 DOM 尚未準備好則重試
        this._tryConnectDom();
    },

    /**
     * 嘗試注入按鈕、找到滾動容器並附加 scroll 監聽器。
     * 就緒條件：INJECT_PARENT_SELECTOR（.aaff8b8f）已掛載，或原生按鈕已出現。
     * 未就緒時以 DSSRetryUntil 每 500ms 重試，最多 120 次（約 60 秒）；
     * 超過上限直接放棄，不注入任何按鈕。
     */
    _tryConnectDom() {
        if (!this.enabled) return;

        // 瀏覽器：由 content/retry-until.js 於前載入設定全域；Node.js 測試：直接 require
        const retryUntil = globalThis.DSSRetryUntil ||
            (typeof require !== 'undefined' ? require('./retry-until.js') : null);
        if (typeof retryUntil !== 'function') {
            throw new Error('content/go-top.js 需要 content/retry-until.js 先行載入');
        }

        // 重新排程前先中止舊輪詢，避免路由連續切換時累積多條迴圈
        this._stopConnectRetry();

        let isPending = true;
        const cancel = retryUntil(
            // 就緒判斷：輸入區包裝容器或原生按鈕任一已掛載即視為就緒
            () => Boolean(document.querySelector(this.INJECT_PARENT_SELECTOR)) ||
                Boolean(this._getNativeButton()),
            {
                intervalMs: this.CONNECT_RETRY_INTERVAL,
                maxRetries: this.MAX_CONNECT_RETRIES,
                onReady: () => {
                    isPending = false;
                    this._cancelConnectRetry = null;
                    this._connectDom();
                },
                onGiveUp: () => {
                    isPending = false;
                    this._cancelConnectRetry = null;
                },
            },
        );
        // 首次判定即就緒（或放棄）時輪詢已結束，不保留取消函式
        if (isPending) this._cancelConnectRetry = cancel;
    },

    /** 中止進行中的 DOM 就緒輪詢；未在輪詢中則為 no-op。 */
    _stopConnectRetry() {
        if (!this._cancelConnectRetry) return;
        this._cancelConnectRetry();
        this._cancelConnectRetry = null;
    },

    /**
     * DOM 就緒後的實際重連：注入按鈕、快取滾動容器、附加監聽器並更新可見性。
     */
    _connectDom() {
        this._injectButton();

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
        this._stopRouteListener();
        this._stopWrapperObserver();

        if (this._button) {
            this._button.remove();
            this._button = null;
            this._injectionMode = null;
        }

        this._stopConnectRetry();

        clearTimeout(this._routeChangeTimer);
        this._routeChangeTimer = null;

        this._scrollContainer = null;
        this._scrollPromise = null;
        // 中止進行中的滾動，而非任由其跑到自身 timeout 才結束
        if (this._scrollReject) {
            this._scrollReject({ success: false, reason: 'aborted' });
        }
        this._scrollReject = null;
        this._hasSeenDom = false;
    },

    /**
     * 註冊主開關閘控。GoToTop 無自身切換開關，故 ownKey 為 null，
     * 生效條件僅取決於擴充功能主開關；初始值與後續變更皆由
     * content/feature-toggle.js 經 background 訊息路由提供。
     */
    async init() {
        try {
            // 瀏覽器：由 content/feature-toggle.js 於前載入設定全域；Node.js 測試：直接 require
            const featureToggle = globalThis.DSSFeatureToggle ||
                (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
            if (!featureToggle) {
                throw new Error('content/go-top.js 需要 content/feature-toggle.js 先行載入');
            }

            this._unregisterToggle = featureToggle.registerFeatureToggle({
                ownKey: null,
                onEnable: () => {
                    this._masterEnabled = true;
                    this.enable();
                },
                onDisable: () => {
                    this._masterEnabled = false;
                    this.disable();
                },
            });
        } catch (error) {
            // 啟動邊界：拋錯無人可接，攔下並記錄；功能維持休眠
            console.error('[DSS] go-top 啟動失敗:', error);
        }
    },

    /**
     * Full cleanup: disable and remove all listeners.
     */
    destroy() {
        this.disable();
        if (this._unregisterToggle) {
            this._unregisterToggle();
            this._unregisterToggle = null;
        }
    }
};

// 合併 DOM bundle 與 Scroll bundle（bundle 檔案須在 manifest 中先於此檔案載入）
(function (root) {
    Object.assign(GoToTop, root.__DS_GoToTop_locate || {}, root.__DS_GoToTop_render || {}, root.__DS_GoToTop_scroll || {});
})(typeof globalThis !== 'undefined' ? globalThis : window);

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
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
