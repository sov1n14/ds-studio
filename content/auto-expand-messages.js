(function () {
    'use strict';

    /**
     * DS studio — Auto Expand Messages
     * 自動點擊收合狀態的展開按鈕，讓所有訊息預設展開。
     *
     * 設定不由本層直讀儲存區：總開關與自身開關的閘控交由 content/feature-toggle.js
     * 向 background 索取並訂閱變更。
     */
    // 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
    const __DS_AutoExpandSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const AutoExpandMessages = {
        STORAGE_KEY: StorageManager.KEYS.AUTO_EXPAND_MESSAGES,
        enabled: false,
        _observer: null,

        /** 判斷展開按鈕是否處於收合狀態（圖示帶 180° 旋轉） */
        isCollapsed(containerElement) {
            if (!containerElement) return false;
            const iconSelector = __DS_AutoExpandSelectors.EXPAND_BUTTON_ICON_SELECTOR;
            // 圖示選擇器的祖先 .ds-collapsible-text-toggle-button 位於容器之外；Chrome 的 element.querySelector 會比對範圍外祖先，happy-dom 不會，改以 matches() 逐一比對子孫讓兩者結果一致
            const icon = Array.from(containerElement.querySelectorAll('*')).find((el) => el.matches(iconSelector));
            if (!icon) return false;
            return icon.style.transform && icon.style.transform.includes('rotate(180deg)');
        },

        /** 嘗試展開單一收合按鈕 */
        tryExpandButton(el) {
            if (!el || !el.isConnected) return;
            if (el.dataset.dssAutoExpanded === '1') return;
            if (this.isCollapsed(el)) {
                el.click();
            }
            el.dataset.dssAutoExpanded = '1';
        },

        /** 掃描頁面上所有現存的展開按鈕 */
        _scanExisting() {
            const buttons = document.querySelectorAll(__DS_AutoExpandSelectors.EXPAND_BUTTON_CONTAINER_SELECTOR);
            buttons.forEach((el) => this.tryExpandButton(el));
        },

        /**
         * 找出與單一新增節點相關的展開按鈕容器（純查詢，不改動 DOM）。
         * 容器選擇器含 :has(> .ds-icon)，圖示晚於容器插入時，是既有容器因子節點新增才開始符合，故除了節點自身與子孫，也以 closest() 向上檢查祖先鏈（成本與 DOM 深度成正比）。
         */
        _findContainersForAddedNode(node) {
            const containerSelector = __DS_AutoExpandSelectors.EXPAND_BUTTON_CONTAINER_SELECTOR;
            const containers = new Set(node.querySelectorAll(containerSelector));
            const enclosingContainer = node.closest(containerSelector);
            if (enclosingContainer) containers.add(enclosingContainer);
            return containers;
        },

        /** 啟動 MutationObserver 監聽新增的展開按鈕 */
        _startObserver() {
            if (this._observer) return;
            this._observer = new MutationObserver((mutations) => {
                if (!this.enabled) return;
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;
                        this._findContainersForAddedNode(node).forEach((el) => this.tryExpandButton(el));
                    }
                }
            });
            this._observer.observe(document.body, { childList: true, subtree: true });
        },

        /** 停止 MutationObserver */
        _stopObserver() {
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
        },


        /** 收合所有已展開的訊息並清除標記 */
        _collapseAll() {
            const containers = document.querySelectorAll(__DS_AutoExpandSelectors.EXPAND_BUTTON_CONTAINER_SELECTOR);
            containers.forEach((el) => {
                if (!this.isCollapsed(el)) {
                    el.click();
                }
                delete el.dataset.dssAutoExpanded;
            });
        },

        enable() {
            this.enabled = true;
            this._scanExisting();
            this._startObserver();
        },

        /** 停用功能，收合所有已展開的訊息並清除標記 */
        disable() {
            this._collapseAll();
            this._stopObserver();
            this.enabled = false;
        },

        /**
         * 啟動：把「總開關 + 自身開關」的閘控交給共用 registerFeatureToggle，
         * 初始值與後續變更皆由 background 透過訊息提供。
         */
        start() {
            const featureToggle = globalThis.DSSFeatureToggle
                || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
            if (!featureToggle) {
                console.warn('[DSS] content/auto-expand-messages.js 需要 content/feature-toggle.js 先行載入');
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
    AutoExpandMessages.start();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoExpandMessages;
    }
})();
