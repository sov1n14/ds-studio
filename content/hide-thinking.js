/**
 * DS studio — Hide Thinking Process
 * Auto-collapses expanded thinking blocks by clicking the header element.
 *
 * 設定不由本層直讀儲存區：總開關與自身開關的閘控交由 content/feature-toggle.js
 * 向 background 索取並訂閱變更。
 */
// 共用 DOM 選擇器常數（瀏覽器：由 content/ds-selectors.js 於前載入設定 window.DSstudio；Node.js 測試：直接 require）
// Stryker disable next-line all: equivalent mutant — conditional require always resolves in Node test env
const __DS_HideThinkingSelectors = (globalThis).DSstudio?.Selectors ||
    (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

const HideThinking = {
    STORAGE_KEY: StorageManager.KEYS.HIDE_THINKING,
    // 結構式選擇器（可能含 :has()），以 querySelector / closest 比對，不可當 class 名使用
    CONTAINER_SELECTOR: __DS_HideThinkingSelectors.THINK_BLOCK_SELECTOR,
    HEADER_SELECTOR: __DS_HideThinkingSelectors.THINK_HEADER_TOGGLE_SELECTOR,
    THINK_CONTENT_SELECTOR: __DS_HideThinkingSelectors.THINK_CONTENT_SELECTOR,
    DATA_ATTR: 'data-ht-collapsed',

    enabled: false,
    _observer: null,

    isExpanded(containerEl) {
        if (!containerEl || !containerEl.classList) return false;
        return !!containerEl.querySelector(this.THINK_CONTENT_SELECTOR);
    },

    /**
     * 取得思考區塊的可點擊標頭（區塊的直接子節點）。
     * 以 children + matches 比對而非 el.querySelector：標頭選擇器以位於 el 之外的 .ds-message 祖先為錨點，部分 DOM 實作（happy-dom）的 querySelector 不比對範圍外的祖先。
     */
    _findHeader(blockEl) {
        return Array.from(blockEl.children).find((child) => child.matches(this.HEADER_SELECTOR)) || null;
    },

    tryCollapseButton(el) {
        if (!el || !el.isConnected) return;
        if (el.dataset.htCollapsed === '1') return;
        if (!this.isExpanded(el)) return;
        const header = this._findHeader(el);
        if (!header) return;
        el.dataset.htCollapsed = '1';
        header.click();
    },

    scanRoot(root) {
        if (!(root instanceof Element)) return;
        // closest 涵蓋 root 本身與其祖先：結構式選擇器含 :has()，標頭晚於容器插入時既有的祖先容器才開始符合，須由新增節點往上找回該容器
        // 僅在 root 為區塊本身或其標頭時處理：標頭到位才是區塊「首次出現」；使用者展開時重新掛載的內容節點不含標頭，不得觸發收合
        const enclosingBlock = root.closest(this.CONTAINER_SELECTOR);
        if (enclosingBlock && root.contains(this._findHeader(enclosingBlock))) {
            this.tryCollapseButton(enclosingBlock);
        }
        root.querySelectorAll(this.CONTAINER_SELECTOR).forEach((el) => {
            this.tryCollapseButton(el);
        });
    },

    applyToExisting() {
        const blocks = document.querySelectorAll(this.CONTAINER_SELECTOR);
        blocks.forEach((el) => this.tryCollapseButton(el));
    },

    restoreAll() {
        document.querySelectorAll('[' + this.DATA_ATTR + ']').forEach((el) => {
            // 先移除標記，使該區塊不再被追蹤
            el.removeAttribute(this.DATA_ATTR);
            if (!el.isConnected) return;
            const header = this._findHeader(el);
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
        // Stryker disable all: unreachable in tests — module auto-starts at load time, featureToggle always present
        const featureToggle = globalThis.DSSFeatureToggle
            || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);
        if (!featureToggle) {
            throw new Error('content/hide-thinking.js 需要 content/feature-toggle.js 先行載入');
        }
        // Stryker restore all

        featureToggle.registerFeatureToggle({
            ownKey: this.STORAGE_KEY,
            onEnable: () => this.enable(),
            onDisable: () => this.disable(),
        });
    }
};

// Auto-start：入口檔的刻意啟動點（模組本身無其他載入期副作用）
HideThinking.start();

// Stryker disable all: equivalent mutants — module type check is environment-dependent, untestable in Node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HideThinking;
}
// Stryker restore all
