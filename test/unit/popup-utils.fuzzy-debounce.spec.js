import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// NOTE: this file used to import fuzzyMatch()/debounce() from
// popup/popup-utils.js, a module with ZERO production consumers (verified
// via repo-wide grep — the only importers were this file and
// popup-preset-reorder.spec.js). The real, shipped logic lives in two
// duplicated copies:
//   - custom-select.js: private _fuzzyMatch() / _debounce(), reachable only
//     through the search input's public filtering behavior.
//   - editor.js: debounce(), exported publicly on window.__DSSEditor.debounce.
// Retargeted below, following the loading patterns already established in
// test/unit/popup-custom-select.spec.js (eval-load custom-select.js) and
// test/unit/editor.spec.js (ESM import of editor.js).

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

beforeAll(() => {
    if (!globalThis.dsI18n) {
        const i18nCode = readFileSync(resolve(__dirname, '../../utils/i18n.js'), 'utf-8');
        eval('var chrome=globalThis.chrome,document=globalThis.document,window=globalThis;' + i18nCode);
    }
    const rendererCode = readFileSync(resolve(__dirname, '../../popup/preset-item-renderer.js'), 'utf-8');
    eval(rendererCode);
    const code = readFileSync(resolve(__dirname, '../../popup/custom-select.js'), 'utf-8');
    eval(code);
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

function createSelect(presets) {
    return window.__DSSCustomSelect.createPresetCustomSelect({
        triggerEl: document.getElementById('trigger'),
        panelEl: document.getElementById('panel'),
        valueEl: document.getElementById('value'),
        searchInputEl: document.getElementById('search'),
        listEl: document.getElementById('list'),
        blankItemEl: document.querySelector('.ds-select__item--empty'),
        emptyHintEl: document.getElementById('hint'),
        getPresets: () => presets,
        getActivePresetId: () => '',
        onSelect: vi.fn(),
        onReorder: vi.fn(),
        onRequestEdit: vi.fn(),
        onRequestDelete: vi.fn(),
        onRequestDeleteAll: vi.fn(),
    });
}

function search(keyword) {
    const input = document.getElementById('search');
    input.value = keyword;
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(400); // the shipped _debounce delay wired in custom-select.js
}

function visibleIds() {
    return Array.from(document.querySelectorAll('#list .ds-select__item[data-id]')).map(el => el.dataset.id);
}

describe('fuzzy match filtering (shipped custom-select.js _fuzzyMatch, via search input)', () => {
    beforeEach(() => {
        makeDOM();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('空關鍵字時所有項目皆顯示', () => {
        const sel = createSelect([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
        sel.open();
        search('');
        expect(visibleIds().sort()).toEqual(['a', 'b']);
    });

    it('完全相符時該項目顯示', () => {
        const sel = createSelect([{ id: 'a', name: 'Alpha' }]);
        sel.open();
        search('Alpha');
        expect(visibleIds()).toEqual(['a']);
    });

    it('子序列相符（連續字元）', () => {
        const sel = createSelect([{ id: 'a', name: 'Chinese Search' }]);
        sel.open();
        search('chs');
        expect(visibleIds()).toEqual(['a']);
    });

    it('子序列相符（散落字元）', () => {
        const sel = createSelect([{ id: 'a', name: 'Content Script Injection' }]);
        sel.open();
        search('csi');
        expect(visibleIds()).toEqual(['a']);
    });

    it('不相符時該項目被過濾掉，且顯示 empty hint', () => {
        const sel = createSelect([{ id: 'a', name: 'Alpha' }]);
        sel.open();
        search('xyz');
        expect(visibleIds()).toEqual([]);
        expect(document.getElementById('hint').hidden).toBe(false);
    });

    it('大小寫不敏感', () => {
        const sel = createSelect([{ id: 'a', name: 'DS studio' }, { id: 'b', name: 'alpha' }]);
        sel.open();
        search('DSS');
        expect(visibleIds()).toEqual(['a']);
        search('ALP');
        expect(visibleIds()).toEqual(['b']);
    });

    it('關鍵字比 name 長時不相符', () => {
        const sel = createSelect([{ id: 'a', name: 'ab' }]);
        sel.open();
        search('abc');
        expect(visibleIds()).toEqual([]);
    });
});

describe('debounce() — shipped editor.js copy, public via window.__DSSEditor.debounce', () => {
    let debounce;

    beforeAll(async () => {
        // editor.js exports { debounce, ... } on window.__DSSEditor (and module.exports).
        globalThis.window = globalThis.window ?? {};
        const editor = await import('../../popup/editor/editor.js');
        debounce = editor.debounce;
    });

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('在延遲時間後僅呼叫一次', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced('a');
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith('a');
    });

    it('快速連續呼叫時重置計時器，只觸發最後一次', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 200);

        debounced('first');
        vi.advanceTimersByTime(100);
        debounced('second');
        vi.advanceTimersByTime(100);
        debounced('third');
        vi.advanceTimersByTime(200);

        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith('third');
    });

    it('延遲時間未到時不觸發', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced();
        vi.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();
    });

    it('可多次獨立觸發', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 50);

        debounced('x');
        vi.advanceTimersByTime(50);
        debounced('y');
        vi.advanceTimersByTime(50);

        expect(fn).toHaveBeenCalledTimes(2);
    });
});
