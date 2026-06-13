/**
 * DS studio — Go To Top Scroll Bundle
 * 滾動動畫引擎：scrollToTopAndWait 及其內部輔助邏輯。
 * 透過 Object.assign 合併至 GoToTop 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    const bundle = {
        // ─────────────────────────────
        //  Public: Scroll to top with animation
        // ─────────────────────────────

        /**
         * Smoothly scroll to the top of the conversation.
         * Uses scrollBy steps and waits for lazy-loaded content via MutationObserver.
         *
         * @param {Object} [options]
         * @param {number} [options.timeout] - Max scroll duration in ms (default TIMEOUT)
         * @returns {Promise<{success: boolean, reason?: string}>}
         */
        scrollToTopAndWait(options = {}) {
            // 切換行為：若滾動進行中，中止目前滾動並直接返回（不重新啟動）
            if (this._locked && this._scrollReject) {
                this._scrollReject({ success: false, reason: 'stopped-by-user' });
                return;
            }

            this._locked = true;
            // 按鈕在整個滾動過程中保持啟用狀態（aria-disabled 維持 false），
            // 使用者可隨時再次點擊以中止滾動

            const startTime = Date.now();
            const effectiveTimeout = options.timeout || this.TIMEOUT;

            this._scrollPromise = new Promise((resolve, reject) => {
                this._scrollResolve = resolve;
                this._scrollReject = reject;

                let consecutiveMisses = 0;
                let mutationTimer = null;
                let aborted = false;
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

                // 若快取容器無效，重新探測
                let scrollContainer = this._scrollContainer;
                if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
                    scrollContainer = this._findScrollContainer(this._getAnchor());
                    if (scrollContainer === document.scrollingElement || scrollContainer === document.documentElement) {
                        this._scrollContainer = null;
                    } else {
                        this._scrollContainer = scrollContainer;
                    }
                }

                if (!scrollContainer) {
                    resolve({ success: false, reason: 'no_container' });
                    return;
                }

                tempObserver.observe(scrollContainer, { childList: true, subtree: true });

                const cleanup = () => {
                    tempObserver.disconnect();
                    if (mutationTimer !== null) {
                        clearTimeout(mutationTimer);
                        mutationTimer = null;
                    }
                    this._locked = false;
                    this._scrollPromise = null;
                    this._scrollResolve = null;
                    this._scrollReject = null;
                    if (this._button) {
                        this._button.setAttribute('aria-disabled', 'false');
                    }
                    this._evaluateVisibility();
                };

                const step = () => {
                    if (aborted) return;

                    if (Date.now() - startTime > effectiveTimeout) {
                        cleanup();
                        resolve({ success: false, reason: 'timeout' });
                        return;
                    }

                    scrollContainer.scrollBy(0, -window.innerHeight * this.SCROLL_STEP_FACTOR);

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
                            resolve({ success: false });
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
                                resolve({ success: false });
                                return;
                            }
                        }
                    }

                    scheduleNext();
                };

                const scheduleNext = () => {
                    if (aborted) return;
                    mutationTimer = setTimeout(() => {
                        mutationTimer = null;
                        step();
                    }, this.ANCHOR_POLL_INTERVAL);
                };

                // 透過 reject 路徑暴露中止接口（供 _onRouteChange 使用）
                this._scrollReject = (result) => {
                    aborted = true;
                    cleanup();
                    reject(result);
                };

                step();
            });

            return this._scrollPromise;
        },
    };

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    root.__DS_GoToTop_scroll = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
