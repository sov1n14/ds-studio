/**
 * DS studio — Go To Top Render Bundle
 * 按鈕建構、SVG 圖示、注入策略、堆疊偏移計算、包裝容器 Observer 與模式切換。
 * 透過 Object.assign 合併至 GoToTop 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    const bundle = {
        // ─────────────────────────────
        //  Private: Rendering & injection
        // ─────────────────────────────

        /**
         * 回傳向上箭頭 SVG 標記（將原生向下箭頭以 scaleY(-1) 翻轉）。
         * @returns {string}
         */
        _iconSvg() {
            return [
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"',
                ' xmlns="http://www.w3.org/2000/svg" style="transform:scaleY(-1);">',
                '<path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137',
                'C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785',
                'C7.79912 9.46883 7.55595 9.61756 7.25 9.66602',
                'C7.08435 9.69222 6.91565 9.69222 6.75 9.66602',
                'C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785',
                'C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137',
                'L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617',
                'L6.15137 7.80273',
                'C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623',
                'C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047',
                'C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047',
                'C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623',
                'C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273',
                'L10.5762 5.07617L11 4.65137L11.8486 5.5Z" fill="currentColor"/>',
                '</svg>',
            ].join('');
        },

        /**
         * 建立 GoTop 按鈕 DOM 元素（不附加到文件）。
         *
         * 主路徑：直接 clone 原生按鈕，移除雜湊 class _0706cde 後複用；
         * 降級路徑：依 NATIVE_BTN_TAG / NATIVE_BTN_CLASSES / NATIVE_BTN_INLINE_STYLE
         *           手工建構與原生按鈕結構相同的 div 元素。
         *
         * 兩條路徑均：
         *   1. 加上識別 class dsw-gotop
         *   2. 設定 role/tabindex/aria 屬性
         *   3. 將圖示子節點的 innerHTML 替換為翻轉的向上箭頭 SVG
         *
         * @param {Element|null} nativeBtn - 原生 go-bottom 按鈕（可為 null）
         * @returns {Element}
         */
        _createButtonElement(nativeBtn) {
            let btn;

            if (nativeBtn) {
                // 主路徑：clone 原生按鈕，移除定位雜湊 class，保留所有 ds-* class
                btn = nativeBtn.cloneNode(true);
                btn.classList.remove('_0706cde');
            } else {
                // 降級路徑：手工建構與原生相同結構的按鈕元素
                btn = document.createElement(this.NATIVE_BTN_TAG);
                btn.className = this.NATIVE_BTN_CLASSES;
                btn.setAttribute('style', this.NATIVE_BTN_INLINE_STYLE);

                // 建構三個子節點（與 go-bottom.html 原生結構一致）
                const bg = document.createElement('div');
                bg.className = 'ds-button__background';
                const border = document.createElement('div');
                border.className = 'ds-button__border';
                const icon = document.createElement('div');
                icon.className = 'ds-button__icon ds-button__icon--last-child';
                btn.appendChild(bg);
                btn.appendChild(border);
                btn.appendChild(icon);
            }

            // 兩條路徑共用：識別 class + 語意屬性
            btn.classList.add('dsw-gotop');
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');
            btn.setAttribute('aria-disabled', 'false');
            btn.setAttribute('aria-label', '回到頂部');

            // 替換圖示子節點的 innerHTML 為翻轉向上箭頭
            // 防禦性處理：若 clone 後圖示節點不存在，補建一個
            let iconEl = btn.querySelector('.ds-button__icon');
            if (!iconEl) {
                iconEl = document.createElement('div');
                iconEl.className = 'ds-button__icon ds-button__icon--last-child';
                btn.appendChild(iconEl);
            }
            iconEl.innerHTML = this._iconSvg();

            // 點擊：滾動到頂部（scrollToTopAndWait 由 go-top.scroll.js 合併進來）
            btn.addEventListener('click', () => {
                this.scrollToTopAndWait();
            });

            // 鍵盤支援：Enter / Space
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.scrollToTopAndWait();
                }
            });

            return btn;
        },

        /**
         * 計算並套用 stacked 模式的 margin-bottom，使 GoTop 恰好位於原生按鈕上方 STACK_GAP_PX px。
         * 以原生按鈕的實際幾何（marginBottom + offsetHeight）動態計算，適應網站版面變化。
         * 同時鏡像原生按鈕的 right 值（若可解析），否則由 CSS 預設值 12px 生效。
         * @param {HTMLButtonElement} btn - 待定位的 GoTop 按鈕
         * @param {Element} nativeBtn - 原生 go-bottom 按鈕
         */
        _applyStackedOffset(btn, nativeBtn) {
            const nativeStyle = getComputedStyle(nativeBtn);
            const nativeMarginBottom = parseFloat(nativeStyle.marginBottom) || 20;
            // 原生按鈕新尺寸為 34px（ds-button--m 圓形），降級值同步更新
            const nativeHeight = nativeBtn.offsetHeight || 34;
            btn.style.marginBottom = `${nativeMarginBottom + nativeHeight + this.STACK_GAP_PX}px`;

            // 鏡像原生按鈕的 right 值（讓佈局與原生一致，若無法解析則由 CSS 預設 12px 生效）
            const nativeRight = parseFloat(nativeStyle.right);
            if (!isNaN(nativeRight)) {
                btn.style.right = `${nativeRight}px`;
            }
        },

        /**
         * 主路徑：將 GoTop 按鈕注入原生按鈕包裝容器，以 insertBefore 定位在原生按鈕上方。
         * 注入位置：nativeBtn.parentElement（aaff8b8f，full-page.html line 1015），
         * 使用 insertBefore(btn, nativeBtn) 使 GoTop 出現在原生按鈕前面（視覺上方）。
         *
         * 去重保護：注入前先檢查容器內是否已有 .dsw-gotop，避免重複注入。
         *
         * @param {Element} nativeBtn
         * @returns {boolean} 是否成功注入
         */
        _injectIntoWrapper(nativeBtn) {
            const wrapperInfo = this._locateWrapperElements(nativeBtn);
            if (!wrapperInfo) {
                return false;
            }

            const { injectParent, outerWrapper } = wrapperInfo;

            // 去重保護：若已有按鈕就不重複注入；若為 solo 殘留，升級為 stacked 模式（複用元素，不移除）
            const existingBtn = injectParent.querySelector('.dsw-gotop');
            if (existingBtn) {
                if (existingBtn.classList.contains('dsw-gotop--solo')) {
                    // solo → stacked 升級：複用現有元素（不 remove）以避免閃爍
                    this._button = existingBtn;
                    this._transitionToStacked(existingBtn, nativeBtn);
                }
                return true;
            }

            const btn = this._createButtonElement(nativeBtn);
            // stacked 模式：絕對定位，動態計算 margin-bottom 以確保 8px 間距
            btn.classList.add('dsw-gotop--stacked');
            this._applyStackedOffset(btn, nativeBtn);
            // 初始狀態隱藏（由 _evaluateVisibility 控制顯示）
            btn.style.display = 'none';

            // insertBefore 使 GoTop 出現在原生按鈕上方（視覺層面）
            injectParent.insertBefore(btn, nativeBtn);
            this._button = btn;
            this._injectionMode = 'injected';

            // 啟動包裝容器監控，應對 React re-render 移除節點的情況
            this._startWrapperObserver(outerWrapper);

            return true;
        },

        /**
         * Solo path: inject GoTop into wrapper container when native button is absent.
         * Button uses dsw-gotop--solo class; positioning and appearance provided by CSS.
         * @returns {boolean}
         */
        _injectIntoWrapperDirect() {
            const wrapperInfo = this._locateWrapperDirect();
            if (!wrapperInfo) {
                return false;
            }

            const { injectParent, outerWrapper } = wrapperInfo;

            if (injectParent.querySelector('.dsw-gotop')) {
                return true;
            }

            const btn = this._createButtonElement(null);
            // _createButtonElement 已設定 ds-* class + dsw-gotop，只需追加 modifier
            // 不覆蓋 className，保留 ds-* class 以重現圓形外觀
            btn.classList.add('dsw-gotop--solo');
            btn.style.display = 'none';

            injectParent.insertBefore(btn, injectParent.firstChild);
            this._button = btn;
            this._injectionMode = 'wrapper-solo';

            this._startWrapperObserver(outerWrapper);

            return true;
        },

        /**
         * 嘗試將按鈕注入包裝容器。
         * 若原生按鈕與包裝容器均找不到，直接返回（不建立任何按鈕）。
         * 此函式在 enable() 及路由切換後的重連流程中呼叫。
         * @returns {boolean} 是否成功注入
         */
        _injectButton() {
            // 若按鈕已在 DOM 中，不重複注入
            if (this._button && this._button.isConnected) {
                return true;
            }

            // 若有孤立的舊按鈕，先清除
            if (this._button && !this._button.isConnected) {
                this._button = null;
                this._injectionMode = null;
            }

            // 路徑 1：原生按鈕存在 → stacked 模式注入至原生按鈕前（8px 間距）
            const nativeBtn = this._getNativeButton();
            if (nativeBtn) {
                const isInjected = this._injectIntoWrapper(nativeBtn);
                if (isInjected) return true;
            }

            // 路徑 2：原生按鈕不存在但包裝容器存在 → solo 模式
            const isDirectInjected = this._injectIntoWrapperDirect();
            if (isDirectInjected) return true;

            // 路徑 1 與 2 均失敗：包裝容器尚未掛載，放棄注入（不建立按鈕）
            return false;
        },

        // ─────────────────────────────
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

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    root.__DS_GoToTop_render = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
