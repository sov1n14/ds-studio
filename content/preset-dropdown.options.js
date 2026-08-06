/**
 * DS Studio — PresetDropdown 選項清單渲染模組
 * 負責選單 <li> 選項的 DOM 建構、label 顯示文字、aria-selected /
 * aria-activedescendant 同步、以及 active 選項的可視捲動。
 * 此檔案以 classic script 載入，無 ES import/export，須在
 * preset-dropdown.component.js 之前載入。
 */

(function (root) {
    'use strict';

    /** 選項 id 前綴 */
    const OPTION_ID_PREFIX = 'dss-preset-opt-';

    /**
     * 建立一個選項清單管理器，綁定至指定的 el / menu / label 元素。
     *
     * @param {Object}      deps
     * @param {HTMLElement} deps.el    - combobox 容器元素（用於設定 aria-activedescendant）
     * @param {HTMLElement} deps.menu  - 選單（listbox）元素
     * @param {HTMLElement} deps.label - 觸發器 label 元素
     * @returns {Object} 選項清單管理器公開 API
     */
    function createOptionListManager(deps) {
        if (!deps)        throw new Error('createOptionListManager: deps is required');
        if (!deps.el)      throw new Error('createOptionListManager: deps.el is required');
        if (!deps.menu)    throw new Error('createOptionListManager: deps.menu is required');
        if (!deps.label)   throw new Error('createOptionListManager: deps.label is required');

        const el    = deps.el;
        const menu  = deps.menu;
        const label = deps.label;

        /** 取得所有 <li> 元素陣列 */
        function getOptionEls() {
            return Array.from(menu.querySelectorAll('.dss-preset-option'));
        }

        /** 依 optionData 重建選單的 <li> DOM */
        function renderOptions(optionData) {
            if (!Array.isArray(optionData)) throw new Error('renderOptions: optionData must be an array');

            menu.innerHTML = '';
            optionData.forEach((item, i) => {
                const li = document.createElement('li');
                li.className = 'dss-preset-option';
                li.setAttribute('role', 'option');
                li.id = OPTION_ID_PREFIX + i;
                li.dataset.value = item.id;
                li.textContent = item.name;
                menu.appendChild(li);
            });
        }

        /** 更新 ARIA activedescendant 與 active class */
        function syncActiveOption(activeIndex) {
            const optionEls = getOptionEls();
            optionEls.forEach((li, i) => {
                if (i === activeIndex) {
                    li.classList.add('dss-preset-option--active');
                    el.setAttribute('aria-activedescendant', li.id);
                } else {
                    li.classList.remove('dss-preset-option--active');
                }
            });
            if (activeIndex < 0) el.removeAttribute('aria-activedescendant');
        }

        /** 將 active 選項捲入可見區域 */
        function scrollActiveIntoView(activeIndex) {
            const optionEls = getOptionEls();
            if (activeIndex >= 0 && activeIndex < optionEls.length) {
                optionEls[activeIndex].scrollIntoView({ block: 'nearest' });
            }
        }

        /** 依當前值與選項資料設定 label 顯示文字與 placeholder class */
        function updateLabel(value, optionData, placeholderText) {
            if (value === '') {
                label.textContent = placeholderText;
                label.classList.add('dss-preset-label--placeholder');
                return;
            }

            const matched = optionData.find(o => o.id === value);
            label.textContent = matched ? matched.name : placeholderText;
            if (matched) {
                label.classList.remove('dss-preset-label--placeholder');
            } else {
                label.classList.add('dss-preset-label--placeholder');
            }
        }

        /** 同步所有選項的 aria-selected 狀態 */
        function syncAriaSelected(value) {
            getOptionEls().forEach(li => {
                li.setAttribute('aria-selected', (li.getAttribute('data-value') || '') === value ? 'true' : 'false');
            });
        }

        return {
            getOptionEls,
            renderOptions,
            syncActiveOption,
            scrollActiveIntoView,
            updateLabel,
            syncAriaSelected
        };
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    root.__DS_PresetOptions = { createOptionListManager, OPTION_ID_PREFIX };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createOptionListManager, OPTION_ID_PREFIX };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
