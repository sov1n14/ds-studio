/**
 * DS Studio — PresetDropdown 元件
 * 自訂下拉選單，取代原生 <select>，支援 text-overflow: ellipsis 截斷顯示。
 * 符合 ARIA combobox/listbox 模式；以 position:fixed 浮層呈現選單，跳脫祖先 overflow 裁切。
 * 此檔案以 classic script 載入，無 ES import/export，須在 preset-overlay.controller.js 之前載入。
 */

(function (root) {
    'use strict';

    // ── 常數 ────────────────────────────────────────────────────────────────────

    /** 空選項的預設顯示文字（getter — 確保使用當下語系） */
    function DEFAULT_EMPTY_OPTION_TEXT() { return dsI18n.t('dropdownEmptyOption'); }

    /** 預設佔位文字（getter — 確保使用當下語系） */
    function DEFAULT_PLACEHOLDER_TEXT() { return dsI18n.t('dropdownPlaceholder'); }

    /** 下拉選單 id */
    const MENU_ID = 'dss-preset-menu';

    /** 選項 id 前綴 */
    const OPTION_ID_PREFIX = 'dss-preset-opt-';

    // ── 工具：離屏量測文字寬度 ────────────────────────────────────────────────

    /**
     * 建立離屏量測 span，複製指定元素的字型樣式後量測文字自然寬度。
     * 在 jsdom 中 getBoundingClientRect 回傳零值屬預期行為。
     *
     * @param {HTMLElement} sourceEl - 複製字型樣式的來源元素
     * @param {string} text - 要量測的文字內容
     * @returns {number} 文字自然寬度（px）
     */
    function measureTextWidth(sourceEl, text) {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none;';

        // 複製字型相關樣式以確保量測精確
        if (sourceEl) {
            const computed = window.getComputedStyle(sourceEl);
            probe.style.fontSize   = computed.fontSize;
            probe.style.fontFamily = computed.fontFamily;
            probe.style.fontWeight = computed.fontWeight;
            probe.style.letterSpacing = computed.letterSpacing;
        }

        probe.textContent = text;
        document.body.appendChild(probe);
        const width = probe.getBoundingClientRect().width;
        document.body.removeChild(probe);
        return width;
    }

    // ── 選單浮層定位 ──────────────────────────────────────────────────────────

    /**
     * 依 trigger 的 getBoundingClientRect 計算 menu 的 fixed 定位座標。
     * 若視窗下方空間不足則向上展開。
     *
     * @param {HTMLElement} triggerEl - 觸發器元素
     * @param {HTMLElement} menuEl    - 選單元素
     */
    function positionMenu(triggerEl, menuEl) {
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

    // ── 元件 factory ──────────────────────────────────────────────────────────

    /**
     * 建立自訂下拉選單元件。
     *
     * @param {Object}   options
     * @param {Function} options.onChange           - 選取選項後的回呼，接收選取值字串
     * @param {string}  [options.placeholderText]   - 未選取時顯示於 label 的佔位文字
     * @param {string}  [options.emptyOptionText]   - 空選項（無）的顯示文字
     * @returns {Object} 元件公開 API
     */
    function createPresetDropdown(options) {
        if (!options || typeof options !== 'object') {
            throw new Error('createPresetDropdown: options 為必填物件');
        }

        const onChange        = typeof options.onChange === 'function' ? options.onChange : null;
        const placeholderText = options.placeholderText || DEFAULT_PLACEHOLDER_TEXT();
        const emptyOptionText = options.emptyOptionText || DEFAULT_EMPTY_OPTION_TEXT();

        // ── 狀態 ──────────────────────────────────────────────────────────────
        let currentValue  = '';   // 目前選中的選項 value
        let activeIndex   = -1;   // 鍵盤導航：目前 active 選項的索引（0-based，含空選項）
        let optionData    = [];   // { id, name } 陣列；index 0 為空選項
        let isOpen        = false;

        // ── DOM 建構 ──────────────────────────────────────────────────────────

        // 容器（combobox）
        const el = document.createElement('div');
        el.id = 'dss-preset-overlay';
        el.setAttribute('role', 'combobox');
        el.setAttribute('aria-expanded', 'false');
        el.setAttribute('aria-haspopup', 'listbox');
        el.setAttribute('aria-label', dsI18n.t('dropdownComboboxAriaLabel'));

        // 觸發器按鈕
        const trigger = document.createElement('button');
        trigger.className = 'dss-preset-trigger';
        trigger.type = 'button';
        trigger.setAttribute('aria-controls', MENU_ID);

        // Label span（顯示選中名稱，支援 ellipsis）
        const label = document.createElement('span');
        label.className = 'dss-preset-label dss-preset-label--placeholder';
        label.textContent = placeholderText;

        // 箭頭 span
        const arrow = document.createElement('span');
        arrow.className = 'dss-preset-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '▾';

        trigger.appendChild(label);
        trigger.appendChild(arrow);
        el.appendChild(trigger);

        // 選單（listbox）— 掛到 document.body 以跳脫祖先 overflow
        const menu = document.createElement('ul');
        menu.id = MENU_ID;
        menu.className = 'dss-preset-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', dsI18n.t('dropdownListboxAriaLabel'));
        menu.hidden = true;
        document.body.appendChild(menu);

        // ── 內部工具 ──────────────────────────────────────────────────────────

        /** 取得所有 <li> 元素陣列 */
        function getOptionEls() {
            return Array.from(menu.querySelectorAll('.dss-preset-option'));
        }

        /** 更新 ARIA activedescendant 與 active class */
        function syncActiveOption() {
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
        function scrollActiveIntoView() {
            const optionEls = getOptionEls();
            if (activeIndex >= 0 && activeIndex < optionEls.length) {
                optionEls[activeIndex].scrollIntoView({ block: 'nearest' });
            }
        }

        /** 依當前值設定 label 顯示文字與 placeholder class */
        function updateLabel(value) {
            if (value === '') {
                label.textContent = placeholderText;
                label.classList.add('dss-preset-label--placeholder');
            } else {
                const matched = optionData.find(o => o.id === value);
                label.textContent = matched ? matched.name : placeholderText;
                if (matched) {
                    label.classList.remove('dss-preset-label--placeholder');
                } else {
                    label.classList.add('dss-preset-label--placeholder');
                }
            }
        }

        /** 同步所有選項的 aria-selected 狀態 */
        function syncAriaSelected(value) {
            getOptionEls().forEach(li => {
                li.setAttribute('aria-selected', (li.getAttribute('data-value') || '') === value ? 'true' : 'false');
            });
        }

        // ── 公開 API：open / close / toggle ─────────────────────────────────

        function open() {
            if (isOpen) return;
            isOpen = true;
            menu.hidden = false;
            el.setAttribute('aria-expanded', 'true');

            // 先顯示再定位（需要 offsetHeight）
            positionMenu(trigger, menu);

            // 設定初始 active index 為已選中的選項
            const optionEls = getOptionEls();
            activeIndex = optionEls.findIndex(li => (li.getAttribute('data-value') || '') === currentValue);
            if (activeIndex < 0) activeIndex = 0;
            syncActiveOption();
            scrollActiveIntoView();

            // 監聽 click-outside（mousedown 優先於 blur，確保 option click 不被攔截）
            // 使用 setTimeout 延遲綁定，避免觸發本次 open 的 mousedown 立即關閉
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
            syncActiveOption();
            document.removeEventListener('mousedown', handleClickOutside);
        }

        function toggle() {
            isOpen ? close() : open();
        }

        // ── click-outside 處理 ───────────────────────────────────────────────

        function handleClickOutside(e) {
            // 點擊 trigger 或 menu 內部 → 不關閉
            if (trigger.contains(e.target) || menu.contains(e.target)) return;
            close();
        }

        // ── 選項點擊 ─────────────────────────────────────────────────────────

        function handleOptionClick(e) {
            const li = e.target.closest('.dss-preset-option');
            if (!li) return;
            const value = li.getAttribute('data-value') || '';
            // setValue 不觸發 onChange；點選後再手動呼叫 onChange
            setValue(value);
            close();
            if (onChange) onChange(value);
        }

        menu.addEventListener('click', handleOptionClick);

        // ── 觸發器點擊 ───────────────────────────────────────────────────────

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });

        // ── 鍵盤處理 ─────────────────────────────────────────────────────────

        function handleKeydown(e) {
            const optionEls = getOptionEls();
            const count     = optionEls.length;

            if (!isOpen) {
                // 選單關閉時：ArrowDown / Enter / Space 開啟
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
                }
                return;
            }

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    activeIndex = count > 0 ? (activeIndex + 1) % count : 0;
                    syncActiveOption();
                    scrollActiveIntoView();
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    activeIndex = count > 0 ? (activeIndex - 1 + count) % count : 0;
                    syncActiveOption();
                    scrollActiveIntoView();
                    break;

                case 'Enter':
                    e.preventDefault();
                    if (activeIndex >= 0 && activeIndex < count) {
                        const value = optionEls[activeIndex].getAttribute('data-value') || '';
                        setValue(value);
                        close();
                        if (onChange) onChange(value);
                    }
                    break;

                case 'Escape':
                    e.preventDefault();
                    close();
                    trigger.focus();
                    break;

                case 'Tab':
                    // 不阻止 Tab；讓焦點自然移動，同時關閉選單
                    close();
                    break;
            }
        }

        trigger.addEventListener('keydown', handleKeydown);

        // ── 公開 API：setValue ───────────────────────────────────────────────

        /**
         * 設定選中值並同步 UI 狀態。不觸發 onChange。
         * @param {string} id - 選項 value（'' 代表空選項）
         */
        function setValue(id) {
            const safeId = (id === undefined || id === null) ? '' : String(id);
            currentValue = safeId;
            updateLabel(safeId);
            syncAriaSelected(safeId);
        }

        // ── 公開 API：setOptions ─────────────────────────────────────────────

        /**
         * 重建選項清單。index 0 始終為空選項（emptyOptionText）。
         * 保留 currentValue（若仍存在）；否則退回空選項。
         * 呼叫後請由 controller 執行 reposition。
         *
         * @param {Array<{id: string, name: string}>} presets
         */
        function setOptions(presets) {
            const safePresets = Array.isArray(presets) ? presets : [];

            // 重建 optionData（index 0 固定為空選項）
            optionData = [{ id: '', name: emptyOptionText }, ...safePresets];

            // 重建 DOM
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

            // 保留 currentValue（若已不存在則退回空選項）
            const isValueStillValid = optionData.some(o => o.id === currentValue);
            setValue(isValueStillValid ? currentValue : '');
        }

        // ── 公開 API：getValue ───────────────────────────────────────────────

        /** @returns {string} 目前選中的選項 value */
        function getValue() {
            return currentValue;
        }

        // ── 公開 API：getNaturalWidth ─────────────────────────────────────────

        /**
         * 量測 label 在完整顯示（不截斷）時的自然寬度。
         * 透過離屏 span 量測，不受觸發器目前受限寬度影響。
         * 加計觸發器水平 padding 與箭頭寬度以得出觸發器整體需求寬度。
         *
         * @returns {number} 觸發器所需最小完整寬度（px）
         */
        function getNaturalWidth() {
            const labelText   = label.textContent || '';
            const labelWidth  = measureTextWidth(label, labelText);
            // 箭頭寬度使用穩定常數，避免 getBoundingClientRect 受當前 inline width 約束影響，
            // 確保連續兩次呼叫對相同標籤文字回傳完全相同的值（冪等性保證）
            const arrowWidth  = 16;

            // 讀取觸發器水平 padding（在 jsdom 中為 0，不影響邏輯正確性）
            const computed        = window.getComputedStyle(trigger);
            const paddingLeft     = parseFloat(computed.paddingLeft)  || 0;
            const paddingRight    = parseFloat(computed.paddingRight) || 0;
            const gap             = parseFloat(computed.gap)          || 4;

            return labelWidth + arrowWidth + paddingLeft + paddingRight + gap;
        }

        // ── 公開 API：destroy ────────────────────────────────────────────────

        /**
         * 移除所有事件監聽並從 DOM 移除元件。
         */
        function destroy() {
            document.removeEventListener('mousedown', handleClickOutside);
            menu.remove();
            el.remove();
        }

        // ── 初始化 label ──────────────────────────────────────────────────────
        updateLabel('');

        // ── 回傳公開 API ─────────────────────────────────────────────────────
        return {
            el,
            trigger,
            label,
            menu,
            setOptions,
            setValue,
            getValue,
            getNaturalWidth,
            open,
            close,
            toggle,
            destroy
        };
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    // 瀏覽器 classic script 環境：掛至全域命名空間
    root.__DS_PresetDropdown = { createPresetDropdown };

    // Node.js / Vitest 測試環境：同時以 module.exports 匯出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createPresetDropdown };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
