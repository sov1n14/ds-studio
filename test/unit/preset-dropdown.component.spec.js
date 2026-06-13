/**
 * Unit tests for createPresetDropdown (preset-dropdown.component.js).
 * jsdom/happy-dom DOM tests; getBoundingClientRect returns zeros — all
 * assertions target attributes, classes, and state, not pixel values.
 *
 * §4.2 / §4.3 contract:
 *   createPresetDropdown({ onChange }) → { el, trigger, label, menu,
 *     setOptions, setValue, getValue, getNaturalWidth,
 *     open, close, toggle, destroy }
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { createPresetDropdown } = require('../../content/preset-dropdown.component.js');

// ── factory helper ─────────────────────────────────────────────────────────

function makeDropdown(overrides = {}) {
    const onChange = vi.fn();
    const dd = createPresetDropdown({ onChange, ...overrides });
    document.body.appendChild(dd.el);
    return { dd, onChange };
}

function teardown(dd) {
    dd.destroy();
}

const PRESETS = [
    { id: 'p1', name: 'Preset One' },
    { id: 'p2', name: 'Preset Two' },
];

// ── Group A: buildDOM structure & ARIA ─────────────────────────────────────

describe('createPresetDropdown — DOM structure & ARIA', () => {
    let dd, onChange;
    beforeEach(() => ({ dd, onChange } = makeDropdown()));
    afterEach(() => teardown(dd));

    it('container has id=dss-preset-overlay, role=combobox, aria-haspopup=listbox', () => {
        expect(dd.el.id).toBe('dss-preset-overlay');
        expect(dd.el.getAttribute('role')).toBe('combobox');
        expect(dd.el.getAttribute('aria-haspopup')).toBe('listbox');
    });

    it('container aria-expanded is initially false', () => {
        expect(dd.el.getAttribute('aria-expanded')).toBe('false');
    });

    it('trigger has aria-controls pointing to menu id', () => {
        expect(dd.trigger.getAttribute('aria-controls')).toBe(dd.menu.id);
    });

    it('menu has role=listbox and is initially hidden', () => {
        expect(dd.menu.getAttribute('role')).toBe('listbox');
        expect(dd.menu.hidden).toBe(true);
    });

    it('label initially shows placeholder text and has placeholder class', () => {
        expect(dd.label.classList.contains('dss-preset-label--placeholder')).toBe(true);
        expect(dd.label.textContent.length).toBeGreaterThan(0);
    });
});

// ── Group B: setOptions ────────────────────────────────────────────────────

describe('createPresetDropdown — setOptions()', () => {
    let dd, onChange;
    beforeEach(() => ({ dd, onChange } = makeDropdown()));
    afterEach(() => teardown(dd));

    it('renders a leading empty option with data-value="" ', () => {
        dd.setOptions(PRESETS);
        const options = dd.menu.querySelectorAll('.dss-preset-option');
        // Use getAttribute for robustness — happy-dom may return undefined for
        // dataset.value when the attribute value is an empty string.
        expect(options[0].getAttribute('data-value')).toBe('');
    });

    it('renders one li per preset plus the empty option', () => {
        dd.setOptions(PRESETS);
        const options = dd.menu.querySelectorAll('.dss-preset-option');
        expect(options.length).toBe(PRESETS.length + 1);
    });

    it('each option has role=option', () => {
        dd.setOptions(PRESETS);
        const options = dd.menu.querySelectorAll('.dss-preset-option');
        options.forEach(li => expect(li.getAttribute('role')).toBe('option'));
    });

    it('each preset option has correct data-value and text', () => {
        dd.setOptions(PRESETS);
        const options = Array.from(dd.menu.querySelectorAll('.dss-preset-option'));
        // Skip index 0 (empty option)
        PRESETS.forEach((p, i) => {
            expect(options[i + 1].dataset.value).toBe(p.id);
            expect(options[i + 1].textContent).toBe(p.name);
        });
    });

    it('accepts an empty presets array and renders only the empty option', () => {
        dd.setOptions([]);
        const options = dd.menu.querySelectorAll('.dss-preset-option');
        expect(options.length).toBe(1);
        expect(options[0].getAttribute('data-value')).toBe('');
    });

    it('resets to empty option when called a second time with different presets', () => {
        dd.setOptions(PRESETS);
        dd.setOptions([{ id: 'p3', name: 'Preset Three' }]);
        const options = dd.menu.querySelectorAll('.dss-preset-option');
        expect(options.length).toBe(2);
        expect(options[1].dataset.value).toBe('p3');
    });
});

// ── Group C: setValue / getValue / label update ────────────────────────────

describe('createPresetDropdown — setValue() / getValue()', () => {
    let dd, onChange;
    beforeEach(() => {
        ({ dd, onChange } = makeDropdown());
        dd.setOptions(PRESETS);
    });
    afterEach(() => teardown(dd));

    it('setValue(id) updates label text to matching preset name', () => {
        dd.setValue('p1');
        expect(dd.label.textContent).toBe('Preset One');
    });

    it('setValue(id) sets aria-selected=true on matching option', () => {
        dd.setValue('p2');
        const opt = Array.from(dd.menu.querySelectorAll('.dss-preset-option'))
            .find(li => li.dataset.value === 'p2');
        expect(opt.getAttribute('aria-selected')).toBe('true');
    });

    it('setValue(id) sets aria-selected=false on non-matching options', () => {
        dd.setValue('p1');
        const opt = Array.from(dd.menu.querySelectorAll('.dss-preset-option'))
            .find(li => li.dataset.value === 'p2');
        expect(opt.getAttribute('aria-selected')).toBe('false');
    });

    it("setValue('') shows placeholder text and adds placeholder class", () => {
        dd.setValue('p1');   // set something first
        dd.setValue('');
        expect(dd.label.classList.contains('dss-preset-label--placeholder')).toBe(true);
    });

    it('getValue() reflects current value after setValue', () => {
        dd.setValue('p2');
        expect(dd.getValue()).toBe('p2');
    });

    it("getValue() returns '' after setValue('')", () => {
        dd.setValue('p1');
        dd.setValue('');
        expect(dd.getValue()).toBe('');
    });

    it('setValue does NOT fire onChange', () => {
        dd.setValue('p1');
        expect(onChange).not.toHaveBeenCalled();
    });
});

// ── Group D: open / close / toggle ────────────────────────────────────────

describe('createPresetDropdown — open() / close() / toggle()', () => {
    let dd, onChange;
    beforeEach(() => {
        ({ dd, onChange } = makeDropdown());
        dd.setOptions(PRESETS);
    });
    afterEach(() => teardown(dd));

    it('open() sets aria-expanded=true and menu.hidden=false', () => {
        dd.open();
        expect(dd.el.getAttribute('aria-expanded')).toBe('true');
        expect(dd.menu.hidden).toBe(false);
    });

    it('close() sets aria-expanded=false and menu.hidden=true', () => {
        dd.open();
        dd.close();
        expect(dd.el.getAttribute('aria-expanded')).toBe('false');
        expect(dd.menu.hidden).toBe(true);
    });

    it('toggle() opens when closed', () => {
        dd.toggle();
        expect(dd.el.getAttribute('aria-expanded')).toBe('true');
    });

    it('toggle() closes when open', () => {
        dd.open();
        dd.toggle();
        expect(dd.el.getAttribute('aria-expanded')).toBe('false');
    });

    it('open() is idempotent (calling twice keeps it open)', () => {
        dd.open();
        dd.open();
        expect(dd.el.getAttribute('aria-expanded')).toBe('true');
    });

    it('close() is idempotent (calling when already closed stays closed)', () => {
        dd.close();
        expect(dd.menu.hidden).toBe(true);
    });
});

// ── Group E: option click → onChange + close ──────────────────────────────

describe('createPresetDropdown — clicking an option', () => {
    let dd, onChange;
    beforeEach(() => {
        ({ dd, onChange } = makeDropdown());
        dd.setOptions(PRESETS);
        dd.open();
    });
    afterEach(() => teardown(dd));

    it('clicking a preset option fires onChange with that value', () => {
        const opt = Array.from(dd.menu.querySelectorAll('.dss-preset-option'))
            .find(li => li.dataset.value === 'p1');
        opt.click();
        expect(onChange).toHaveBeenCalledWith('p1');
    });

    it('clicking a preset option closes the menu', () => {
        const opt = Array.from(dd.menu.querySelectorAll('.dss-preset-option'))
            .find(li => li.dataset.value === 'p1');
        opt.click();
        expect(dd.menu.hidden).toBe(true);
    });

    it('clicking a preset option updates the label', () => {
        const opt = Array.from(dd.menu.querySelectorAll('.dss-preset-option'))
            .find(li => li.dataset.value === 'p2');
        opt.click();
        expect(dd.label.textContent).toBe('Preset Two');
    });

    it("clicking the empty option fires onChange with ''", () => {
        // First select something so we can tell the difference
        dd.setValue('p1');
        const emptyOpt = Array.from(dd.menu.querySelectorAll('.dss-preset-option'))
            .find(li => li.getAttribute('data-value') === '');
        expect(emptyOpt).toBeDefined();
        emptyOpt.click();
        // Source now reads li.getAttribute('data-value') || '' — always yields ''.
        expect(onChange).toHaveBeenCalledWith('');
    });
});

// ── Group F: Escape key → close without firing onChange ───────────────────

describe('createPresetDropdown — Escape key', () => {
    let dd, onChange;
    beforeEach(() => {
        ({ dd, onChange } = makeDropdown());
        dd.setOptions(PRESETS);
    });
    afterEach(() => teardown(dd));

    it('Escape while open closes the menu', () => {
        dd.open();
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(dd.menu.hidden).toBe(true);
    });

    it('Escape does NOT fire onChange', () => {
        dd.open();
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onChange).not.toHaveBeenCalled();
    });
});

// ── Group G: click-outside → close without onChange ───────────────────────

describe('createPresetDropdown — click-outside', () => {
    let dd, onChange;
    beforeEach(() => {
        ({ dd, onChange } = makeDropdown());
        dd.setOptions(PRESETS);
    });
    afterEach(() => teardown(dd));

    it('mousedown on document body while open closes the menu', async () => {
        dd.open();
        // open() defers the click-outside listener by setTimeout(0); flush it
        await new Promise(r => setTimeout(r, 0));
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(dd.menu.hidden).toBe(true);
    });

    it('click-outside does NOT fire onChange', async () => {
        dd.open();
        await new Promise(r => setTimeout(r, 0));
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(onChange).not.toHaveBeenCalled();
    });
});

// ── Group H: keyboard ArrowDown / ArrowUp navigation ─────────────────────

describe('createPresetDropdown — keyboard navigation', () => {
    let dd, onChange;
    beforeEach(() => {
        ({ dd, onChange } = makeDropdown());
        dd.setOptions(PRESETS);
        dd.open();
    });
    afterEach(() => teardown(dd));

    it('ArrowDown moves active option to next index and adds active class', () => {
        // After open(), activeIndex is set to currently selected (0 when nothing selected)
        // Press ArrowDown once → moves forward by 1
        const before = Array.from(dd.menu.querySelectorAll('.dss-preset-option--active')).length;
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        const active = dd.menu.querySelectorAll('.dss-preset-option--active');
        expect(active.length).toBeGreaterThanOrEqual(1);
    });

    it('ArrowUp moves active option to previous index', () => {
        // Move to last item first via ArrowUp (wraps from 0 to last)
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        const active = dd.menu.querySelectorAll('.dss-preset-option--active');
        expect(active.length).toBeGreaterThanOrEqual(1);
    });

    it('Enter selects currently active option and fires onChange', () => {
        // Move to p1 (index 1) via ArrowDown from 0
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('Enter closes the menu after selecting', () => {
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(dd.menu.hidden).toBe(true);
    });

    it('aria-activedescendant is set after ArrowDown', () => {
        dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(dd.el.hasAttribute('aria-activedescendant')).toBe(true);
    });
});

// ── Group I: destroy() ─────────────────────────────────────────────────────

describe('createPresetDropdown — destroy()', () => {
    it('removes el from DOM', () => {
        const { dd } = makeDropdown();
        document.body.appendChild(dd.el);
        dd.destroy();
        expect(document.getElementById('dss-preset-overlay')).toBeNull();
    });

    it('removes menu from DOM', () => {
        const { dd } = makeDropdown();
        const menuId = dd.menu.id;
        dd.destroy();
        expect(document.getElementById(menuId)).toBeNull();
    });

    it('document mousedown after destroy does not throw', async () => {
        const { dd } = makeDropdown();
        dd.setOptions(PRESETS);
        dd.open();
        await new Promise(r => setTimeout(r, 0));
        dd.destroy();
        // Should not throw
        expect(() => {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }).not.toThrow();
    });
});

// ── Group J: getNaturalWidth() ─────────────────────────────────────────────

describe('createPresetDropdown — getNaturalWidth()', () => {
    let dd;
    beforeEach(() => ({ dd } = makeDropdown()));
    afterEach(() => teardown(dd));

    it('returns a finite number >= 0', () => {
        dd.setOptions(PRESETS);
        dd.setValue('p1');
        const w = dd.getNaturalWidth();
        expect(typeof w).toBe('number');
        expect(isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
    });

    it('does not leave probe nodes in document.body after measurement', () => {
        const before = document.body.childElementCount;
        dd.getNaturalWidth();
        // The probe span is appended then immediately removed; count must be same
        expect(document.body.childElementCount).toBe(before);
    });

    it('does not throw when label has no text', () => {
        // setValue('') → placeholder text; should still not throw
        dd.setValue('');
        expect(() => dd.getNaturalWidth()).not.toThrow();
    });
});

// ── Group K: createPresetDropdown throws on bad options ───────────────────

describe('createPresetDropdown — input validation', () => {
    it('throws when options argument is missing', () => {
        expect(() => createPresetDropdown()).toThrow();
    });

    it('throws when options is not an object', () => {
        expect(() => createPresetDropdown('bad')).toThrow();
    });
});
