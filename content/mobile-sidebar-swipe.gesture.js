/**
 * DS studio — Mobile Sidebar Swipe :: Gesture
 * 觸控手勢處理器。透過 Object.assign 合入。
 */
(function (root) {
    'use strict';

    const __DS_SwipeMobileDevice = globalThis.DSSMobileDevice
        || (typeof require !== 'undefined' ? require('./mobile-device.js') : null);

    const bundle = {
    _onTouchStart(e) {
        if (!this.enabled) return;
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;

        const touch = e.touches[0];
        if (!touch) return;

        const vpWidth = window.innerWidth;
        const vpHeight = window.innerHeight;
        const margin = this.TRIGGER_ZONE_MARGIN_RATIO;

        // 水平範圍：扣除左右各 10%，保留中央 80%
        const minX = vpWidth * margin;
        const maxX = vpWidth * (1 - margin);
        if (touch.clientX < minX || touch.clientX > maxX) return;

        // 垂直範圍：扣除上下各 10%，保留中央 80%
        const minY = vpHeight * margin;
        const maxY = vpHeight * (1 - margin);
        if (touch.clientY < minY || touch.clientY > maxY) return;

        this._startPoint = { x: touch.clientX, y: touch.clientY };
        this._startTime = Date.now();
        this._deltaX = 0;
        this._deltaY = 0;
    },

    /**
     * touchmove 處理器：追蹤手指位移量。
     * @param {TouchEvent} e
     */
    _onTouchMove(e) {
        if (!this.enabled) return;
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;
        if (!this._startPoint) return;

        const touch = e.touches[0];
        if (!touch) return;

        this._deltaX = touch.clientX - this._startPoint.x;
        this._deltaY = touch.clientY - this._startPoint.y;
    },

    /**
     * touchend 處理器：驗證滑動手勢條件並觸發按鈕點擊。
     *
     * 五項條件必須全部滿足：
     *   a. |deltaX| ≥ 50px（最小滑動距離）
     *   b. |deltaX| > |deltaY| * 1.5（主要為水平方向）
     *   c. 持續時間 < 500ms（非慢速拖曳）
     *   d. 起點位於畫面中央 80% 水平區域內
     *   e. 起點位於畫面中央 80% 垂直區域內
     *
     * deltaX > 0 → 右滑（開啟側邊欄）
     * deltaX < 0 → 左滑（關閉側邊欄）
     */
    _onTouchEnd() {
        if (!this.enabled) return;
        if (!__DS_SwipeMobileDevice.isMobileDevice()) return;
        if (!this._startPoint) return;

        const deltaX = this._deltaX;
        const deltaY = this._deltaY;
        const absDeltaX = Math.abs(deltaX);
        const duration = Date.now() - this._startTime;
        const startX = this._startPoint.x;
        const startY = this._startPoint.y;

        // 立即重設滑動狀態，防止 touchend 重複觸發
        this._startPoint = null;
        this._startTime = null;
        this._deltaX = 0;
        this._deltaY = 0;

        // 條件 a：最小滑動距離 ≥ 50px（雙向對稱）
        if (absDeltaX < this.SWIPE_THRESHOLD_PX) return;

        // 條件 b：主要為水平方向（|deltaX| > |deltaY| * 1.5）
        if (absDeltaX <= Math.abs(deltaY) * 1.5) return;

        // 條件 c：持續時間 < 500ms（非慢速拖曳）
        if (duration >= this.SWIPE_MAX_DURATION_MS) return;

        // 條件 d+e：起點必須位於畫面中央 80% 區域內（水平與垂直各扣除 10%）
        const vpWidth = window.innerWidth;
        const vpHeight = window.innerHeight;
        const margin = this.TRIGGER_ZONE_MARGIN_RATIO;
        if (startX < vpWidth * margin || startX > vpWidth * (1 - margin)) return;
        if (startY < vpHeight * margin || startY > vpHeight * (1 - margin)) return;

        // 所有條件滿足：依方向選擇對應按鈕並點擊
        const isRightSwipe = deltaX > 0;
        const button = isRightSwipe ? this._findButton() : this._findCloseButton();
        if (button) {
            button.click();
        }
    },
    };

    root.__DS_MobileSidebarSwipe_gesture = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
