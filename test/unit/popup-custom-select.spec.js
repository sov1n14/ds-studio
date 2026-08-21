import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { evalPopupScript, loadI18nOnce, readProjectFile } from '../helpers/popup-script-loader.js';

let Modal;

beforeAll(() => {
    // custom-select.js depends on window.__DS_PresetItemRenderer to build
    // each row's markup, and that renderer calls dsI18n.t(...), so both must
    // be loaded (and i18n initialized) before custom-select.js is evaluated —
    // mirrors the <script> load order declared in popup/popup.html.
    loadI18nOnce();
    // custom-select.js does `const _debounce = DSSDebounce;` — the shared helper must be on globalThis first.
    evalPopupScript('utils/debounce.js');
    evalPopupScript('popup/preset-item-renderer.js');
    evalPopupScript('popup/custom-select.js');

    // Extract Modal object from popup.js for modal-integration tests
    const popupCode = readProjectFile('popup/popup.modal.js');
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
                <button class="ds-select__item-btn ds-select__item-btn--delete-all" type="button">✕</button>
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
    const onRequestDelete = vi.fn();
    const onRequestDeleteAll = vi.fn();

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
        onRequestDelete,
        onRequestDeleteAll,
        ...overrides,
    });

    return { sel, onSelect, onReorder, onRequestDelete, onRequestDeleteAll, getPresets: () => presets, setActiveId: (id) => { activeId = id; } };
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
            expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('true');
        });

        it('close() 收合面板', () => {
            const { sel } = createSelect();
            sel.open();
            sel.close();
            expect(document.getElementById('panel').hidden).toBe(true);
            expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('false');
        });

        it('重複 open() 不會重複展開', () => {
            const { sel } = createSelect();
            sel.open();
            sel.open();
            expect(document.querySelectorAll('#list .ds-select__item').length).toBe(3);
        });
    });

    describe('點擊選取', () => {
        it('點擊 preset item 呼叫 onSelect 並關閉面板', () => {
            const { sel, onSelect } = createSelect();
            sel.open();
            const item = document.querySelector('#list .ds-select__item[data-id="a"]');
            item.click();
            expect(onSelect).toHaveBeenCalledWith('a');
            expect(document.getElementById('panel').hidden).toBe(true);
        });

        it('點擊空白選項呼叫 onSelect 並傳入空字串', () => {
            const { sel, onSelect } = createSelect();
            sel.open();
            const blank = document.querySelector('.ds-select__item--empty');
            blank.click();
            expect(onSelect).toHaveBeenCalledWith('');
            expect(document.getElementById('panel').hidden).toBe(true);
        });
    });

    describe('inline 按鈕', () => {
        it('點擊 delete 按鈕呼叫 onRequestDelete 且不關閉面板', () => {
            const { sel, onRequestDelete } = createSelect();
            sel.open();
            const deleteBtn = document.querySelector('#list .ds-select__item[data-id="b"] .ds-select__item-btn--delete');
            deleteBtn.click();
            expect(onRequestDelete).toHaveBeenCalledWith('b');
            expect(document.getElementById('panel').hidden).toBe(false);
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

    describe('刪除全部按鈕 (.ds-select__item-btn--delete-all)', () => {
        it('點擊呼叫 onRequestDeleteAll', () => {
            const { sel, onRequestDeleteAll } = createSelect();
            sel.open();
            const deleteAllBtn = document.querySelector('.ds-select__item-btn--delete-all');
            deleteAllBtn.click();
            expect(onRequestDeleteAll).toHaveBeenCalledTimes(1);
        });

        it('點擊不會同時觸發空白項目的 onSelect(\'\')', () => {
            const { sel, onSelect, onRequestDeleteAll } = createSelect();
            sel.open();
            const deleteAllBtn = document.querySelector('.ds-select__item-btn--delete-all');
            deleteAllBtn.click();
            expect(onRequestDeleteAll).toHaveBeenCalledTimes(1);
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('省略 onRequestDeleteAll（undefined）時點擊不會拋出例外', () => {
            const { sel } = createSelect({ onRequestDeleteAll: undefined });
            sel.open();
            const deleteAllBtn = document.querySelector('.ds-select__item-btn--delete-all');
            expect(() => deleteAllBtn.click()).not.toThrow();
        });

        it('新增刪除全部分支後，per-item 的 delete 按鈕仍正確運作（回歸測試）', () => {
            const { sel, onRequestDelete } = createSelect();
            sel.open();
            const deleteBtn = document.querySelector('#list .ds-select__item[data-id="b"] .ds-select__item-btn--delete');
            deleteBtn.click();
            expect(onRequestDelete).toHaveBeenCalledWith('b');
        });
    });

    // 環境限制：happy-dom 16.8.1 會忽略 addEventListener 的 signal 選項，
    // 因此無法在此測試環境中驗證 AbortController 型式的監聽器卸載行為。
    describe('外部點擊關閉面板', () => {
        it('面板開啟時，於 document.body（面板/trigger 之外）觸發 pointerdown 應關閉面板', () => {
            const { sel } = createSelect();
            sel.open();
            expect(document.getElementById('panel').hidden).toBe(false);

            document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

            expect(document.getElementById('panel').hidden).toBe(true);
        });

        it('面板開啟時，於 panel 元素本身觸發 pointerdown 不應關閉面板', () => {
            const { sel } = createSelect();
            sel.open();

            document.getElementById('panel').dispatchEvent(new Event('pointerdown', { bubbles: true }));

            expect(document.getElementById('panel').hidden).toBe(false);
        });

        it('面板開啟時，於 trigger 元素觸發 pointerdown 不應關閉面板', () => {
            const { sel } = createSelect();
            sel.open();

            document.getElementById('trigger').dispatchEvent(new Event('pointerdown', { bubbles: true }));

            expect(document.getElementById('panel').hidden).toBe(false);
        });

        it('面板已透過 close() 關閉後，於 document.body 觸發 pointerdown 不應拋出例外，也不應有重入的關閉副作用', () => {
            const { sel } = createSelect();
            sel.open();
            sel.close();
            expect(document.getElementById('panel').hidden).toBe(true);

            expect(() => {
                document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            }).not.toThrow();

            expect(document.getElementById('panel').hidden).toBe(true);
            expect(document.getElementById('trigger').getAttribute('aria-expanded')).toBe('false');
        });
    });

    describe('pin 按鈕 (getPinnedPresetId / onRequestTogglePin)', () => {
        it('render() 時，preset id 等於 getPinnedPresetId() 的列顯示 pinned 狀態，其他列不顯示', () => {
            const { sel } = createSelect({ getPinnedPresetId: () => 'b' });
            sel.open();
            const pinnedBtn = document.querySelector('#list .ds-select__item[data-id="b"] .ds-select__item-btn--pin');
            const otherBtn = document.querySelector('#list .ds-select__item[data-id="a"] .ds-select__item-btn--pin');
            expect(pinnedBtn.classList.contains('ds-select__item-btn--pinned')).toBe(true);
            expect(pinnedBtn.getAttribute('aria-pressed')).toBe('true');
            expect(otherBtn.classList.contains('ds-select__item-btn--pinned')).toBe(false);
            expect(otherBtn.getAttribute('aria-pressed')).toBe('false');
        });

        it('點擊某列的 pin 按鈕時，onRequestTogglePin 收到該列的 preset id', () => {
            const onRequestTogglePin = vi.fn();
            const { sel } = createSelect({ getPinnedPresetId: () => '', onRequestTogglePin });
            sel.open();
            const pinBtn = document.querySelector('#list .ds-select__item[data-id="a"] .ds-select__item-btn--pin');
            pinBtn.click();
            expect(onRequestTogglePin).toHaveBeenCalledWith('a');
        });

        it('點擊 pin 按鈕不會關閉面板，也不會觸發該列的 onSelect', () => {
            const onRequestTogglePin = vi.fn();
            const { sel, onSelect } = createSelect({ getPinnedPresetId: () => '', onRequestTogglePin });
            sel.open();
            const pinBtn = document.querySelector('#list .ds-select__item[data-id="a"] .ds-select__item-btn--pin');
            pinBtn.click();
            expect(document.getElementById('panel').hidden).toBe(false);
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('省略 getPinnedPresetId 與 onRequestTogglePin 時仍可正常 render，且點擊 pin 按鈕不拋出例外', () => {
            const { sel } = createSelect({ getPinnedPresetId: undefined, onRequestTogglePin: undefined });
            sel.open();
            const pinBtn = document.querySelector('#list .ds-select__item[data-id="a"] .ds-select__item-btn--pin');
            expect(pinBtn).not.toBeNull();
            expect(() => pinBtn.click()).not.toThrow();
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
