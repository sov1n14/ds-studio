/**
 * DS studio — Hide Thinking Process
 * Auto-collapses expanded thinking blocks by clicking the header element.
 *
 * 設定不由本層直讀儲存區：總開關與自身開關的閘控交由 content/feature-toggle.js
 * 向 background 索取並訂閱變更。
 */
// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
const __DS_HideThinkingSelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

const HideThinking = {
    STORAGE_KEY: StorageManager.KEYS.HIDE_THINKING,
    CONTAINER_CLASS: '_74c0879',
    HEADER_CLASS: '_245c867',
    THINK_CONTENT_CLASS: __DS_HideThinkingSelectors.THINK_CONTENT_CLASS,
    DATA_ATTR: 'data-ht-collapsed',

    enabled: false,
    _observer: null,

    isExpanded(containerEl) {
        if (!containerEl || !containerEl.classList) return false;
        return !!containerEl.querySelector('.' + this.THINK_CONTENT_CLASS);
    },

    tryCollapseButton(el) {
        if (!el || !el.isConnected) return;
        if (el.dataset.htCollapsed === '1') return;
        if (!this.isExpanded(el)) return;
        const header = el.querySelector('.' + this.HEADER_CLASS);
        if (!header) return;
        el.dataset.htCollapsed = '1';
        header.click();
    },

    scanRoot(root) {
        if (!(root instanceof Element)) return;
        if (root.classList && root.classList.contains(this.CONTAINER_CLASS)) {
            this.tryCollapseButton(root);
        }
        root.querySelectorAll('.' + this.CONTAINER_CLASS).forEach((el) => {
            this.tryCollapseButton(el);
        });
    },

    applyToExisting() {
        const blocks = document.querySelectorAll('.' + this.CONTAINER_CLASS);
        blocks.forEach((el) => this.tryCollapseButton(el));
    },

    restoreAll() {
        document.querySelectorAll('[' + this.DATA_ATTR + ']').forEach((el) => {
            // 先移除標記，使該區塊不再被追蹤
            el.removeAttribute(this.DATA_ATTR);
            if (!el.isConnected) return;
            const header = el.querySelector('.' + this.HEADER_CLASS);
            if (header) header.click();
        });
    },

    _startObserver() {
        if (this._observer) return;
        this._observer = new MutationObserver((mutations) => {
            if (!this.enabled) return;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.scanRoot(node);
                    }
                }
            }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
    },

    _stopObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    },

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.applyToExisting();
        this._startObserver();
    },

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.restoreAll();
        this._stopObserver();
    },

    /**
     * 啟動：把「總開關 + 自身開關」的閘控交給共用 registerFeatureToggle，
     * 初始值與後續變更皆由 background 透過訊息提供。
     */
    start() {
        const featureToggle = globalThis.DSSFeatureToggle
            || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
        if (!featureToggle) {
            throw new Error('content/hide-thinking.js 需要 content/feature-toggle.js 先行載入');
        }

        featureToggle.registerFeatureToggle({
            ownKey: this.STORAGE_KEY,
            onEnable: () => this.enable(),
            onDisable: () => this.disable(),
        });
    }
};

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
HideThinking.start();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = HideThinking;
}
