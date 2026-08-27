/**
 * DS studio — Mobile Sidebar Swipe :: Bind
 * 觸控事件綁定與解除。透過 Object.assign 合入。
 */
(function (root) {
    'use strict';

    const bundle = {
    _bindTouchEvents() {
        if (this._isTouchBound) return;

        this._touchStartHandler = (e) => this._onTouchStart(e);
        this._touchMoveHandler = (e) => this._onTouchMove(e);
        this._touchEndHandler = () => this._onTouchEnd();

        document.addEventListener('touchstart', this._touchStartHandler, { passive: false });
        document.addEventListener('touchmove', this._touchMoveHandler, { passive: true });
        document.addEventListener('touchend', this._touchEndHandler, { passive: true });

        this._isTouchBound = true;
    },

    /**
     * 解除所有觸控事件監聽器並重設綁定狀態。
     */
    _unbindTouchEvents() {
        if (!this._isTouchBound) return;

        if (this._touchStartHandler) {
            document.removeEventListener('touchstart', this._touchStartHandler);
            this._touchStartHandler = null;
        }
        if (this._touchMoveHandler) {
            document.removeEventListener('touchmove', this._touchMoveHandler);
            this._touchMoveHandler = null;
        }
        if (this._touchEndHandler) {
            document.removeEventListener('touchend', this._touchEndHandler);
            this._touchEndHandler = null;
        }

        this._isTouchBound = false;
    },
    };

    root.__DS_MobileSidebarSwipe_bind = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
