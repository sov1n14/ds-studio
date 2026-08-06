/**
 * DS studio — Preset Item Row Renderer
 * 單一職責：組合單一提示詞組列的 HTML markup（含拖曳把手、名稱、
 * 釘選按鈕、刪除按鈕）。純函式，不觸碰 DOM、不持有狀態。
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
     * 組合釘選按鈕的 innerHTML markup。
     * @param {boolean} isPinned - 此列是否為已釘選（預設）的提示詞組
     * @returns {string} 釘選按鈕的 markup
     */
    function buildPinButtonMarkup(isPinned) {
        const pinnedClass = isPinned ? ' ds-select__item-btn--pinned' : '';
        const ariaPressed = isPinned ? 'true' : 'false';
        const ariaLabel = isPinned ? dsI18n.t('unpinPresetAriaLabel') : dsI18n.t('pinPresetAriaLabel');
        const tooltip = isPinned ? dsI18n.t('unpinPresetTooltip') : dsI18n.t('pinPresetTooltip');
        return (
            `<button class="ds-select__item-btn ds-select__item-btn--pin${pinnedClass}" type="button" ` +
            `aria-pressed="${ariaPressed}" aria-label="${ariaLabel}" title="${tooltip}">` +
            `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">` +
            `<path d="M11.77 1.16c-.81.81-.74 2.28.02 3.76L6.1 8.71c-2.17-1.46-4.12-2-4.94-1.18l4.95 4.95-4.95 6.36 6.36-4.95 4.95 4.95c.82-.82.27-2.77-1.19-4.94l3.8-5.69c1.47.76 2.94.84 3.76.02z"/>` +
            `</svg>` +
            `</button>`
        );
    }

    /**
     * 組合單一提示詞組列的 innerHTML markup。
     * 刪除按鈕維持 ✕ 字符不變；釘選按鈕位於刪除按鈕左側。
     * @param {{ id: string, name: string }} preset - 提示詞組資料
     * @param {{ isPinned?: boolean }} [options] - 選項物件
     * @returns {string} 可直接指派給 item.innerHTML 的字串
     */
    function buildPresetItemMarkup(preset, { isPinned = false } = {}) {
        return (
            `<span class="ds-select__drag-handle" aria-hidden="true">⠿</span>` +
            `<span class="ds-select__item-name">${escapeHtml(preset.name)}</span>` +
            buildPinButtonMarkup(isPinned) +
            `<button class="ds-select__item-btn ds-select__item-btn--delete" type="button" ` +
            `aria-label="${dsI18n.t('deleteAriaLabel')}" title="${dsI18n.t('deletePresetTooltip')}">✕</button>`
        );
    }

    global.__DS_PresetItemRenderer = { escapeHtml, buildPresetItemMarkup };

})(window);
