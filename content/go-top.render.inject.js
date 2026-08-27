/**
 * DS studio — Go To Top Render :: Inject
 * 注入策略與堆疊偏移計算。透過 Object.assign 合併至 GoToTop 物件。
 */
(function (root) {
    'use strict';

    const bundle = {
        /** 計算並套用 stacked 模式的 margin-bottom，使 GoTop 恰好位於原生按鈕上方 STACK_GAP_PX px。
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
    };

    root.__DS_GoToTop_render_inject = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
