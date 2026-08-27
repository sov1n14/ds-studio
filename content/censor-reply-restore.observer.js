/**
 * DS studio — CensorReplyRestore Observer Bundle
 * MutationObserver 啟停與 DOM 掃描邏輯。
 */
(function (root) {
    'use strict';

    // 共用 DOM 選擇器常數
    var __DS_ObserverSelectors = (globalThis).DSstudio?.Selectors ||
        (typeof require !== 'undefined' ? require('./ds-selectors.js') : {});

    const bundle = {
        _startObserver() {
            if (this._observer) return;
            this._observer = new MutationObserver((mutations) => {
                if (!this.enabled) return;
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this._scanNode(node);
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

        _scanNode(node) {
            const messages = node.querySelectorAll
                ? node.querySelectorAll(__DS_ObserverSelectors.MESSAGE_SELECTOR)
                : [];
            for (const msgEl of messages) {
                this._tryRestoreMessage(msgEl);
            }

            if (node.classList && node.classList.contains(__DS_ObserverSelectors.MESSAGE_CLASS)) {
                this._tryRestoreMessage(node);
                return;
            }

            // Node 既不是 .ds-message 也不包含任何 .ds-message — 檢查虛擬列表項目
            if (node.closest && messages.length === 0) {
                const virtualItem = node.closest(__DS_ObserverSelectors.VIRTUAL_ITEM_KEY_SELECTOR);
                if (virtualItem) {
                    const siblingMsg = virtualItem.querySelector(__DS_ObserverSelectors.MESSAGE_SELECTOR);
                    if (siblingMsg) {
                        this._tryRestoreMessage(siblingMsg);
                    }
                }
            }
        },

        applyToExisting() {
            const messages = document.querySelectorAll(__DS_ObserverSelectors.ASSISTANT_MESSAGE_SELECTOR);
            messages.forEach((el) => this._tryRestoreMessage(el));
            this._tryRestoreFromStoredRecords();
        },
    };

    root.__DS_CensorReplyRestore_observer = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
