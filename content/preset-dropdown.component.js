/**
 * DS Studio — PresetDropdown 元件
 * 自訂下拉選單，取代原生 <select>，支援 text-overflow: ellipsis 截斷顯示。
 * 符合 ARIA combobox/listbox 模式；以 position:fixed 浮層呈現選單，跳脫祖先 overflow 裁切。
 * 此檔案以 classic script 載入，無 ES import/export，須在 preset-overlay.controller.js 之前載入。
 *
 * 註：原生 <select> 已於先前評估中被否決（已否決兩次，特此記錄以免重複討論）。
 * 原因：Chrome 對原生 <select> 展開後的選項清單無法自訂樣式，該浮層由瀏覽器／作業系統
 * 於頁面樣式範圍之外渲染，導致擴充功能的主題、hover 狀態與版面配置皆無法套用其上。
 * 本元件的存在目的即是提供可完全自訂樣式的選項清單。
 *
 * 職責邊界（各關注點已拆分至獨立檔案，本檔僅保留 DOM 建構與狀態協調）：
 *   preset-dropdown.menu-position.js — 選單浮層定位（positionMenu）
 *   preset-dropdown.width.js         — 自然寬度量測與快取（每實例持有）
 *   preset-dropdown.options.js       — 選項渲染 / label 顯示 / ARIA 同步
 *   preset-dropdown.keyboard.js      — 鍵盤導航
 */

(function (root) {
    'use strict';

    const PresetMenuPosition = root.__DS_PresetMenuPosition ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.menu-position.js') : undefined);
    const PresetWidth = root.__DS_PresetWidth ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.width.js') : undefined);
    const PresetOptions = root.__DS_PresetOptions ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.options.js') : undefined);
    const PresetKeyboard = root.__DS_PresetKeyboard ||
        (typeof require !== 'undefined' ? require('./preset-dropdown.keyboard.js') : undefined);

    // ── 常數 ────────────────────────────────────────────────────────────────────

    /** 下拉選單 id */
    const MENU_ID = 'dss-preset-menu';

    function createPresetDropdown(options) {
        if (!options || typeof options !== 'object') {
            throw new Error('createPresetDropdown: options 為必填物件');
        }

        // 依賴注入（P11）：i18n 由呼叫端提供，未提供時退回 manifest 載入順序建立的全域物件。
        const i18n = options.i18n || dsI18n;

        // 兩個預設文字皆為 getter — 確保取用當下語系
        const defaultPlaceholderText = () => i18n.t('dropdownPlaceholder');
        const defaultEmptyOptionText = () => i18n.t('dropdownEmptyOption');

        const onChange      = typeof options.onChange === 'function' ? options.onChange : null;
        var placeholderText = options.placeholderText || defaultPlaceholderText();
        var emptyOptionText = options.emptyOptionText || defaultEmptyOptionText();

        let currentValue  = '';
        let activeIndex   = -1;
        let optionData    = [];
        let isOpen        = false;

        const el = document.createElement('div');
        el.id = 'dss-preset-overlay';
        el.setAttribute('role', 'combobox');
        el.setAttribute('aria-expanded', 'false');
        el.setAttribute('aria-haspopup', 'listbox');
        el.setAttribute('aria-label', i18n.t('dropdownComboboxAriaLabel'));

        const trigger = document.createElement('button');
        trigger.className = 'dss-preset-trigger';
        trigger.type = 'button';
        trigger.setAttribute('aria-controls', MENU_ID);

        const label = document.createElement('span');
        label.className = 'dss-preset-label dss-preset-label--placeholder';
        label.textContent = placeholderText;

        const arrow = document.createElement('span');
        arrow.className = 'dss-preset-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '▾';

        trigger.appendChild(label);
        trigger.appendChild(arrow);
        el.appendChild(trigger);

        const menu = document.createElement('ul');
        menu.id = MENU_ID;
        menu.className = 'dss-preset-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', i18n.t('dropdownListboxAriaLabel'));
        menu.hidden = true;
        document.body.appendChild(menu);

        const optionsManager = PresetOptions.createOptionListManager({ el, menu, label });
        const widthMeasurer  = PresetWidth.createWidthMeasurer({ label, trigger });

        function open() {
            if (isOpen) return;
            isOpen = true;
            menu.hidden = false;
            el.setAttribute('aria-expanded', 'true');

            PresetMenuPosition.positionMenu(trigger, menu);

            const optionEls = optionsManager.getOptionEls();
            activeIndex = optionEls.findIndex(li => (li.getAttribute('data-value') || '') === currentValue);
            if (activeIndex < 0) activeIndex = 0;
            optionsManager.syncActiveOption(activeIndex);
            optionsManager.scrollActiveIntoView(activeIndex);

            setTimeout(() => {
                document.addEventListener('mousedown', handleClickOutside);
            }, 0);
        }

        function close() {
            if (!isOpen) return;
            isOpen = false;
            menu.hidden = true;
            el.setAttribute('aria-expanded', 'false');
            activeIndex = -1;
            optionsManager.syncActiveOption(activeIndex);
            document.removeEventListener('mousedown', handleClickOutside);
        }

        function toggle() {
            isOpen ? close() : open();
        }

        function handleClickOutside(e) {
            if (trigger.contains(e.target) || menu.contains(e.target)) return;
            close();
        }

        function handleOptionClick(e) {
            const li = e.target.closest('.dss-preset-option');
            if (!li) return;
            const value = li.getAttribute('data-value') || '';
            setValue(value);
            close();
            if (onChange) onChange(value);
        }

        menu.addEventListener('click', handleOptionClick);

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });

        const handleKeydown = PresetKeyboard.createKeyboardNavigator({
            getOptionEls:         () => optionsManager.getOptionEls(),
            isOpen:               () => isOpen,
            getActiveIndex:       () => activeIndex,
            setActiveIndex:       (index) => { activeIndex = index; },
            syncActiveOption:     () => optionsManager.syncActiveOption(activeIndex),
            scrollActiveIntoView: () => optionsManager.scrollActiveIntoView(activeIndex),
            open,
            close,
            setValue,
            onChange,
            trigger
        });

        trigger.addEventListener('keydown', handleKeydown);

        function setValue(id) {
            const safeId = (id === undefined || id === null) ? '' : String(id);
            currentValue = safeId;
            optionsManager.updateLabel(safeId, optionData, placeholderText);
            optionsManager.syncAriaSelected(safeId);
        }

        function setOptions(presets) {
            const safePresets = Array.isArray(presets) ? presets : [];
            optionData = [{ id: '', name: emptyOptionText }, ...safePresets];
            widthMeasurer.invalidate();
            optionsManager.renderOptions(optionData);
            const isValueStillValid = optionData.some(o => o.id === currentValue);
            setValue(isValueStillValid ? currentValue : '');
        }

        function getNaturalWidth() {
            return widthMeasurer.measure(optionData, placeholderText);
        }

        function destroy() {
            document.removeEventListener('mousedown', handleClickOutside);
            menu.remove();
            el.remove();
        }

        optionsManager.updateLabel('', optionData, placeholderText);

        return {
            el,
            trigger,
            label,
            menu,
            setOptions,
            setValue,
            getNaturalWidth,
            open,
            close,
            toggle,
            destroy,

            updateLocale: function () {
                placeholderText = defaultPlaceholderText();
                emptyOptionText = defaultEmptyOptionText();
                widthMeasurer.invalidate();
                if (currentValue === '') {
                    label.textContent = placeholderText;
                }
                if (optionData.length > 0) {
                    optionData[0].name = emptyOptionText;
                    var emptyOptionEl = menu.querySelector('.dss-preset-option[data-value=""]');
                    if (emptyOptionEl) {
                        emptyOptionEl.textContent = emptyOptionText;
                    }
                }
            }
        };
    }

    root.__DS_PresetDropdown = { createPresetDropdown };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPresetDropdown };
    }

})(globalThis);
