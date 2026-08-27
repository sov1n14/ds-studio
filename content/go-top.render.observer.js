/**
 * DS studio — Go To Top Render :: Observer
 * 包裝容器 Observer 與模式切換。透過 Object.assign 合併至 GoToTop 物件。
 */
(function (root) {
    'use strict';

    const bundle = {
        //  Private: Wrapper observer（Re-injection guard）
        // ─────────────────────────────

        /**
         * 將現有按鈕元素（不移除）切換為 stacked 模式，避免 remove/recreate 產生閃爍。
         * 保留當前 display 值，僅更新 class、位置與偏移量。
         * @param {HTMLButtonElement} btn - 已在 DOM 中的 GoTop 按鈕
         * @param {Element} nativeBtn - 原生 go-bottom 按鈕
         */
        _transitionToStacked(btn, nativeBtn) {
            // 純 modifier swap：保留所有 ds-* class，僅切換定位 modifier
            btn.classList.remove('dsw-gotop--solo');
            btn.classList.add('dsw-gotop--stacked');
            // 移動至原生按鈕前（不變更 display）
            nativeBtn.parentElement.insertBefore(btn, nativeBtn);
            this._applyStackedOffset(btn, nativeBtn);
            this._injectionMode = 'injected';
        },

        /**
         * 將現有按鈕元素（不移除）切換為 solo 模式。
         * 保留當前 display 值，僅更新 class 與定位。
         * @param {HTMLButtonElement} btn - 已在 DOM 中的 GoTop 按鈕
         * @param {Element} injectParent - 注入父層容器
         */
        _transitionToSolo(btn, injectParent) {
            // 純 modifier swap：保留所有 ds-* class，僅切換定位 modifier
            btn.classList.remove('dsw-gotop--stacked');
            btn.classList.add('dsw-gotop--solo');
            // 移動至父層容器最前（不變更 display）
            injectParent.insertBefore(btn, injectParent.firstChild);
            // 清除 stacked 模式設定的 margin-bottom 與 right inline style
            btn.style.marginBottom = '';
            btn.style.right = '';
            this._injectionMode = 'wrapper-solo';
        },

        /**
         * 監控外層包裝容器（_871cbca），偵測 React re-render 移除 GoTop 節點後重新注入。
         * 去抖動延遲 WRAPPER_OBSERVER_DEBOUNCE ms，避免在同一批 mutation 中多次注入。
         * @param {Element} outerWrapper - full-page.html line 1013 的 _871cbca 元素
         */
        _startWrapperObserver(outerWrapper) {
            // 若已在監控相同元素，不重複啟動
            if (this._wrapperObserver) return;

            this._wrapperObserver = new MutationObserver(() => {
                // 去抖動
                clearTimeout(this._wrapperObserverTimer);
                this._wrapperObserverTimer = setTimeout(() => {
                    const nativeBtn = this._getNativeButton();

                    if (!this._button || !this._button.isConnected) {
                        // 按鈕已從 DOM 移除，重新注入並立即評估可見性
                        // 若按鈕移除前是可見的，保留可見狀態（不重置為 display:none）
                        const wasVisible = this._button && this._button.style.display !== 'none';
                        this._button = null;
                        this._injectionMode = null;
                        if (nativeBtn) {
                            this._injectIntoWrapper(nativeBtn);
                        } else {
                            // 原生按鈕不存在，降級至 solo 模式（若包裝容器仍存在）
                            this._injectIntoWrapperDirect();
                        }
                        // 若注入成功且按鈕先前可見，立即還原可見狀態（不等待下次 scroll 事件）
                        if (wasVisible && this._button) {
                            this._button.style.display = '';
                        }
                        this._evaluateVisibility();
                    } else if (this._injectionMode === 'wrapper-solo' && nativeBtn) {
                        // Solo → stacked 升級：原生按鈕出現，複用現有元素（不移除）以避免閃爍
                        this._transitionToStacked(this._button, nativeBtn);
                        this._evaluateVisibility();
                    } else if (this._injectionMode === 'injected' && !nativeBtn) {
                        // Stacked → solo 降級：原生按鈕消失，複用現有元素切換至 solo 模式
                        const wrapperInfo = this._locateWrapperDirect();
                        if (wrapperInfo) {
                            this._transitionToSolo(this._button, wrapperInfo.injectParent);
                        }
                        this._evaluateVisibility();
                    }
                    // 無需操作：模式與位置均正確，no-op
                }, this.WRAPPER_OBSERVER_DEBOUNCE);
            });

            this._wrapperObserver.observe(outerWrapper, {
                childList: true,
                subtree: true,
            });
        },

        /**
         * 停止包裝容器 MutationObserver 並清除去抖動計時器。
         */
        _stopWrapperObserver() {
            if (this._wrapperObserver) {
                this._wrapperObserver.disconnect();
                this._wrapperObserver = null;
            }
            clearTimeout(this._wrapperObserverTimer);
            this._wrapperObserverTimer = null;
        },
    };

    root.__DS_GoToTop_render_observer = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
