/**
 * DS studio — Go To Top
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
    //  Private: Query helpers
    // ─────────────────────────────

    /**
     * Attempt each CSS selector in order and return the first match.
     * 只有在首次成功解析到 DOM 後（_hasSeenDom = true）才累積失敗計數，
     * 避免在頁面初始化期間 DOM 尚未掛載時誤判為降級模式。
     * @param {string[]} selectors - Array of CSS selector strings
     * @returns {Element|null}
     */
    _querySelectorWithFallback(selectors) {
        if (!selectors || selectors.length === 0) return null;

        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                // 首次成功找到元素，啟動降級計數追蹤
                this._hasSeenDom = true;
                this._missCount = 0;
                return el;
            }
        }

        // 尚未首次見到 DOM（頁面尚未完成掛載）時不計入失敗，避免假性降級
        if (!this._hasSeenDom) return null;

        this._missCount += 1;
        if (this._missCount >= this.DEGRADED_THRESHOLD && !this._degraded) {
            this._degraded = true;
        }
        return null;
    },

    /**
     * Walk up from anchor to find the scrollable container.
     * 以三段策略定位訊息列表的滾動容器，避免抓到側邊欄的 .ds-scroll-area。
     *
     * confirmed in full-page.html line 239: ._765a5cd.ds-scroll-area 包含 line 323 的虛擬列表。
     *
     * @param {Element} anchor - Starting DOM node
     * @returns {Element}
     */
    _findScrollContainer(anchor) {
        // 策略 1：從 anchor 向上走，找到最近的 .ds-scroll-area 且具備可滾動高度
        if (anchor) {
            let el = anchor.parentElement;
            while (el && el !== document.body) {
                if (el.classList.contains('ds-scroll-area') &&
                    el.scrollHeight > el.clientHeight) {
                    this._scrollContainer = el;
                    return el;
                }
                el = el.parentElement;
            }
        }

        // 策略 2：從虛擬列表容器向上找
        const virtualList = document.querySelector(this.VIRTUAL_LIST_SELECTOR) ||
                            document.querySelector(this.VIRTUAL_LIST_FALLBACK);
        if (virtualList) {
            let el = virtualList.parentElement;
            while (el && el !== document.body) {
                if (el.classList.contains('ds-scroll-area') &&
                    el.scrollHeight > el.clientHeight) {
                    this._scrollContainer = el;
                    return el;
                }
                el = el.parentElement;
            }
        }

        // 策略 3：從 anchor 向上探測具有 overflow:auto/scroll 的元素
        if (anchor && anchor.parentElement) {
            let el = anchor.parentElement;
            while (el && el !== document.body) {
                const style = getComputedStyle(el);
                const overflowY = style.overflowY;
                if ((overflowY === 'auto' || overflowY === 'scroll') &&
                    el.scrollHeight > el.clientHeight) {
                    this._scrollContainer = el;
                    return el;
                }
                el = el.parentElement;
            }
        }

        // 策略 4：最後回退到 document.scrollingElement
        return document.scrollingElement || document.documentElement;
    },

    /**
     * @returns {Element|null} The conversation-start anchor node.
     */
    _getAnchor() {
        return this._querySelectorWithFallback([
            this.ANCHOR_SELECTOR,
            this.ANCHOR_SELECTOR_FALLBACK1,
            this.ANCHOR_SELECTOR_FALLBACK2,
            this.FIRST_MSG_SELECTOR,
        ]);
    },

    /**
     * @returns {Element|null} The first message element in DOM.
     */
    _getFirstMessage() {
        return this._querySelectorWithFallback([
            this.FIRST_MSG_SELECTOR,
            '[class*="ds-message"]',
        ]);
    },

    /**
     * @returns {Element|null} The native go-bottom button if it exists.
     */
    _getNativeButton() {
        // 主選擇器：以雜湊 class _0706cde 精確匹配，排除自身注入的按鈕
        // 降級鏈：依穩定 ds-* class 組合依序嘗試
        const result = this._querySelectorWithFallback([
            this.NATIVE_BTN_SELECTOR,
            '.aaff8b8f .ds-button--floating.ds-button--circle:not(.dsw-gotop)',
            '.aaff8b8f [role="button"].ds-button--floating.ds-button--circle:not(.dsw-gotop)',
            '.aaff8b8f [role="button"].ds-button--floating[class*="ds-button--circle"]:not(.dsw-gotop)',
        ]);
        if (!result) return null;

        // 後驗證：若匹配來自降級選擇器（非 _0706cde），
        // 確認元素確實為 floating 按鈕，而非 primary/filled/disabled 按鈕
        if (!result.classList.contains('_0706cde')) {
            if (!result.classList.contains('ds-button--floating') ||
                result.classList.contains('ds-button--primary') ||
                result.classList.contains('ds-button--filled') ||
                result.classList.contains('ds-button--disabled')) {
                return null;
            }
        }

        return result;
    },

    /**
     * 從原生按鈕結構上找到注入用的直接父層容器。
     * 結構定位策略（不依賴雜湊 class）：
     *   nativeBtn.parentElement → aaff8b8f（直接父層，full-page.html line 1015）
     * 若 parentElement 不存在，回傳 null。
     * @param {Element} nativeBtn
     * @returns {{ injectParent: Element, outerWrapper: Element }|null}
     */
    _locateWrapperElements(nativeBtn) {
        if (!nativeBtn) return null;

        // 直接父層即為注入點（aaff8b8f，full-page.html line 1015）
        const injectParent = nativeBtn.parentElement;
        if (!injectParent) {
            return null;
        }

        // 外層包裝（_871cbca，full-page.html line 1013）供 wrapperObserver 監控
        const outerWrapper = injectParent.parentElement || injectParent;

        return { injectParent, outerWrapper };
    },

    /**
     * Locate { injectParent, outerWrapper } directly from DOM without relying on the native button.
     * @returns {{ injectParent: Element, outerWrapper: Element }|null}
     */
    _locateWrapperDirect() {
        const injectParent = document.querySelector(this.INJECT_PARENT_SELECTOR)
            || document.querySelector(this.INJECT_PARENT_FALLBACK);
        if (!injectParent) {
            return null;
        }
        const outerWrapper = document.querySelector(this.OUTER_WRAPPER_SELECTOR)
            || injectParent.parentElement
            || injectParent;
        return { injectParent, outerWrapper };
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

    // ─────────────────────────────
    //  Private: Check at-top state
    // ─────────────────────────────

    /**
     * 判斷是否可驗證地到達對話最頂部。
     *
     * 嚴格策略（避免虛擬列表在中間某條訊息掛載時誤判為到頂）：
     *   1. scrollTop === 0（或 ≤ 1px epsilon）→ 確認到頂，直接回傳 true。
     *   2. 錨點檢查僅在錨點「可驗證為第一則訊息」時有效——
     *      即錨點同時符合 ANCHOR_SELECTOR_FALLBACK2（data-virtual-list-item-key="1"）。
     *      若無可驗證錨點，答案為「尚未到頂」（除非 scrollTop === 0）。
     *
     * 此函式也被 _evaluateVisibility 的隱藏條件使用；
     * 更嚴格的判斷表示「只有真正到頂才隱藏按鈕」，符合期望行為。
     *
     * @returns {boolean}
     */
    _isAtTop() {
        // 條件 1：滾動容器已確實滾至最頂（允許 1px 誤差以防瀏覽器次像素捨入）
        const container = this._scrollContainer;
        if (container && container.scrollTop <= 1) {
            return true;
        }

        // 條件 2：可驗證的第一則訊息錨點已進入視窗
        // 僅信任帶有 data-virtual-list-item-key="1" 的元素，
        // 排除「第一個已掛載訊息」這類模糊選擇器，避免虛擬列表半途掛載時誤判
        const verifiableAnchor = document.querySelector(this.ANCHOR_SELECTOR_FALLBACK2);
        if (verifiableAnchor) {
            const rect = verifiableAnchor.getBoundingClientRect();
            const vpHeight = window.innerHeight;
            // 長訊息回退：錨點高度超過視窗時，僅檢查頂部進入視窗即可
            if (rect.height > vpHeight) {
                if (rect.top >= 0) return true;
            } else if (rect.top >= 0 && rect.bottom <= vpHeight) {
                return true;
            }
        }

        return false;
    },

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

        // 點擊：滾動到頂部
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
    //  Private: Visibility
    // ─────────────────────────────

    /**
     * Evaluate whether the go-top button should be visible.
     * Applies hysteresis to avoid flickering.
     */
    _evaluateVisibility() {
        if (!this.enabled || !this._masterEnabled) {
            return;
        }
        if (!this._button) {
            return;
        }

        const firstMsg = this._getFirstMessage();
        const isShowCondition = firstMsg && firstMsg.getBoundingClientRect().bottom < 0;
        const isHideCondition = this._isAtTop();

        if (isShowCondition) {
            this._button.style.display = '';
        } else if (isHideCondition) {
            this._button.style.display = 'none';
        }
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

    _stopWrapperObserver() {
        if (this._wrapperObserver) {
            this._wrapperObserver.disconnect();
            this._wrapperObserver = null;
        }
        clearTimeout(this._wrapperObserverTimer);
        this._wrapperObserverTimer = null;
    },

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

// Auto-start
GoToTop.init();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoToTop;
}

// Expose on window for content-script.js cross-module access
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.GoToTop = GoToTop;
}
