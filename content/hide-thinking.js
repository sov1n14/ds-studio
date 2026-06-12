/**
 * DS studio — Hide Thinking Process
 * Auto-collapses expanded thinking blocks by clicking the header element.
 */
const HideThinking = {
    STORAGE_KEY: 'dsHideThinking',
    CONTAINER_CLASS: '_74c0879',
    HEADER_CLASS: '_245c867',
    THINK_CONTENT_CLASS: 'ds-think-content',
    DATA_ATTR: 'data-ht-collapsed',

    enabled: false,
    _masterEnabled: false,
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

    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            if (changes[StorageManager.KEYS.IS_ENABLED]) {
                this._masterEnabled = changes[StorageManager.KEYS.IS_ENABLED].newValue;
                if (this._masterEnabled) {
                    chrome.storage.local.get([this.STORAGE_KEY], (data) => {
                        if (data[this.STORAGE_KEY]) this.enable();
                    });
                } else {
                    this.disable();
                }
            }

            if (changes[this.STORAGE_KEY]) {
                if (!this._masterEnabled) return;
                if (changes[this.STORAGE_KEY].newValue) {
                    this.enable();
                } else {
                    this.disable();
                }
            }
        });
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

    async start() {
        const data = await chrome.storage.local.get([
            this.STORAGE_KEY,
            StorageManager.KEYS.IS_ENABLED
        ]);
        const hideThinking = data[this.STORAGE_KEY] ?? false;
        this._masterEnabled = data[StorageManager.KEYS.IS_ENABLED] ?? false;

        this.setupStorageListener();

        if (hideThinking && this._masterEnabled) {
            this.enable();
        }
    }
};

HideThinking.start();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = HideThinking;
}
