/**
 * Mutant-killing tests for preset-dropdown.component.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { createPresetDropdown } = require('../../content/preset-dropdown.component.js');

function makeDropdown(overrides = {}) {
    const onChange = vi.fn();
    const dd = createPresetDropdown({ onChange, ...overrides });
    document.body.appendChild(dd.el);
    return { dd, onChange };
}

function teardown(dd) { dd.destroy(); }

const PRESETS = [
    { id: 'p1', name: 'Preset One' },
    { id: 'p2', name: 'Preset Two' },
];

describe('mutant-kill: input validation', () => {
    it('throws when null', () => { expect(() => createPresetDropdown(null)).toThrow(); });
    it('throws when number', () => { expect(() => createPresetDropdown(42)).toThrow(); });
    it('accepts object', () => { const dd = createPresetDropdown({}); document.body.appendChild(dd.el); dd.destroy(); });
});

describe('mutant-kill: custom text', () => {
    it('custom placeholderText', () => { const { dd } = makeDropdown({ placeholderText: 'Pick one' }); expect(dd.label.textContent).toBe('Pick one'); teardown(dd); });
    it('custom emptyOptionText', () => { const { dd } = makeDropdown({ emptyOptionText: 'None' }); dd.setOptions(PRESETS); expect(dd.menu.querySelector('.dss-preset-option[data-value=""]').textContent).toBe('None'); teardown(dd); });
    it('fallback placeholder', () => { const { dd } = makeDropdown({ placeholderText: '' }); expect(dd.label.textContent.length).toBeGreaterThan(0); teardown(dd); });
    it('fallback emptyOption', () => { const { dd } = makeDropdown({ emptyOptionText: '' }); dd.setOptions(PRESETS); expect(dd.menu.querySelector('.dss-preset-option[data-value=""]').textContent.length).toBeGreaterThan(0); teardown(dd); });
});

describe('mutant-kill: onChange optional', () => {
    it('no onChange no throw', () => { const dd = createPresetDropdown({}); document.body.appendChild(dd.el); dd.setOptions(PRESETS); dd.open(); expect(() => dd.menu.querySelector('.dss-preset-option[data-value="p1"]').click()).not.toThrow(); dd.destroy(); });
    it('string onChange no throw', () => { const dd = createPresetDropdown({ onChange: 'x' }); document.body.appendChild(dd.el); dd.setOptions(PRESETS); dd.open(); expect(() => dd.menu.querySelector('.dss-preset-option[data-value="p1"]').click()).not.toThrow(); dd.destroy(); });
});
describe('mutant-kill: ARIA', () => {
    it('container aria-label', () => { const { dd } = makeDropdown(); expect(dd.el.getAttribute('aria-label')).toBeTruthy(); teardown(dd); });
    it('menu aria-label', () => { const { dd } = makeDropdown(); expect(dd.menu.getAttribute('aria-label')).toBeTruthy(); teardown(dd); });
});

describe('mutant-kill: exact DOM', () => {
    let dd; beforeEach(() => ({ dd } = makeDropdown())); afterEach(() => teardown(dd));
    it('trigger class', () => { expect(dd.trigger.className).toBe('dss-preset-trigger'); });
    it('trigger type', () => { expect(dd.trigger.type).toBe('button'); });
    it('label class', () => { expect(dd.label.className).toBe('dss-preset-label dss-preset-label--placeholder'); });
    it('arrow', () => { var a = dd.trigger.querySelector('.dss-preset-arrow'); expect(a).not.toBeNull(); expect(a.textContent).toBe('▾'); expect(a.getAttribute('aria-hidden')).toBe('true'); });
    it('menu class', () => { expect(dd.menu.className).toBe('dss-preset-menu'); });
    it('menu id', () => { expect(dd.menu.id).toBe('dss-preset-menu'); });
    it('aria-controls', () => { expect(dd.trigger.getAttribute('aria-controls')).toBe('dss-preset-menu'); });
    it('hierarchy', () => { expect(dd.el.contains(dd.trigger)).toBe(true); expect(dd.trigger.contains(dd.label)).toBe(true); expect(dd.trigger.querySelector('.dss-preset-arrow')).not.toBeNull(); });
    it('menu on body', () => { expect(dd.menu.parentNode).toBe(document.body); expect(dd.el.contains(dd.menu)).toBe(false); });
});

describe('mutant-kill: initial state', () => {
    let dd; beforeEach(() => ({ dd } = makeDropdown())); afterEach(() => teardown(dd));
    it('placeholder', () => { expect(dd.label.classList.contains('dss-preset-label--placeholder')).toBe(true); });
    it('no options', () => { expect(dd.menu.querySelectorAll('.dss-preset-option').length).toBe(0); });
});
describe('mutant-kill: open()', () => {
    let dd; beforeEach(() => { ({ dd } = makeDropdown()); dd.setOptions(PRESETS); }); afterEach(() => teardown(dd));
    it('fixed', () => { dd.open(); expect(dd.menu.style.position).toBe('fixed'); });
    it('highlights p2', () => { dd.setValue('p2'); dd.open(); var o = dd.menu.querySelectorAll('.dss-preset-option'); expect(o[2].classList.contains('dss-preset-option--active')).toBe(true); expect(o[0].classList.contains('dss-preset-option--active')).toBe(false); });
    it('defaults 0', () => { dd.open(); expect(dd.menu.querySelectorAll('.dss-preset-option')[0].classList.contains('dss-preset-option--active')).toBe(true); });
    it('idempotent', () => { dd.open(); dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); var b = dd.menu.querySelector('.dss-preset-option--active'); dd.open(); expect(dd.menu.querySelector('.dss-preset-option--active')).toBe(b); });
    it('aria-activedescendant', () => { dd.open(); expect(dd.el.hasAttribute('aria-activedescendant')).toBe(true); expect(dd.el.getAttribute('aria-activedescendant').length).toBeGreaterThan(0); });
});

describe('mutant-kill: close()', () => {
    let dd; beforeEach(() => { ({ dd } = makeDropdown()); dd.setOptions(PRESETS); }); afterEach(() => teardown(dd));
    it('removes active', () => { dd.open(); dd.close(); expect(dd.menu.querySelectorAll('.dss-preset-option--active').length).toBe(0); });
    it('removes activedescendant', () => { dd.open(); dd.close(); expect(dd.el.hasAttribute('aria-activedescendant')).toBe(false); });
    it('removes click-outside', async () => { dd.open(); await new Promise(r => setTimeout(r, 0)); dd.close(); dd.open(); expect(dd.menu.hidden).toBe(false); });
});

describe('mutant-kill: click-outside', () => {
    let dd; beforeEach(() => { ({ dd } = makeDropdown()); dd.setOptions(PRESETS); }); afterEach(() => teardown(dd));
    it('trigger stays', async () => { dd.open(); await new Promise(r => setTimeout(r, 0)); dd.trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); expect(dd.menu.hidden).toBe(false); });
    it('menu stays', async () => { dd.open(); await new Promise(r => setTimeout(r, 0)); dd.menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); expect(dd.menu.hidden).toBe(false); });
});
describe('mutant-kill: option click', () => {
    let dd, onChange; beforeEach(() => { ({ dd, onChange } = makeDropdown()); dd.setOptions(PRESETS); dd.open(); }); afterEach(() => teardown(dd));
    it('click menu noop', () => { dd.menu.click(); expect(onChange).not.toHaveBeenCalled(); expect(dd.menu.hidden).toBe(false); });
    it('click option onChange', () => { dd.menu.querySelector('.dss-preset-option[data-value="p1"]').click(); expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith('p1'); });
    it('click option label+close', () => { dd.menu.querySelector('.dss-preset-option[data-value="p2"]').click(); expect(dd.label.textContent).toBe('Preset Two'); expect(dd.menu.hidden).toBe(true); });
});

describe('mutant-kill: trigger click', () => {
    let dd; beforeEach(() => { ({ dd } = makeDropdown()); dd.setOptions(PRESETS); }); afterEach(() => teardown(dd));
    it('opens', () => { dd.trigger.click(); expect(dd.menu.hidden).toBe(false); });
    it('closes', () => { dd.trigger.click(); dd.trigger.click(); expect(dd.menu.hidden).toBe(true); });
});
describe('mutant-kill: setValue', () => {
    let dd; beforeEach(() => { ({ dd } = makeDropdown()); dd.setOptions(PRESETS); }); afterEach(() => teardown(dd));
    it('null', () => { dd.setValue('p1'); dd.setValue(null); expect(dd.label.classList.contains('dss-preset-label--placeholder')).toBe(true); });
    it('undefined', () => { dd.setValue('p1'); dd.setValue(undefined); expect(dd.label.classList.contains('dss-preset-label--placeholder')).toBe(true); });
    it('coerces numeric', () => { dd.setOptions([{ id: '123', name: 'Numeric' }]); dd.setValue(123); expect(dd.label.textContent).toBe('Numeric'); });
});

describe('mutant-kill: setOptions', () => {
    let dd; beforeEach(() => ({ dd } = makeDropdown())); afterEach(() => teardown(dd));
    it('non-array', () => { dd.setOptions('bad'); var o = dd.menu.querySelectorAll('.dss-preset-option'); expect(o.length).toBe(1); expect(o[0].getAttribute('data-value')).toBe(''); });
    it('resets gone value', () => { dd.setOptions(PRESETS); dd.setValue('p1'); dd.setOptions([{ id: 'p3', name: 'Three' }]); expect(dd.label.classList.contains('dss-preset-label--placeholder')).toBe(true); });
    it('preserves value', () => { dd.setOptions(PRESETS); dd.setValue('p1'); dd.setOptions([...PRESETS, { id: 'p3', name: 'Three' }]); expect(dd.label.textContent).toBe('Preset One'); });
});

describe('mutant-kill: updateLocale', () => {
    let dd; beforeEach(() => { ({ dd } = makeDropdown()); dd.setOptions(PRESETS); }); afterEach(() => teardown(dd));
    it('refreshes placeholder', () => { dd.setValue(''); dd.updateLocale(); expect(dd.label.textContent).toBeTruthy(); });
    it('no change selected', () => { dd.setValue('p1'); dd.updateLocale(); expect(dd.label.textContent).toBe('Preset One'); });
    it('empty option text', () => { dd.updateLocale(); var eo = dd.menu.querySelector('.dss-preset-option[data-value=""]'); expect(eo).not.toBeNull(); expect(eo.textContent.length).toBeGreaterThan(0); });
});

describe('mutant-kill: destroy', () => {
    it('removes el and menu', () => { const { dd } = makeDropdown(); dd.destroy(); expect(document.body.contains(dd.el)).toBe(false); expect(document.body.contains(dd.menu)).toBe(false); });
    it('no throw after', async () => { const { dd } = makeDropdown(); dd.setOptions(PRESETS); dd.open(); await new Promise(r => setTimeout(r, 0)); dd.destroy(); expect(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))).not.toThrow(); });
});
describe('mutant-kill: keyboard', () => {
    let dd, onChange; beforeEach(() => { ({ dd, onChange } = makeDropdown()); dd.setOptions(PRESETS); }); afterEach(() => teardown(dd));
    it('ArrowDown opens', () => { dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); expect(dd.menu.hidden).toBe(false); });
    it('Enter opens', () => { dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(dd.menu.hidden).toBe(false); });
    it('Tab closes', () => { dd.open(); dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); expect(dd.menu.hidden).toBe(true); expect(onChange).not.toHaveBeenCalled(); });
    it('Enter selects', () => { dd.open(); dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(onChange).toHaveBeenCalledWith('p1'); expect(dd.label.textContent).toBe('Preset One'); });
    it('Escape no change', () => { dd.setValue('p1'); dd.open(); dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(dd.menu.hidden).toBe(true); expect(dd.label.textContent).toBe('Preset One'); });
    it('ArrowDown wraps', () => { dd.open(); var c = dd.menu.querySelectorAll('.dss-preset-option').length; for (var i = 0; i < c; i++) dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); expect(dd.menu.querySelectorAll('.dss-preset-option')[0].classList.contains('dss-preset-option--active')).toBe(true); });
    it('ArrowUp wraps', () => { dd.open(); dd.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); var opts = dd.menu.querySelectorAll('.dss-preset-option'); expect(opts[opts.length - 1].classList.contains('dss-preset-option--active')).toBe(true); });
});
