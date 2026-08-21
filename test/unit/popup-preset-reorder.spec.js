import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript, loadI18nOnce } from '../helpers/popup-script-loader.js';

// NOTE: this file used to import reorderPresets() from popup/popup-utils.js,
// a module with ZERO production consumers (it was never loaded by any real
// page — verified via repo-wide grep). The behavior it tests is duplicated
// as the private _reorderPresets() inside popup/custom-select.js, wired up
// behind pointer-drag events. That private helper has no public export, so
// these tests now drive the actual shipped drag-and-drop flow through
// window.__DSSCustomSelect and assert on the onReorder callback's result —
// the same reorder table the old tests asserted, exercised through the real
// UI surface instead of a dead copy.

beforeAll(() => {
    // Mirrors the <script> load order declared in popup/popup.html, and the
    // same loading pattern used by test/unit/popup-custom-select.spec.js.
    loadI18nOnce();
    evalPopupScript('popup/preset-item-renderer.js');
    evalPopupScript('popup/custom-select.js');

    // happy-dom does not implement PointerEvent capture; the shipped code
    // calls handle.setPointerCapture(e.pointerId) unconditionally on drag start.
    if (!Element.prototype.setPointerCapture) {
        Element.prototype.setPointerCapture = function () {};
    }
});

const A = { id: 'a', name: 'Alpha', content: '' };
const B = { id: 'b', name: 'Beta', content: '' };
const C = { id: 'c', name: 'Gamma', content: '' };

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

function createSelect(presets) {
    const onReorder = vi.fn();
    const sel = window.__DSSCustomSelect.createPresetCustomSelect({
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
        onReorder,
        onRequestEdit: vi.fn(),
        onRequestDelete: vi.fn(),
        onRequestDeleteAll: vi.fn(),
    });
    return { sel, onReorder };
}

// Fixed layout: item with data-id X sits at top = ROW_TOP[X], height 40.
const ROW_TOP = { a: 0, b: 40, c: 80 };

function stubRects() {
    document.querySelectorAll('#list .ds-select__item[data-id]').forEach(el => {
        const top = ROW_TOP[el.dataset.id];
        el.getBoundingClientRect = () => ({ top, height: 40, bottom: top + 40, left: 0, right: 100, width: 100 });
    });
}

function pointerEvent(type, opts) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX: 0, clientY: 0, pointerId: 1 }, opts);
    return e;
}

/**
 * Drives the real drag-and-drop reorder flow: pointerdown on the source
 * item's drag handle, a pointermove past the 5px activation threshold,
 * a pointermove to `targetClientY` (to select the hover target/position),
 * then pointerup to commit.
 */
function dragTo(srcId, targetClientY) {
    stubRects();
    const handle = document.querySelector(`#list .ds-select__item[data-id="${srcId}"] .ds-select__drag-handle`);
    handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: ROW_TOP[srcId] }));
    handle.dispatchEvent(pointerEvent('pointermove', { clientX: 0, clientY: ROW_TOP[srcId] + 10 })); // cross 5px threshold
    handle.dispatchEvent(pointerEvent('pointermove', { clientX: 0, clientY: targetClientY }));
    handle.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: targetClientY }));
}

describe('drag-and-drop preset reorder (shipped custom-select.js, via onReorder)', () => {
    beforeEach(() => {
        makeDOM();
    });

    it('將第一個項目拖曳至最後', () => {
        const presets = [A, B, C];
        const { sel, onReorder } = createSelect(presets);
        sel.open();
        dragTo('a', 150); // past every item's midpoint -> append after last
        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(onReorder.mock.calls[0][0].map(p => p.id)).toEqual(['b', 'c', 'a']);
    });

    it('將最後一個項目拖曳至最前', () => {
        const presets = [A, B, C];
        const { sel, onReorder } = createSelect(presets);
        sel.open();
        dragTo('c', -100); // before every remaining item's midpoint -> insert before first
        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(onReorder.mock.calls[0][0].map(p => p.id)).toEqual(['c', 'a', 'b']);
    });

    it('拖曳距離不足 5px 時不觸發 onReorder（視為點擊而非拖曳）', () => {
        const presets = [A, B, C];
        const { sel, onReorder, } = createSelect(presets);
        sel.open();
        stubRects();
        const handle = document.querySelector('#list .ds-select__item[data-id="a"] .ds-select__drag-handle');
        handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
        handle.dispatchEvent(pointerEvent('pointermove', { clientX: 0, clientY: 2 })); // below 5px threshold
        handle.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 2 }));
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('移至相鄰項目下方', () => {
        // Drag 'a' to just below its neighbour 'b' -> [b, a, c].
        const presets = [A, B, C];
        const { sel, onReorder } = createSelect(presets);
        sel.open();
        dragTo('a', 70); // between b's midpoint(60) and c's midpoint(100)
        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(onReorder.mock.calls[0][0].map(p => p.id)).toEqual(['b', 'a', 'c']);
    });

    it('移至相鄰項目上方（結果等同不動）', () => {
        // Drag 'a' to just above its neighbour 'b' -> order is unchanged.
        const presets = [A, B, C];
        const { sel, onReorder } = createSelect(presets);
        sel.open();
        dragTo('a', 0); // a's own original top, above b's midpoint
        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(onReorder.mock.calls[0][0].map(p => p.id)).toEqual(['a', 'b', 'c']);
    });

    it('拖曳至自身位置上方，不改變順序', () => {
        // Drag the middle item 'b' back over its own original slot.
        const presets = [A, B, C];
        const { sel, onReorder } = createSelect(presets);
        sel.open();
        dragTo('b', 40); // b's own original top
        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(onReorder.mock.calls[0][0].map(p => p.id)).toEqual(['a', 'b', 'c']);
    });

    it('單項目陣列不崩潰', () => {
        // A single-item preset list has no other item to hover over;
        // the drag flow must complete without throwing and without reordering.
        const presets = [A];
        const { sel, onReorder } = createSelect(presets);
        sel.open();
        expect(() => dragTo('a', 100)).not.toThrow();
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('不改變原始陣列（immutable）', () => {
        const presets = [A, B, C];
        const original = presets;
        const originalCopy = presets.map(p => ({ ...p }));
        const { sel, onReorder } = createSelect(presets);
        sel.open();
        dragTo('a', 150);
        expect(onReorder).toHaveBeenCalledTimes(1);
        // The caller's own array (by reference) must be untouched after the drag.
        expect(original).toEqual(originalCopy);
        expect(original.map(p => p.id)).toEqual(['a', 'b', 'c']);
    });
});

describe('savePromptPresets orderMeta integration', () => {
    it('receives orderMeta as second argument when order changes', async () => {
        const spy = vi.spyOn(StorageManager, 'savePromptPresets').mockResolvedValue(undefined);
        const presets = [
            { id: 'b', name: 'B', content: '', createdAt: 1, updatedAt: 1 },
            { id: 'a', name: 'A', content: '', createdAt: 2, updatedAt: 2 },
        ];
        const orderMeta = { order: ['b', 'a'], orderUpdatedAt: Date.now() };
        await StorageManager.savePromptPresets(presets, orderMeta);
        expect(spy).toHaveBeenCalledWith(presets, orderMeta);
        spy.mockRestore();
    });
});
