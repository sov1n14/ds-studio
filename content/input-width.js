/**
 * DS studio — Input Width Adjuster
 * Controls the width of the edit input box specifically.
 */
const InputWidth = {
    STYLE_ID: 'ds-input-width-style',
    STORAGE_KEY: 'dsInputWidth',
    ENABLED_KEY: 'dsInputWidthEnabled',
    MIN: 30,
    MAX: 100,

    enabled: false,
    percent: 70,
    _masterEnabled: false,
    _chatWidthPercent: 70,
    _chatWidthEnabled: false,
    styleEl: null,
    mutationObserver: null,
    applyTimer: null,

    getEffectivePercent() {
        if (this._chatWidthEnabled && this._chatWidthPercent < this.percent) {
            return this._chatWidthPercent;
        }
        return this.percent;
    },

    getCSS(percent) {
        const vw = Math.min(Math.max(percent, this.MIN), this.MAX);
        return `
#${this.STYLE_ID} {}
._871cbca,
._871cbca .aaff8b8f,
.aaff8b8f,
._871cbca ._77cefa5._3d616d3 {
  max-width: ${vw}vw !important;
  width: min(100%, ${vw}vw) !important;
  margin-left: auto !important;
  margin-right: auto !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}`.trim();
    },

    injectStyles(percent) {
        let style = document.getElementById(this.STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = this.STYLE_ID;
            document.head.appendChild(style);
        }
        style.textContent = this.getCSS(percent);
        this.styleEl = style;
    },

    removeStyles() {
        const style = document.getElementById(this.STYLE_ID);
        if (style) style.remove();
        this.styleEl = null;
    },

    applyWidth(percent) {
        this.percent = percent;
        if (this.enabled) {
            this.injectStyles(this.getEffectivePercent());
        } else {
            this.removeStyles();
        }
    },

    setupMutationObserver() {
        if (this.mutationObserver) this.mutationObserver.disconnect();

        this.mutationObserver = new MutationObserver(() => {
            if (this.applyTimer) clearTimeout(this.applyTimer);
            this.applyTimer = setTimeout(() => {
                if (this.enabled) {
                    this.injectStyles(this.getEffectivePercent());
                }
            }, 200);
        });

        const mainArea = document.querySelector('._765a5cd') || document.body;
        this.mutationObserver.observe(mainArea, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    },

    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;

            // Master switch
            if (changes[StorageManager.KEYS.IS_ENABLED]) {
                this._masterEnabled = changes[StorageManager.KEYS.IS_ENABLED].newValue;
                if (this._masterEnabled) {
                    chrome.storage.local.get([this.ENABLED_KEY, this.STORAGE_KEY], (data) => {
                        if (data[this.ENABLED_KEY]) {
                            this.enable(data[this.STORAGE_KEY] ?? this.percent);
                        }
                    });
                } else {
                    this.disable();
                }
            }

            // Track chat-width for clamping and re-injection
            if (changes[StorageManager.KEYS.CHAT_WIDTH]) {
                this._chatWidthPercent = changes[StorageManager.KEYS.CHAT_WIDTH].newValue;
                if (this.enabled && this._chatWidthEnabled) {
                    this.applyWidth(this.percent);
                }
            }
            if (changes[StorageManager.KEYS.CHAT_WIDTH_ENABLED]) {
                this._chatWidthEnabled = changes[StorageManager.KEYS.CHAT_WIDTH_ENABLED].newValue;
                if (this.enabled) {
                    this.applyWidth(this.percent);
                }
            }

            // Own toggle
            if (changes[this.STORAGE_KEY] || changes[this.ENABLED_KEY]) {
                if (!this._masterEnabled) return;
                const enabled = changes[this.ENABLED_KEY]
                    ? changes[this.ENABLED_KEY].newValue
                    : this.enabled;
                const percent = changes[this.STORAGE_KEY]
                    ? changes[this.STORAGE_KEY].newValue
                    : this.percent;

                if (enabled) {
                    this.enable(percent);
                } else if (changes[this.ENABLED_KEY]) {
                    this.disable();
                }
            }
        });
    },

    enable(percent) {
        this.enabled = true;
        this.percent = percent || this.percent;
        this.injectStyles(this.getEffectivePercent());
        this.setupMutationObserver();
    },

    disable() {
        this.enabled = false;
        this.removeStyles();
    },

    destroy() {
        this.disable();
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        if (this.applyTimer) {
            clearTimeout(this.applyTimer);
            this.applyTimer = null;
        }
    },

    async start() {
        const data = await chrome.storage.local.get([
            this.STORAGE_KEY, this.ENABLED_KEY,
            StorageManager.KEYS.IS_ENABLED,
            StorageManager.KEYS.CHAT_WIDTH,
            StorageManager.KEYS.CHAT_WIDTH_ENABLED
        ]);
        const enabled = data[this.ENABLED_KEY] ?? false;
        const percent = data[this.STORAGE_KEY] ?? 70;
        this._masterEnabled = data[StorageManager.KEYS.IS_ENABLED] ?? false;
        this._chatWidthPercent = data[StorageManager.KEYS.CHAT_WIDTH] ?? 70;
        this._chatWidthEnabled = data[StorageManager.KEYS.CHAT_WIDTH_ENABLED] ?? false;

        this.setupStorageListener();

        if (enabled && this._masterEnabled) {
            this.enable(percent);
        }
    }
};

// Auto-start
InputWidth.start();

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InputWidth;
}
