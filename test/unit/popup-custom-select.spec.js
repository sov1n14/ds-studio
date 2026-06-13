import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let Modal;

beforeAll(() => {
    const code = readFileSync(resolve(__dirname, '../../popup/custom-select.js'), 'utf-8');
    eval(code);

    // Extract Modal object from popup.js for modal-integration tests
    const popupCode = readFileSync(resolve(__dirname, '../../popup/popup.modal.js'), 'utf-8');
    const match = popupCode.match(/const Modal = \{[\s\S]*?\n\};/);
    if (!match) {
        throw new Error('Could not extract Modal object from popup.js');
    }
    const globalEval = eval;
    globalEval(match[0].replace('const Modal', 'var Modal'));
    if (typeof globalThis.Modal !== 'object') {
        throw new Error('Extracted code did not define Modal as an object');
    }
    Modal = globalThis.Modal;
});

function makeDOM() {
    document.body.innerHTML = `
        <div id="trigger" role="combobox" aria-expanded="false" tabindex="0">
            <span id="value"></span>
            <span class="arrow"></span>
        </div>
        <button id="addPresetBtn">+</button>
        <div id="panel" hidden>
            <div class="ds-select__search-row">
                <input id="search" type="text">
            </div>
            <div class="ds-select__item ds-select__item--empty" data-id="" data-blank="true">
                <span class="ds-select__item-name">（無提示詞組）</span>
            </div>
            <div id="list" class="ds-select__list"></div>
            <div id="hint" hidden>無相符結果</div>
        </div>
    `;
}

function makePresets() {
    return [
        { id: 'a', name: 'Alpha', content: '' },
        { id: 'b', name: 'Beta',  content: '' },
        { id: 'c', name: 'Gamma', content: '' },
    ];
}

function createSelect(overrides = {}) {
    let presets = makePresets();
    let activeId = '';
    const onSelect = vi.fn();
    const onReorder = vi.fn();
    const onRequestEdit = vi.fn();
    const onRequestDelete = vi.fn();

    const sel = window.__DSSCustomSelect.createPresetCustomSelect({
        triggerEl: document.getElementById('trigger'),
        panelEl: document.getElementById('panel'),
        valueEl: document.getElementById('value'),
        searchInputEl: document.getElementById('search'),
        listEl: document.getElementById('list'),
        blankItemEl: document.querySelector('.ds-select__item--empty'),
        emptyHintEl: document.getElementById('hint'),
        getPresets: () => presets,
        getActivePresetId: () => activeId,
        onSelect,
        onReorder,
        onRequestEdit,
        onRequestDelete,
        ...overrides,
    });

    return { sel, onSelect, onReorder, onRequestEdit, onRequestDelete, getPresets: () => presets, setActiveId: (id) => { activeId = id; } };
}

describe('createPresetCustomSelect', () => {
    beforeEach(() => {
        makeDOM();
    });

    describe('初始化', () => {
        it('應建立元件並回傳 API 方法', () => {
            const { sel } = createSelect();
            expect(typeof sel.render).toBe('function');
            expect(typeof sel.open).toBe('function');
            expect(typeof sel.close).toBe('function');
            expect(typeof sel.isOpen).toBe('function');
            expect(typeof sel.setActive).toBe('function');
            expect(typeof sel.destroy).toBe('function');
        });

        it('初始面板應為隱藏狀態', () => {
            createSelect();
            expect(document.getElementById('panel').hidden).toBe(true);
        });

        it('初始 trigger aria-expanded 應為 false', () => {
            createSelect();
            expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('false');
        });
    });

    describe('render()', () => {
        it('無 activePresetId 時 trigger 顯示（無提示詞組）', () => {
            const { sel } = createSelect();
            sel.render();
            expect(document.getElementById('value').textContent).toBe('（無提示詞組）');
        });

        it('有 activePresetId 時 trigger 顯示對應名稱', () => {
            const { sel, setActiveId } = createSelect();
            setActiveId('a');
            sel.render();
            expect(document.getElementById('value').textContent).toBe('Alpha');
        });

        it('render() 在 list 中生成正確數量的 item', () => {
            const { sel } = createSelect();
            sel.open();
            const items = document.querySelectorAll('#list .ds-select__item[data-id]');
            expect(items.length).toBe(3);
        });

        it('已選中項目帶有 ds-select__item--selected 類別', () => {
            const { sel, setActiveId } = createSelect();
            setActiveId('b');
            sel.open();
            const selectedItem = document.querySelector('#list .ds-select__item--selected');
            expect(selectedItem?.dataset.id).toBe('b');
        });
    });

    describe('open() / close() / isOpen()', () => {
        it('open() 展開面板', () => {
            const { sel } = createSelect();
            sel.open();
            expect(document.getElementById('panel').hidden).toBe(false);
            expect(sel.isOpen()).toBe(true);
            expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('true');
        });

        it('close() 收合面板', () => {
            const { sel } = createSelect();
            sel.open();
            sel.close();
            expect(document.getElementById('panel').hidden).toBe(true);
            expect(sel.isOpen()).toBe(false);
            expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('false');
        });

        it('重複 open() 不會重複展開', () => {
            const { sel } = createSelect();
            sel.open();
            sel.open();
            expect(document.querySelectorAll('#list .ds-select__item').length).toBe(3);
        });
    });

    describe('setActive()', () => {
        it('setActive() 更新 trigger 顯示文字', () => {
            const { sel, setActiveId } = createSelect();
            setActiveId('c');
            sel.setActive('c');
            expect(document.getElementById('value').textContent).toBe('Gamma');
        });

        it('setActive() 在面板開啟時更新選中狀態', () => {
            const { sel, setActiveId } = createSelect();
            sel.open();
            setActiveId('b');
            sel.setActive('b');
            const selected = document.querySelector('#list .ds-select__item--selected');
            expect(selected?.dataset.id).toBe('b');
        });
    });

    describe('點擊選取', () => {
        it('點擊 preset item 呼叫 onSelect 並關閉面板', () => {
            const { sel, onSelect } = createSelect();
            sel.open();
            const item = document.querySelector('#list .ds-select__item[data-id="a"]');
            item.click();
            expect(onSelect).toHaveBeenCalledWith('a');
            expect(sel.isOpen()).toBe(false);
        });

        it('點擊空白選項呼叫 onSelect 並傳入空字串', () => {
            const { sel, onSelect } = createSelect();
            sel.open();
            const blank = document.querySelector('.ds-select__item--empty');
            blank.click();
            expect(onSelect).toHaveBeenCalledWith('');
            expect(sel.isOpen()).toBe(false);
        });
    });

    describe('inline 按鈕', () => {
        it('點擊 edit 按鈕呼叫 onRequestEdit 且不關閉面板', () => {
            const { sel, onRequestEdit } = createSelect();
            sel.open();
            const editBtn = document.querySelector('#list .ds-select__item[data-id="a"] .ds-select__item-btn--edit');
            editBtn.click();
            expect(onRequestEdit).toHaveBeenCalledWith('a');
            expect(sel.isOpen()).toBe(true);
        });

        it('點擊 delete 按鈕呼叫 onRequestDelete 且不關閉面板', () => {
            const { sel, onRequestDelete } = createSelect();
            sel.open();
            const deleteBtn = document.querySelector('#list .ds-select__item[data-id="b"] .ds-select__item-btn--delete');
            deleteBtn.click();
            expect(onRequestDelete).toHaveBeenCalledWith('b');
            expect(sel.isOpen()).toBe(true);
        });
    });

    describe('搜尋過濾', () => {
        it('輸入關鍵字後新增 ds-select__list--filtering 類別', async () => {
            vi.useFakeTimers();
            const { sel } = createSelect();
            sel.open();
            const input = document.getElementById('search');
            input.value = 'alp';
            input.dispatchEvent(new Event('input'));
            vi.advanceTimersByTime(400);
            expect(document.getElementById('list').classList.contains('ds-select__list--filtering')).toBe(true);
            vi.useRealTimers();
        });

        it('搜尋後只顯示相符結果', async () => {
            vi.useFakeTimers();
            const { sel } = createSelect();
            sel.open();
            const input = document.getElementById('search');
            input.value = 'alp';
            input.dispatchEvent(new Event('input'));
            vi.advanceTimersByTime(400);
            const items = document.querySelectorAll('#list .ds-select__item[data-id]');
            expect(items.length).toBe(1);
            expect(items[0].dataset.id).toBe('a');
            vi.useRealTimers();
        });

        it('無相符結果時顯示 empty hint', async () => {
            vi.useFakeTimers();
            const { sel } = createSelect();
            sel.open();
            const input = document.getElementById('search');
            input.value = 'zzz';
            input.dispatchEvent(new Event('input'));
            vi.advanceTimersByTime(400);
            expect(document.getElementById('hint').hidden).toBe(false);
            vi.useRealTimers();
        });

        it('清除搜尋後移除 filtering 類別', async () => {
            vi.useFakeTimers();
            const { sel } = createSelect();
            sel.open();
            const input = document.getElementById('search');
            input.value = 'alp';
            input.dispatchEvent(new Event('input'));
            vi.advanceTimersByTime(400);
            input.value = '';
            input.dispatchEvent(new Event('input'));
            vi.advanceTimersByTime(400);
            expect(document.getElementById('list').classList.contains('ds-select__list--filtering')).toBe(false);
            vi.useRealTimers();
        });
    });

    describe('destroy()', () => {
        it('destroy() 不拋出例外', () => {
            const { sel } = createSelect();
            sel.open();
            expect(() => sel.destroy()).not.toThrow();
        });
    });
});

describe('與 Modal 整合', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="trigger" role="combobox" aria-expanded="false" tabindex="0">
                <span id="value"></span>
                <span class="arrow"></span>
            </div>
            <button id="addPresetBtn">+</button>
            <div id="panel" hidden>
                <div class="ds-select__search-row">
                    <input id="search" type="text">
                </div>
                <div class="ds-select__item ds-select__item--empty" data-id="" data-blank="true">
                    <span class="ds-select__item-name">（無提示詞組）</span>
                </div>
                <div id="list" class="ds-select__list"></div>
                <div id="hint" hidden>無相符結果</div>
            </div>
            <div id="modalOverlay" hidden>
                <div id="modalTitle"></div>
                <div id="modalMessage"></div>
                <input id="modalInput">
                <span id="modalRequired"></span>
                <div id="modalActions"></div>
            </div>
        `;
        Modal.init();
    });

    it('selecting a preset while modal is active dismisses the modal', () => {
        Modal.prompt({ title: 'Test' });
        expect(Modal.overlay.hidden).toBe(false);

        const onSelect = vi.fn(() => { Modal.dismissActive(); });
        const { sel } = createSelect({ onSelect });
        sel.open();

        const item = document.querySelector('#list .ds-select__item[data-id="a"]');
        item.click();

        expect(Modal.overlay.hidden).toBe(true);
    });

    it('selecting blank (no prompt) option while modal is active dismisses the modal', () => {
        Modal.prompt({ title: 'Test' });
        expect(Modal.overlay.hidden).toBe(false);

        const onSelect = vi.fn(() => { Modal.dismissActive(); });
        const { sel } = createSelect({ onSelect });
        sel.open();

        const blank = document.querySelector('.ds-select__item--empty');
        blank.click();

        expect(Modal.overlay.hidden).toBe(true);
    });
});
