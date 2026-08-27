/**
 * DS studio — Go To Top Lifecycle Bundle
 * 路由切換處理、啟用／停用、DOM 就緒輪詢及完整生命週期管理。 透過 Object.assign 合併至 GoToTop 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    const bundle = {
        // ─────────────────────────────
        //  Private: Route change handler
        // ─────────────────────────────

        /**
         * Handle SPA route changes: abort active scroll, reset state, re-inject.
         * 重設 _hasSeenDom 讓新對話頁面的 DOM miss 不計入降級計數。 */
        _onRouteChange() {
            // 取消進行中的滾動
            if (this._isLocked && this._scrollReject) {
                this._scrollReject({ success: false, reason: 'aborted' });
            }

            // 中止進行中的 DOM 就緒輪詢，新路由會重新起一輪
            this._stopConnectRetry();

            // 重設所有狀態
            this._isLocked = false;
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
         * 若 DOM 尚未掛載，以輪詢方式重試直到首次找到 DOM 或超過最大重試次數（≈60s）。 */
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
         * 就緒條件：INJECT_PARENT_SELECTOR（.aaff8b8f）已掛載，或原生按鈕已出現。 未就緒時以 DSSRetryUntil 每 500ms 重試，最多 120 次（約 60 秒）； 超過上限直接放棄，不注入任何按鈕。 */
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

            this._isLocked = false;
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
         * 生效條件僅取決於擴充功能主開關；初始值與後續變更皆由 content/feature-toggle.js 經 background 訊息路由提供。 */
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

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    root.__DS_GoToTop_lifecycle = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
