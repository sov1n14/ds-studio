/**
 * DS studio — Go To Top Scroll Bundle
 * 滾動動畫引擎：scrollToTopAndWait 及其內部輔助邏輯。
 * 透過 Object.assign 合併至 GoToTop 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    // 合併共用選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const __DSSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});
    const GO_TOP_NATIVE_BUTTON_CLASS = __DSSelectors.GO_TOP_NATIVE_BUTTON_CLASS;
    // 本擴充功能自行注入的 GoTop 按鈕識別 class（非 DeepSeek 原生標記）
    const GO_TOP_CLONE_SELECTOR = '.dsw-gotop';
    // 使用者按下原生「到底部」按鈕的事件：pointerdown 為主，click 為備援（例如未產生 pointer 事件的輸入方式）
    const NATIVE_PRESS_EVENT_TYPES = ['pointerdown', 'click'];

    const bundle = {
        /**
         * 判斷事件是否為使用者真實按下 DeepSeek 原生「到底部」按鈕。
         * 僅接受瀏覽器產生的事件（isTrusted），並排除本擴充功能的 GoTop 按鈕（.dsw-gotop）。
         * @param {Event} event
         * @returns {boolean}
         */
        _isNativeGoBottomPress(event) {
            if (!event || event.isTrusted !== true) return false;
            const target = event.target;
            if (!target || typeof target.closest !== 'function') return false;
            if (target.closest(GO_TOP_CLONE_SELECTOR)) return false;
            return Boolean(target.closest('.' + GO_TOP_NATIVE_BUTTON_CLASS));
        },

        // ─────────────────────────────
        //  Public: Scroll to top with animation
        // ─────────────────────────────

        /**
         * Scroll to the top of the conversation.
         * Jumps the resolved scroll container directly to scrollTop 0 on each poll,
         * re-jumping while the virtualized list keeps lazily mounting older messages
         * above, and resolves once the scroll height has stabilised and the top
         * anchor is verified via MutationObserver-driven polling.
         *
         * @param {Object} [options]
         * @param {number} [options.timeout] - Max scroll duration in ms (default TIMEOUT)
         * @param {boolean} [options.cancelOnNativePress] - Stop when the user presses DeepSeek's native go-bottom button (Go Top button only; default false)
         * @returns {Promise<{success: boolean, reason?: string}>}
         */
        scrollToTopAndWait(options = {}) {
            // 切換行為：若滾動進行中，中止目前滾動並直接返回（不重新啟動）
            if (this._isLocked && this._scrollReject) {
                this._scrollReject({ success: false, reason: 'stopped-by-user' });
                return;
            }

            this._isLocked = true;
            // 按鈕在整個滾動過程中保持啟用狀態（aria-disabled 維持 false），
            // 使用者可隨時再次點擊以中止滾動

            const startTime = Date.now();
            const effectiveTimeout = options.timeout || this.TIMEOUT;

            this._scrollPromise = new Promise((resolve, reject) => {
                this._scrollReject = reject;

                let consecutiveMisses = 0;
                let mutationTimer = null;
                let isAborted = false;
                // 追蹤穩定狀態以應對虛擬列表動態增長
                let _stableTopCount = 0;
                let _lastScrollHeight = -1;
                const STABLE_REQUIRED = 3;

                const tempObserver = new MutationObserver(() => {
                    if (mutationTimer !== null) {
                        clearTimeout(mutationTimer);
                        mutationTimer = null;
                        // 虛擬列表注入新節點後，重設穩定計數並立即繼續滾動
                        _stableTopCount = 0;
                        scheduleNext();
                    }
                });

                // 若快取容器無效，重新探測（不以 scrollHeight <= clientHeight 判定無效：
                // 未溢出僅代表內容尚短，容器本身仍然正確，見 harvest.dom.js 同理修正）
                let scrollContainer = this._scrollContainer;
                if (!scrollContainer) {
                    scrollContainer = this._findScrollContainer(this._getAnchor());
                    if (scrollContainer === document.scrollingElement || scrollContainer === document.documentElement) {
                        this._scrollContainer = null;
                    } else {
                        this._scrollContainer = scrollContainer;
                    }
                }

                if (!scrollContainer) {
                    // 找不到容器即未啟動任何滾動：釋放鎖定與中止接口，避免下一次點擊誤走中止分支而永遠無法捲動
                    this._isLocked = false;
                    this._scrollReject = null;
                    resolve({ success: false, reason: 'no_container' });
                    return;
                }

                tempObserver.observe(scrollContainer, { childList: true, subtree: true });

                // 儲存呼叫前狀態並「僅在尚未啟用時」開啟，而非盲目切換：
                // harvest.js 可能已在更大範圍的匯出流程中啟用 PreventAutoScroll，
                // 內部再呼叫本函式，若在此無條件 disable() 會提前關閉保護，
                // 中斷 harvest 仍在進行中的匯出（無參照計數，disable() 為全域開關）
                const preventAutoScroll = window.DSstudio?.PreventAutoScroll;
                const wasAlreadyEnabled = preventAutoScroll?.isEnabled() ?? false;
                if (preventAutoScroll && !wasAlreadyEnabled) preventAutoScroll.enable();

                // Go Top 進行中使用者按下原生「到底部」：立即中止 Go Top，讓頁面停在底部（以使用者最後一次點擊為準）。
                // 僅限由 GoTop 按鈕啟動者（cancelOnNativePress）；匯出流程呼叫時不受影響，避免中斷匯出。
                // 不呼叫 preventDefault / stopPropagation，原生點擊須照常傳遞給 React 執行捲到底部。
                const isCancelOnNativePress = options.cancelOnNativePress === true;
                const onNativePress = (event) => {
                    if (!this._isNativeGoBottomPress(event)) return;
                    if (this._scrollReject) this._scrollReject({ success: false, reason: 'stopped-by-user' });
                };
                if (isCancelOnNativePress) {
                    NATIVE_PRESS_EVENT_TYPES.forEach((type) => document.addEventListener(type, onNativePress, true));
                }

                const cleanup = () => {
                    if (isCancelOnNativePress) {
                        NATIVE_PRESS_EVENT_TYPES.forEach((type) => document.removeEventListener(type, onNativePress, true));
                    }
                    tempObserver.disconnect();
                    if (mutationTimer !== null) {
                        clearTimeout(mutationTimer);
                        mutationTimer = null;
                    }
                    if (preventAutoScroll && !wasAlreadyEnabled) preventAutoScroll.disable();
                    this._isLocked = false;
                    this._scrollPromise = null;
                    this._scrollReject = null;
                    if (this._button) {
                        this._button.setAttribute('aria-disabled', 'false');
                    }
                    this._evaluateVisibility();
                };

                const step = () => {
                    if (isAborted) return;

                    if (Date.now() - startTime > effectiveTimeout) {
                        cleanup();
                        resolve({ success: false, reason: 'timeout' });
                        return;
                    }

                    // 直接跳至頂端而非逐步位移：距離越長，逐步位移所需的輪詢次數越多，
                    // 直接寫入 scrollTop = 0 讓抵達時間與對話長度無關（僅取決於收斂閘門）。
                    scrollContainer.scrollTop = 0;

                    const currentScrollTop = scrollContainer.scrollTop;
                    const currentScrollHeight = scrollContainer.scrollHeight;

                    if (currentScrollTop <= 0) {
                        if (currentScrollHeight === _lastScrollHeight) {
                            _stableTopCount++;
                        } else {
                            _stableTopCount = 0;
                            _lastScrollHeight = currentScrollHeight;
                        }
                    } else {
                        _stableTopCount = 0;
                        _lastScrollHeight = currentScrollHeight;
                    }

                    if (_stableTopCount >= STABLE_REQUIRED) {
                        if (this._isAtTop()) {
                            cleanup();
                            resolve({ success: true });
                            return;
                        }
                        consecutiveMisses++;
                        if (consecutiveMisses >= this.MAX_ANCHOR_RETRIES) {
                            cleanup();
                            resolve({ success: false, reason: 'anchor_not_found' });
                            return;
                        }
                    } else {
                        const anchor = this._getAnchor();
                        if (anchor) {
                            consecutiveMisses = 0;
                        } else {
                            consecutiveMisses++;
                            if (consecutiveMisses >= this.MAX_ANCHOR_RETRIES &&
                                currentScrollTop <= 0) {
                                cleanup();
                                resolve({ success: false, reason: 'anchor_not_found' });
                                return;
                            }
                        }
                    }

                    scheduleNext();
                };

                const scheduleNext = () => {
                    if (isAborted) return;
                    mutationTimer = setTimeout(() => {
                        mutationTimer = null;
                        step();
                    }, this.ANCHOR_POLL_INTERVAL);
                };

                // 透過 reject 路徑暴露中止接口（供 _onRouteChange 使用）
                this._scrollReject = (result) => {
                    isAborted = true;
                    cleanup();
                    reject(result);
                };

                step();
            });

            return this._scrollPromise;
        },
    };

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    // Stryker disable all: equivalent mutants — module/globalThis export boilerplate, untestable in Node
    root.__DS_GoToTop_scroll = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
// Stryker restore all
