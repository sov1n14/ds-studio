/**
 * DS studio — Mobile Sidebar Swipe :: Button
 * 側邊欄切換按鈕查找與 DOM 就緒輪詢。透過 Object.assign 合入。
 */
(function (root) {
    'use strict';

    const __DS_SwipeRetryUntil = globalThis.DSSRetryUntil
        || (typeof require !== 'undefined' ? require('./retry-until.js') : null);

    const bundle = {
    _findButton() {
        // 主選擇器（from sidebar-buttom.html）
        const primary = document.querySelector(
            'div.ds-button--capsule.ds-button--iconLabelPrimary[role="button"]'
        );
        if (primary) return primary;

        // 降級路徑：逐一嘗試各 class 組合
        const fallbacks = [
            '.ds-button--capsule.ds-button--iconLabelPrimary',
            '.ds-button--capsule.ds-button--icon',
            '.ds-button--iconLabelPrimary.ds-button--icon',
            '.ds-button--capsule[role="button"]',
            '.ds-button--xl[role="button"]',
        ];
        for (const sel of fallbacks) {
            const el = document.querySelector(sel);
            if (el) return el;
        }

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
