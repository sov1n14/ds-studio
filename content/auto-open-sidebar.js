(function () {
    'use strict';

    /**
     * DS studio — Auto Open Sidebar
     * 每個「收合期」點擊一次 DeepSeek 收合軌道上的「展開側邊欄」按鈕，讓側邊欄保持開啟；收合期自側欄 wrapper 取得原生收合 class 起、失去該 class 止，同一收合期內不重複點擊，下一個收合期即使 DeepSeek 重用同一軌道節點、只改寫 wrapper className 也照樣點擊。
     *
     * 迴圈保險：點擊後若 wrapper 在 1500ms 內離開又回到收合狀態且其間沒有視窗 resize（窄螢幕下 DeepSeek 會立即再收合），停止點擊直到下一次 resize。
     *
     * 可見性：窄版型（header 漢堡按鈕可見）時 DeepSeek 會在點開後約 0.5–1.2 秒自行收回側欄，且軌道按鈕仍可見，因此改以漢堡按鈕可見作為「行動版型、不點擊」的判斷。
     *
     * 觸發：DeepSeek 的 React onClick 可能檢查 nativeEvent.isTrusted，故不呼叫 button.click()，改在按鈕上派送冒泡的 dss:react-click 事件，由 MAIN world 的 content/react-click-bridge.main.js 呼叫 React onClick（無 React handler 時由 bridge 退回 el.click()）。
     * 設定不由本層直讀儲存區：總開關與自身開關的閘控交由 content/feature-toggle.js 向 background 索取並訂閱變更。
     */
    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const __DS_AutoOpenSidebarSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    // 自身開關的儲存鍵（utils/storage-manager.keys.js 尚未收錄時於此具名宣告，避免散落字面字串）
    const AUTO_OPEN_SIDEBAR_KEY = 'isAutoOpenSidebarEnabled';

    // 點擊後在此時間內再收合且無 resize，視為頁面自行收合的迴圈
    const RECOLLAPSE_LOOP_WINDOW_MS = 1500;

    const AutoOpenSidebar = {
        STORAGE_KEY: AUTO_OPEN_SIDEBAR_KEY,
        isEnabled: false,
        _observer: null,
        _onResize: null,
        _hasClickedThisEpisode: false,
        _isSuppressedUntilResize: false,
        _lastClickAt: 0,

        /** 重設收合期與迴圈保險狀態 */
        _resetEpisodeState() {
            this._hasClickedThisEpisode = false;
            this._isSuppressedUntilResize = false;
            this._lastClickAt = 0;
        },

        /** 側欄 wrapper 是否處於 DeepSeek 原生收合狀態 */
        _isNativelyCollapsed() {
            const [wrapper] = document.querySelectorAll(__DS_AutoOpenSidebarSelectors.SIDEBAR_WRAPPER_SELECTOR);
            return !!wrapper && wrapper.classList.contains(__DS_AutoOpenSidebarSelectors.SIDEBAR_NATIVE_COLLAPSED_CLASS);
        },

        /** 依收合期狀態決定是否點擊展開按鈕 */
        _scanExisting() {
            if (!this._isNativelyCollapsed()) {
                this._hasClickedThisEpisode = false;
                return;
            }
            if (this._hasClickedThisEpisode) return;
            if (this._isSuppressedUntilResize) return;

            // 窄版型漢堡按鈕可見時不點擊，也不消耗本收合期；無 checkVisibility 的環境不阻擋
            const hamburger = document.querySelector(__DS_AutoOpenSidebarSelectors.SIDEBAR_HAMBURGER_BUTTON_SELECTOR);
            if (hamburger && typeof hamburger.checkVisibility === 'function' && hamburger.checkVisibility()) return;

            const [button] = document.querySelectorAll(__DS_AutoOpenSidebarSelectors.SIDEBAR_OPEN_BUTTON_SELECTOR);
            if (!button) return;

            const now = Date.now();
            if (this._lastClickAt && now - this._lastClickAt < RECOLLAPSE_LOOP_WINDOW_MS) {
                this._isSuppressedUntilResize = true;
                return;
            }
            this._hasClickedThisEpisode = true;
            this._lastClickAt = now;
            // 事件名稱與 content/react-click-bridge.main.js 一致（跨 world 無共用載入器）
            button.dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true }));
        },

        /** 啟動 MutationObserver；圖示 path 可能晚於按鈕節點插入、收合僅改寫 wrapper class，故每批變更皆整頁重掃 */
        _startObserver() {
            if (this._observer) return;
            this._observer = new MutationObserver(() => {
                if (!this.isEnabled) return;
                try {
                    this._scanExisting();
                } catch (err) {
                    console.error('[DSS] auto-open-sidebar:', err);
                }
            });
            this._observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        },

        /** 停止 MutationObserver */
        _stopObserver() {
            if (!this._observer) return;
            this._observer.disconnect();
            this._observer = null;
        },

        /** 註冊視窗 resize 監聽：resize 解除迴圈保險 */
        _startResizeListener() {
            if (this._onResize) return;
            this._onResize = () => {
                this._isSuppressedUntilResize = false;
                this._lastClickAt = 0;
            };
            window.addEventListener('resize', this._onResize);
        },

        /** 移除視窗 resize 監聽 */
        _stopResizeListener() {
            if (!this._onResize) return;
            window.removeEventListener('resize', this._onResize);
            this._onResize = null;
        },

        enable() {
            this.isEnabled = true;
            this._resetEpisodeState();
            this._startResizeListener();
            this._scanExisting();
            this._startObserver();
        },

        disable() {
            this._stopObserver();
            this._stopResizeListener();
            this._resetEpisodeState();
            this.isEnabled = false;
        },

        /**
         * 啟動：把「總開關 + 自身開關」的閘控交給共用 registerFeatureToggle，
         * 初始值與後續變更皆由 background 透過訊息提供。
         */
        start() {
            const featureToggle = globalThis.DSSFeatureToggle
                || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
            if (!featureToggle) {
                console.warn('[DSS] content/auto-open-sidebar.js 需要 content/feature-toggle.js 先行載入');
                return;
            }

            featureToggle.registerFeatureToggle({
                ownKey: this.STORAGE_KEY,
                onEnable: () => this.enable(),
                onDisable: () => this.disable(),
            });
        }
    };

    // Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
    AutoOpenSidebar.start();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoOpenSidebar;
    }

    // 透過 window.DSstudio 供同層模組存取
    if (typeof window !== 'undefined') {
        window.DSstudio = window.DSstudio || {};
        window.DSstudio.AutoOpenSidebar = AutoOpenSidebar;
    }
})();
