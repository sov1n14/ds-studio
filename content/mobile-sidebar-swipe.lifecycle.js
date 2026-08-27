/**
 * DS studio — Mobile Sidebar Swipe :: Lifecycle
 * 生命週期方法。透過 Object.assign 合入。
 */
(function (root) {
    'use strict';

    const __DS_SwipeMobileDevice = globalThis.DSSMobileDevice
        || (typeof require !== 'undefined' ? require('./mobile-device.js') : null);
    const __DS_SwipeFeatureToggle = globalThis.DSSFeatureToggle
        || (typeof require !== 'undefined' ? require('./feature-toggle.js') : null);

    const bundle = {
    enable() {
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;
        if (this.enabled) return;
        this.enabled = true;

        this._tryConnectDom();
    },

    /**
     * Disable the swipe gesture: unbind all touch listeners,
     * clear all timers, and reset gesture tracking state.
     */
    disable() {
        if (!this.enabled) return;
        this.enabled = false;

        this._unbindTouchEvents();
        this._cancelDomRetry();
        this._resetSwipeState();
    },

    /**
     * Full cleanup: disable the module and remove all listeners.
     */
    destroy() {
        this.disable();
        if (this._unregisterToggle) {
            this._unregisterToggle();
            this._unregisterToggle = null;
        }
    },

    /**
     * 初始化模組：確認為行動裝置後，將主開關閘控交給共用管線。
     */
    start() {
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;

        this._unregisterToggle = __DS_SwipeFeatureToggle.registerFeatureToggle({
            onEnable: () => this.enable(),
            onDisable: () => this.disable(),
        });
    },

    // ─────────────────────────────
    //  Private: Internal helpers
    // ─────────────────────────────

    /**
     * 取消進行中的 DOM 就緒輪詢（可重複呼叫）。
     */
    _cancelDomRetry() {
        if (!this._domRetryCancel) return;
        this._domRetryCancel();
        this._domRetryCancel = null;
    },

    /**
     * 重設手勢追蹤狀態。
     */
    _resetSwipeState() {
        this._startPoint = null;
        this._startTime = null;
        this._deltaX = 0;
        this._deltaY = 0;
    }
    };

    root.__DS_MobileSidebarSwipe_lifecycle = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
