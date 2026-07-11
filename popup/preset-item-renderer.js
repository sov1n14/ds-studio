/**
 * DS studio — Preset Item Row Renderer
 * 單一職責：組合單一提示詞組列的 HTML markup（含拖曳把手、名稱、
 * 編輯／刪除按鈕）。純函式，不觸碰 DOM、不持有狀態。
 * 此檔案以 classic script 載入，無 ES import/export。
 */
(function (global) {
    'use strict';

    /**
     * 轉義 HTML 特殊字元，避免提示詞組名稱中的內容破壞 markup 結構。
     * @param {*} str - 任意可轉為字串的值
     * @returns {string} 轉義後的字串
     */
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * 組合單一提示詞組列的 innerHTML markup。
     * 編輯按鈕使用與外層鉛筆按鈕相同方向的 SVG（尖端朝左下），
     * 刪除按鈕維持 ✕ 字符不變。
     * @param {{ id: string, name: string }} preset - 提示詞組資料
     * @returns {string} 可直接指派給 item.innerHTML 的字串
     */
    function buildPresetItemMarkup(preset) {
        return (
            `<span class="ds-select__drag-handle" aria-hidden="true">⠿</span>` +
            `<span class="ds-select__item-name">${escapeHtml(preset.name)}</span>` +
            `<button class="ds-select__item-btn ds-select__item-btn--edit" type="button" ` +
            `aria-label="${dsI18n.t('renameAriaLabel')}" title="${dsI18n.t('editPresetNameTooltip')}">` +
            `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
            `<path d="M11.5 2.5 L13.5 4.5 L5 13 L2.5 13.5 L3 11 Z"/>` +
            `<path d="M10 4 L12 6"/>` +
            `</svg>` +
            `</button>` +
            `<button class="ds-select__item-btn ds-select__item-btn--delete" type="button" ` +
            `aria-label="${dsI18n.t('deleteAriaLabel')}" title="${dsI18n.t('deletePresetTooltip')}">✕</button>`
        );
    }

    global.__DS_PresetItemRenderer = { escapeHtml, buildPresetItemMarkup };

})(window);
