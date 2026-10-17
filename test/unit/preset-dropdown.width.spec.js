/**
 * getNaturalWidth() stability for the injected preset dropdown (#dss-preset-overlay).
 *
 * Requirement: the natural width equals what the widest option name needs plus the fixed trigger chrome, and re-measuring with the same option set returns the same value regardless of the overlay's current inline width. Live bug: the overlay grew wider on every in-chat preset switch (setOptions -> re-measure -> controller writes the result back as the overlay inline width).
 *
 * happy-dom has no layout engine, so this spec installs a small layout model at the trust boundary (element geometry getters), driven only by the real preset-dropdown.css and inline styles, never by the code under test:
 * - text content width = textContent.length * CHAR_PX.
 * - A flex item of the display:flex trigger gets its box from the flex algorithm: when the overlay has an inline px width W, the free space is W - trigger padding/border - gaps - the content widths of the other items. An item with computed flex-grow > 0 fills that free space; an item with flex-grow 0 keeps its content width (shrunk to the free space when flex-shrink > 0). Without an inline width the overlay is shrink-to-fit, so every item keeps its content width.
 * - clientWidth/offsetWidth/getBoundingClientRect().width = box width; scrollWidth = max(content width, box width), which is the browser rule for an overflow:hidden box.
 * - Any other element (for example a detached measuring probe) has box = content = its text width.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const { createPresetDropdown } = require('../../content/preset-dropdown.component.js');
const { createWidthMeasurer } = require('../../content/preset-dropdown.width.js');

const CHAR_PX = 7;
const SHORT = { id: 's', name: 'Tiny' };
const LONG = { id: 'l', name: 'A considerably longer preset name' };
const OPTIONS = [SHORT, LONG];

// ── layout model (trust boundary) ─────────────────────────────────────────

const px = (v) => parseFloat(v) || 0;
const textWidth = (el) => (el.textContent || '').length * CHAR_PX;

function inlinePxWidth(el) {
    const w = el && el.style ? el.style.width : '';
    return w && w.endsWith('px') ? px(w) : null;
}

function isFlexItemOfTrigger(el) {
    const parent = el.parentElement;
    return !!parent && parent.classList.contains('dss-preset-trigger') && getComputedStyle(parent).display === 'flex';
}

function triggerChrome(trigger) {
    const cs = getComputedStyle(trigger);
    const gap = px(cs.columnGap || cs.gap);
    return px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) + gap * Math.max(trigger.children.length - 1, 0);
}

function layout(el) {
    if (isFlexItemOfTrigger(el)) {
        const content = textWidth(el);
        const trigger = el.parentElement;
        const W = inlinePxWidth(trigger.closest('#dss-preset-overlay'));
        if (W === null) return { content, box: content };
        const others = Array.from(trigger.children).filter((c) => c !== el).reduce((sum, c) => sum + textWidth(c), 0);
        const free = Math.max(W - triggerChrome(trigger) - others, 0);
        const cs = getComputedStyle(el);
        if (px(cs.flexGrow) > 0) return { content, box: free };
        return { content, box: px(cs.flexShrink) > 0 ? Math.min(content, free) : content };
    }
    if (el.classList && el.classList.contains('dss-preset-trigger')) {
        const W = inlinePxWidth(el.closest('#dss-preset-overlay'));
        const natural = triggerChrome(el) + Array.from(el.children).reduce((sum, c) => sum + textWidth(c), 0);
        return { content: natural, box: W === null ? natural : W };
    }
    if (el.id === 'dss-preset-overlay') {
        const trigger = el.querySelector('.dss-preset-trigger');
        const W = inlinePxWidth(el);
        const natural = trigger ? layout(trigger).box : 0;
        return { content: natural, box: W === null ? natural : W };
    }
    const w = textWidth(el);
    return { content: w, box: w };
}

const GEOMETRY = {
    scrollWidth() { const l = layout(this); return Math.max(l.content, l.box); },
    clientWidth() { return layout(this).box; },
    offsetWidth() { return layout(this).box; },
};
const saved = {};
let styleEl;

beforeAll(() => {
    styleEl = document.createElement('style');
    styleEl.textContent = fs.readFileSync(path.resolve(__dirname, '../../content/preset-dropdown.css'), 'utf8');
    document.head.appendChild(styleEl);
    for (const [prop, get] of Object.entries(GEOMETRY)) {
        saved[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
        Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get });
    }
    saved.getBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
        const width = layout(this).box;
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 30, width, height: 30, toJSON() {} };
    };
});

afterAll(() => {
    for (const prop of Object.keys(GEOMETRY)) {
        if (saved[prop]) Object.defineProperty(HTMLElement.prototype, prop, saved[prop]);
        else delete HTMLElement.prototype[prop];
    }
    Element.prototype.getBoundingClientRect = saved.getBoundingClientRect;
    styleEl.remove();
});

// ── tests ─────────────────────────────────────────────────────────────────

describe('createPresetDropdown — getNaturalWidth() stability', () => {
    let dd;
    function make(selectedId) {
        dd = createPresetDropdown({ onChange() {} });
        document.body.appendChild(dd.el);
        dd.setOptions(OPTIONS);
        dd.setValue(selectedId);
        return dd;
    }
    afterEach(() => dd && dd.destroy());

    it('layout model sanity: a stretched label reports its box width, an unstretched one its text width', () => {
        make(SHORT.id);
        expect(dd.label.scrollWidth).toBe(SHORT.name.length * CHAR_PX);
        dd.el.style.width = '400px';
        expect(dd.label.scrollWidth).toBeGreaterThan(SHORT.name.length * CHAR_PX);
        dd.label.style.flex = 'none';
        expect(dd.label.scrollWidth).toBe(SHORT.name.length * CHAR_PX);
    });

    it('re-measuring after the controller writes the result back as the overlay width stays constant (repeated in-chat switches)', () => {
        make(SHORT.id);
        const widths = [dd.getNaturalWidth()];
        for (let i = 0; i < 5; i++) {
            dd.el.style.width = widths[widths.length - 1] + 'px';
            dd.setOptions(OPTIONS);
            dd.setValue(SHORT.id);
            widths.push(dd.getNaturalWidth());
        }
        expect(widths, 'natural width sequence across repeated setOptions + re-measure').toEqual(widths.map(() => widths[0]));
    });

    it('re-measuring with the same option set ignores the overlay current inline width', () => {
        make(SHORT.id);
        const baseline = dd.getNaturalWidth();
        const measured = [120, 300, 600].map((w) => {
            dd.el.style.width = w + 'px';
            dd.setOptions(OPTIONS);
            dd.setValue(SHORT.id);
            return dd.getNaturalWidth();
        });
        expect(measured, 'natural width at overlay inline widths 120/300/600px').toEqual([baseline, baseline, baseline]);
    });

    it('natural width is driven by the widest option, not the selected one', () => {
        const withShort = make(SHORT.id).getNaturalWidth();
        dd.destroy();
        const withLong = make(LONG.id).getNaturalWidth();
        expect(withShort).toBe(withLong);
        expect(withLong).toBeGreaterThanOrEqual(LONG.name.length * CHAR_PX);
    });
});

// Measurer contract (content/preset-dropdown.width.js createWidthMeasurer): measure(optionData, placeholderText) returns the width the trigger needs for the widest candidate (every option name plus the placeholder) plus the trigger's computed padding-left, padding-right and gap; the result is cached until invalidate(). Assertions compare two measurements so the fixed arrow allowance cancels out; the trigger gets a wide inline padding-left so every width sits above the 80px floor.
describe('createWidthMeasurer — contract', () => {
    let dd;
    let m;
    beforeEach(() => {
        dd = createPresetDropdown({ onChange() {} });
        document.body.appendChild(dd.el);
        dd.trigger.style.paddingLeft = '60px';
        m = createWidthMeasurer({ label: dd.label, trigger: dd.trigger });
    });
    afterEach(() => dd.destroy());
    const names = (...xs) => xs.map((name, i) => ({ id: String(i), name }));
    function fresh(optionData, placeholder) {
        m.invalidate();
        return m.measure(optionData, placeholder);
    }

    it.each([
        [undefined, /createWidthMeasurer: deps is required/],
        [{ trigger: {} }, /createWidthMeasurer: deps.label is required/],
        [{ label: {} }, /createWidthMeasurer: deps.trigger is required/],
    ])('throws an error naming the missing dependency (%o)', (deps, message) => {
        expect(() => createWidthMeasurer(deps)).toThrow(message);
    });

    it('width grows by exactly the extra text width of a longer widest option name', () => {
        const a = fresh(names('abcdef', 'ab'), 'x');
        const b = fresh(names('abcdefghij', 'ab'), 'x');
        expect(b - a).toBe(4 * CHAR_PX);
    });

    it('fits the placeholder when it is wider than every option name', () => {
        const optionsOnly = fresh(names('abcd'), 'abcd');
        const widePlaceholder = fresh(names('abcd'), 'abcdefghijkl');
        expect(widePlaceholder - optionsOnly).toBe(8 * CHAR_PX);
    });

    it('treats non-array option data as no options (placeholder decides the width)', () => {
        const none = fresh([], 'abcd');
        expect(fresh(null, 'abcd')).toBe(none);
        expect(fresh('not an array', 'abcd')).toBe(none);
    });

    it('returns the cached width until invalidate(), then re-measures', () => {
        m.invalidate();
        const short = m.measure(names('abcd'), 'a');
        expect(m.measure(names('abcdefghij'), 'a'), 'no invalidate: cached value').toBe(short);
        m.invalidate();
        expect(m.measure(names('abcdefghij'), 'a') - short, 'after invalidate').toBe(6 * CHAR_PX);
    });

    it.each([
        ['paddingLeft', '60px', '75px', 15],
        ['paddingRight', '6px', '26px', 20],
        ['gap', '4px', '11px', 7],
        ['paddingRight', '0px', '6px', 6],
        ['gap', '0px', '4px', 4],
    ])('accounts for the trigger computed %s (%s -> %s changes width by %i)', (prop, from, to, delta) => {
        dd.trigger.style[prop] = from;
        const before = fresh(names('abcd'), 'a');
        dd.trigger.style[prop] = to;
        expect(fresh(names('abcd'), 'a') - before).toBe(delta);
    });

    // Only a missing/unparseable gap may fall back to a default; the measurement must stay a finite number.
    it('falls back to a finite width when the trigger computed gap is unparseable (normal)', () => {
        dd.trigger.style.gap = 'normal';
        const width = fresh(names('abcd'), 'a');
        expect(Number.isFinite(width), `width with gap: normal was ${width}`).toBe(true);
    });
});

describe('createPresetDropdown — setOptions() invalidates the natural width', () => {
    it('grows to fit a longer new widest name and shrinks back for shorter names', () => {
        const dd = createPresetDropdown({ onChange() {} });
        document.body.appendChild(dd.el);
        dd.trigger.style.paddingLeft = '60px';
        dd.setOptions([{ id: 'a', name: 'abcdefgh' }]);
        const base = dd.getNaturalWidth();
        dd.setOptions([{ id: 'a', name: 'abcdefgh' }, { id: 'b', name: 'abcdefghijklmn' }]);
        const grown = dd.getNaturalWidth();
        dd.setOptions([{ id: 'c', name: 'abcdefghij' }]);
        const shrunk = dd.getNaturalWidth();
        dd.destroy();
        expect([grown - base, shrunk - base]).toEqual([6 * CHAR_PX, 2 * CHAR_PX]);
    });
});
