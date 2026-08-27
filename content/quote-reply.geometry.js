/**
 * DS studio — QuoteReply Geometry Bundle
 * 選取範圍的矩形合併與按鈕定位計算。
 */
(function (root) {
    'use strict';

    const bundle = {
        unionClientRects(rects) {
            if (!rects || rects.length === 0) return null;

            let top = Infinity;
            let left = Infinity;
            let bottom = -Infinity;
            let right = -Infinity;

            for (let i = 0; i < rects.length; i++) {
                const r = rects[i];
                if (r.width === 0 && r.height === 0) continue;
                top = Math.min(top, r.top);
                left = Math.min(left, r.left);
                bottom = Math.max(bottom, r.bottom);
                right = Math.max(right, r.right);
            }

            if (top === Infinity) return null;

            return { top, left, bottom, right, width: right - left };
        },

        computeButtonPosition(selectionRect, btnDims, viewport) {
            if (selectionRect.bottom < 0 || selectionRect.top > viewport.vh) {
                return { top: 0, left: 0, hidden: true };
            }

            let top = selectionRect.top - btnDims.h - 16;
            let left = selectionRect.left + selectionRect.width / 2 - btnDims.w / 2;

            left = Math.max(10, Math.min(left, viewport.vw - btnDims.w - 10));

            if (top < 10) {
                top = selectionRect.bottom + 8;
            }

            return { top, left, hidden: false };
        },
    };

    root.__DS_QuoteReply_geometry = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
