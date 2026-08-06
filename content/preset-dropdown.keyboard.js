/**
 * DS Studio — PresetDropdown 鍵盤導航模組
 * 負責 combobox 觸發器上的鍵盤事件處理（開啟、方向鍵導航、Enter 選取、
 * Escape 關閉、Tab 關閉）。所有 DOM 讀取／狀態變更皆透過注入的回呼完成，
 * 本模組不持有任何可變狀態。
 * 此檔案以 classic script 載入，無 ES import/export，須在
 * preset-dropdown.component.js 之前載入。
 */

(function (root) {
    'use strict';

    /**
     * 建立鍵盤導航處理器。
     *
     * @param {Object}   deps
     * @param {() => Array<HTMLElement>} deps.getOptionEls        - 取得目前所有選項 <li>
     * @param {() => boolean}            deps.isOpen              - 選單目前是否開啟
     * @param {() => number}             deps.getActiveIndex      - 取得目前 active index
     * @param {(index: number) => void}  deps.setActiveIndex      - 設定 active index
     * @param {() => void}               deps.syncActiveOption    - 同步 active 選項的 ARIA / class
     * @param {() => void}               deps.scrollActiveIntoView - 將 active 選項捲入可視範圍
     * @param {() => void}               deps.open                - 開啟選單
     * @param {() => void}               deps.close               - 關閉選單
     * @param {(value: string) => void}  deps.setValue            - 設定選中值
     * @param {(value: string) => void} [deps.onChange]           - 選取後的回呼（選擇性）
     * @param {HTMLElement}              deps.trigger             - 觸發器元素（Escape 後回復焦點）
     * @returns {(e: KeyboardEvent) => void} keydown 事件處理函式
     */
    function createKeyboardNavigator(deps) {
        if (!deps) throw new Error('createKeyboardNavigator: deps is required');
        if (typeof deps.getOptionEls !== 'function')        throw new Error('createKeyboardNavigator: deps.getOptionEls is required');
        if (typeof deps.isOpen !== 'function')               throw new Error('createKeyboardNavigator: deps.isOpen is required');
        if (typeof deps.getActiveIndex !== 'function')       throw new Error('createKeyboardNavigator: deps.getActiveIndex is required');
        if (typeof deps.setActiveIndex !== 'function')       throw new Error('createKeyboardNavigator: deps.setActiveIndex is required');
        if (typeof deps.syncActiveOption !== 'function')     throw new Error('createKeyboardNavigator: deps.syncActiveOption is required');
        if (typeof deps.scrollActiveIntoView !== 'function') throw new Error('createKeyboardNavigator: deps.scrollActiveIntoView is required');
        if (typeof deps.open !== 'function')                 throw new Error('createKeyboardNavigator: deps.open is required');
        if (typeof deps.close !== 'function')                throw new Error('createKeyboardNavigator: deps.close is required');
        if (typeof deps.setValue !== 'function')             throw new Error('createKeyboardNavigator: deps.setValue is required');
        if (!deps.trigger)                                   throw new Error('createKeyboardNavigator: deps.trigger is required');

        const onChange = typeof deps.onChange === 'function' ? deps.onChange : null;

        function handleKeydown(e) {
            const optionEls = deps.getOptionEls();
            const count     = optionEls.length;

            if (!deps.isOpen()) {
                // 選單關閉時：ArrowDown / Enter / Space 開啟
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    deps.open();
                }
                return;
            }

            switch (e.key) {
                case 'ArrowDown': {
                    e.preventDefault();
                    const nextIndex = count > 0 ? (deps.getActiveIndex() + 1) % count : 0;
                    deps.setActiveIndex(nextIndex);
                    deps.syncActiveOption();
                    deps.scrollActiveIntoView();
                    break;
                }

                case 'ArrowUp': {
                    e.preventDefault();
                    const prevIndex = count > 0 ? (deps.getActiveIndex() - 1 + count) % count : 0;
                    deps.setActiveIndex(prevIndex);
                    deps.syncActiveOption();
                    deps.scrollActiveIntoView();
                    break;
                }

                case 'Enter': {
                    e.preventDefault();
                    const activeIndex = deps.getActiveIndex();
                    if (activeIndex >= 0 && activeIndex < count) {
                        const value = optionEls[activeIndex].getAttribute('data-value') || '';
                        deps.setValue(value);
                        deps.close();
                        if (onChange) onChange(value);
                    }
                    break;
                }

                case 'Escape':
                    e.preventDefault();
                    deps.close();
                    deps.trigger.focus();
                    break;

                case 'Tab':
                    // 不阻止 Tab；讓焦點自然移動，同時關閉選單
                    deps.close();
                    break;
            }
        }

        return handleKeydown;
    }

    // ── 匯出 ─────────────────────────────────────────────────────────────────

    root.__DS_PresetKeyboard = { createKeyboardNavigator };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createKeyboardNavigator };
    }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
