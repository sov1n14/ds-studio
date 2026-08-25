/**
 * DS Studio — PresetDropdown 選單浮層定位模組
 * 依 trigger 的 getBoundingClientRect 計算並套用 menu 的 fixed 定位樣式。
 * 此檔案以 classic script 載入，無 ES import/export，須在
 * preset-dropdown.component.js 之前載入。
 */

(function (root) {
    'use strict';

    /**
     * 依 trigger 的 getBoundingClientRect 計算 menu 的 fixed 定位座標並套用至樣式。
     * 若視窗下方空間不足則向上展開。
     *
     * @param {HTMLElement} triggerEl - 觸發器元素
     * @param {HTMLElement} menuEl    - 選單元素
     */
    function positionMenu(triggerEl, menuEl) {
        if (!triggerEl) throw new Error('positionMenu: triggerEl is required');
        if (!menuEl) throw new Error('positionMenu: menuEl is required');

        const triggerRect = triggerEl.getBoundingClientRect();
        const menuHeight  = menuEl.offsetHeight || 300; // 估算值（getBoundingClientRect 在 hidden 時為 0）
        const vpHeight    = window.innerHeight || 0;
        const vpWidth     = window.innerWidth  || 0;

        // 預設向下展開
        let top  = triggerRect.bottom + 4;
        let left = triggerRect.left;
        const width = Math.max(triggerRect.width, 120);

        // 下方空間不足 → 向上展開
        if (top + menuHeight > vpHeight && triggerRect.top - menuHeight - 4 >= 0) {
            top = triggerRect.top - menuHeight - 4;
        }

        // 水平夾邊：不超出右側 viewport
        if (left + width > vpWidth) {
            left = Math.max(0, vpWidth - width);
        }

        menuEl.style.position = 'fixed';
        menuEl.style.top      = top  + 'px';
        menuEl.style.left     = left + 'px';
        menuEl.style.width    = width + 'px';
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    root.__DS_PresetMenuPosition = { positionMenu };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { positionMenu };
    }

})(globalThis);
