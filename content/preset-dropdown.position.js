/**
 * DS Studio — PresetDropdown 定位計算模組
 * 純函式，接受量測後的 rect 物件，輸出定位描述。
 * 不讀取 DOM；所有量測由呼叫端（controller）負責。
 * 此檔案以 classic script 載入，無 ES import/export。
 * 載入順序：本檔 → preset-dropdown.component.js → preset-overlay.controller.js
 */

(function (root) {
    'use strict';

    // ── 主函式 ───────────────────────────────────────────────────────────────

    /**
     * 計算 preset dropdown 的定位描述。
     *
     * 以 windowWidth 決定分支：
     *   >= 768px ('center') — 整個容器置中，忽略 titleRect / buttonRect。
     *   <  768px ('gap')    — 置中於聊天標題右緣與新建對話按鈕左緣之間的間隙。
     *   <  768px ('hidden') — 間隙 <= 0，隱藏 overlay。
     *
     * @param {Object} input
     * @param {Object} input.containerRect  - 容器（._2be88ba）的 DOMRect-like 物件，至少含 { left, right, width }
     * @param {Object} [input.titleRect]    - 對話標題的 DOMRect-like 物件，至少含 { right }
     * @param {Object} [input.buttonRect]   - 新對話按鈕的 DOMRect-like 物件，至少含 { left }
     * @param {number} [input.naturalWidth] - dropdown 內容自然寬度（px），預設 80
     * @param {number} [input.maxWidth]     - 最大寬度上限（px），預設 200
     * @param {number} [input.gapSafety]    - 間隙兩側安全距離（px），預設 8
     * @param {number} [input.windowWidth]  - window.innerWidth（px），預設 window.innerWidth
     * @returns {{ mode: 'center'|'gap'|'hidden', left: number, width: number, hidden: boolean }}
     *          left 為相對容器左緣的 px 偏移量；hidden===true 時 left/width 無意義
     */
    function computePlacement(input) {
        // Guard: containerRect 為必要輸入
        if (!input || !input.containerRect) {
            throw new Error('computePlacement: containerRect is required');
        }

        var containerRect = input.containerRect;
        var titleRect     = input.titleRect   || null;
        var buttonRect    = input.buttonRect  || null;
        var naturalWidth  = (typeof input.naturalWidth === 'number') ? input.naturalWidth : 80;
        var maxWidth      = (typeof input.maxWidth     === 'number') ? input.maxWidth     : 200;
        var gapSafety     = (typeof input.gapSafety    === 'number') ? input.gapSafety    : 8;
        // windowWidth 由呼叫端注入，方便單元測試替換；瀏覽器端預設取 window.innerWidth
        var windowWidth   = (typeof input.windowWidth  === 'number') ? input.windowWidth
                          : (typeof window !== 'undefined' ? window.innerWidth : 1024);

        // ── 分支一：>= 768px → 容器置中 ────────────────────────────────────
        if (windowWidth >= 768) {
            // 自然寬度受 maxWidth 上限約束；無最小寬度限制
            // Math.round 消除子像素抖動，確保相同輸入產生完全相同的整數結果（冪等性）
            var desktopWidth = Math.round(Math.min(naturalWidth, maxWidth));
            var desktopLeft  = Math.round(Math.max(0, (containerRect.width - desktopWidth) / 2));

            return {
                mode:   'center',
                left:   desktopLeft,
                width:  desktopWidth,
                hidden: false
            };
        }

        // ── 分支二：< 768px → 間隙置中（或隱藏）───────────────────────────

        // 缺少 titleRect 或 buttonRect 時退回容器置中（避免崩潰）
        if (!titleRect || !buttonRect) {
            var fallbackWidth = Math.round(Math.min(naturalWidth, maxWidth));
            var fallbackLeft  = Math.round(Math.max(0, (containerRect.width - fallbackWidth) / 2));

            return {
                mode:   'center',
                left:   fallbackLeft,
                width:  fallbackWidth,
                hidden: false
            };
        }

        var titleRight  = titleRect.right;
        var buttonLeft  = buttonRect.left;
        // availableGap：扣除兩側安全距離後可用寬度
        var availableGap = buttonLeft - titleRight - 2 * gapSafety;

        // 間隙 <= 0：隱藏 overlay
        if (availableGap <= 0) {
            return { mode: 'hidden', left: 0, width: 0, hidden: true };
        }

        // 決定最終寬度：naturalWidth 若超出間隙則收縮至間隙寬度；無最小寬度限制
        // Math.round 消除子像素抖動，對稱 center 分支的捨入策略
        var gapWidth  = availableGap;
        var finalWidth = Math.round(Math.min(naturalWidth <= gapWidth ? naturalWidth : gapWidth, maxWidth));

        // 間隙中心相對容器左緣
        var gapCenterAbs = titleRight + gapSafety + gapWidth / 2;
        var gapLeft      = Math.round(gapCenterAbs - containerRect.left - finalWidth / 2);

        return {
            mode:   'gap',
            left:   gapLeft,
            width:  finalWidth,
            hidden: false
        };
    }

    /**
     * 依候選標籤寬度計算 dropdown 的自然寬度。
     * 純函式：不修改輸入陣列，相同輸入永遠回傳相同結果。
     * 不做上限裁切（裁切至可用空間是 computePlacement() 的職責，超出本函式範圍）。
     *
     * @param {Object} [input]
     * @param {number[]} [input.labelWidths] - 候選標籤寬度陣列；非數字/非有限值會被忽略
     * @param {number} [input.arrowWidth]    - 箭頭寬度（px），預設 0
     * @param {number} [input.paddingLeft]   - 左內距（px），預設 0
     * @param {number} [input.paddingRight]  - 右內距（px），預設 0
     * @param {number} [input.gap]           - 間距（px），預設 0
     * @param {number} [input.minWidth]      - 最小寬度下限（px），預設 80
     * @returns {number} 自然寬度（px），恆為有限數字
     */
    function pickNaturalWidth(input) {
        // Guard: 允許無參數呼叫，一律視為空物件
        var options = input || {};

        var labelWidths  = Array.isArray(options.labelWidths) ? options.labelWidths : [];
        var arrowWidth   = (typeof options.arrowWidth   === 'number') ? options.arrowWidth   : 0;
        var paddingLeft  = (typeof options.paddingLeft  === 'number') ? options.paddingLeft  : 0;
        var paddingRight = (typeof options.paddingRight === 'number') ? options.paddingRight : 0;
        var gap          = (typeof options.gap          === 'number') ? options.gap          : 0;
        var minWidth     = (typeof options.minWidth      === 'number') ? options.minWidth     : 80;

        // 從候選寬度中挑出最大的有效（有限數字）值，忽略 NaN / null / undefined / 字串等無效項
        var maxLabelWidth = -Infinity;
        for (var i = 0; i < labelWidths.length; i++) {
            var candidate = labelWidths[i];
            if (typeof candidate === 'number' && isFinite(candidate) && candidate > maxLabelWidth) {
                maxLabelWidth = candidate;
            }
        }

        // 無任何有效候選寬度：直接回傳 minWidth
        if (maxLabelWidth === -Infinity) {
            return minWidth;
        }

        var total = maxLabelWidth + arrowWidth + paddingLeft + paddingRight + gap;

        return Math.max(total, minWidth);
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    // 掛載至全域命名空間（瀏覽器 classic script 環境）
    root.__DS_PresetPosition = { computePlacement, pickNaturalWidth };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { computePlacement, pickNaturalWidth };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
