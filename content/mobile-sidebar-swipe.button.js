/**
 * DS studio — Mobile Sidebar Swipe :: Button
 * 側邊欄切換按鈕查找與 DOM 就緒輪詢。透過 Object.assign 合入。
 */
(function (root) {
    'use strict';

    const __DS_SwipeRetryUntil = globalThis.DSSRetryUntil
        || (typeof require !== 'undefined' ? require('./retry-until.js') : null);

    const __Sel = (globalThis).DSstudio?.Selectors || {};

    const bundle = {
    _findButton() {
        // 主選擇器（開啟側邊欄按鈕）
        const primary = document.querySelector(
            `div.${__Sel.DS_BUTTON_CAPSULE_CLASS}.${__Sel.DS_BUTTON_ICON_LABEL_PRIMARY_CLASS}[role="button"]`
        );
        if (primary) return primary;

        // 降級路徑：逐一嘗試各 class 組合
        const fallbacks = [
            `.${__Sel.DS_BUTTON_CAPSULE_CLASS}.${__Sel.DS_BUTTON_ICON_LABEL_PRIMARY_CLASS}`,
            `.${__Sel.DS_BUTTON_CAPSULE_CLASS}.ds-button--icon`,
            `.${__Sel.DS_BUTTON_ICON_LABEL_PRIMARY_CLASS}.ds-button--icon`,
            `.${__Sel.DS_BUTTON_CAPSULE_CLASS}[role="button"]`,
            `.${__Sel.DS_BUTTON_XL_CLASS}[role="button"]`,
        ];
        for (const sel of fallbacks) {
            const el = document.querySelector(sel);
            if (el) return el;
        }

        return null;
    },

    /**
     * 查找關閉側邊欄按鈕。
     * 主要差異：iconLabelTertiary（關閉）vs iconLabelPrimary（開啟）。
     */
    _findCloseButton() {
        // 主選擇器：透過 :has(path[fill-rule]) 精準定位關閉按鈕（排除搜尋按鈕）
        const primary = document.querySelector(
            `div.${__Sel.DS_BUTTON_CAPSULE_CLASS}.${__Sel.DS_BUTTON_ICON_LABEL_TERTIARY_CLASS}[role="button"]:has(path[fill-rule])`
        );
        if (primary) return primary;

        // 降級路徑一：取最後一個 iconLabelTertiary 按鈕（關閉按鈕排在搜尋按鈕之後）
        const all = document.querySelectorAll(
            `div.${__Sel.DS_BUTTON_CAPSULE_CLASS}.${__Sel.DS_BUTTON_ICON_LABEL_TERTIARY_CLASS}[role="button"]`
        );
        if (all.length > 1) return all[all.length - 1];

        // 降級路徑二：備用選擇器組合
        const fallback = document.querySelector(
            `.${__Sel.DS_BUTTON_ICON_LABEL_TERTIARY_CLASS}.ds-button--icon:has(path[fill-rule])`
        );
        if (fallback) return fallback;

        return null;
    },

    /**
     * 以共用輪詢等待目標按鈕 DOM 就緒後綁定觸控事件。
     * 立即判定一次，之後每 500ms 重試，最多 60 次（≈30s）；
     * 次數用盡即靜默放棄（不拋出錯誤）。
     */
    _tryConnectDom() {
        if (!this.enabled) return;

        this._cancelDomRetry();
        this._domRetryCancel = __DS_SwipeRetryUntil(() => this._findButton(), {
            intervalMs: this.DOM_RETRY_INTERVAL_MS,
            maxRetries: this.DOM_MAX_RETRIES,
            onReady: () => this._bindTouchEvents(),
        });
    },
    };

    root.__DS_MobileSidebarSwipe_button = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
