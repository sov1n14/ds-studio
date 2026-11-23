/**
 * test/helpers/pacing.js — 把擬人節奏延伸到 Page 的 Keyboard、Mouse 與 Touchscreen 基本動作（使用者裁定：「keyboard／mouse 動作前加隨機停頓；量時序的 runUnpaced 例外維持不動」）。
 *
 * Requirement (every expected value below comes from that text, not from the implementation):
 *   - A pause of 0.3–1.5 s comes before each call of keyboard press/type/down/up/insertText, mouse click/dblclick/down/up/move/wheel and touchscreen tap.
 *   - No pause inside `runUnpaced`, none while DSS_E2E_PACE is off.
 *   - A drag (down, moves, up) pauses once per primitive and still completes in order.
 *   - Typing keeps its own 60–220 ms key gaps: `humanType` and `humanTypeAtFocus` pause once before the first key and never again per key.
 */
import { describe, it, expect } from 'vitest';
import { createPacer, createTyper, installActionPacing, installInputPacing } from '../helpers/pacing.js';

const ON = Object.freeze({ isEnabled: true, scale: 1 });
const OFF = Object.freeze({ isEnabled: false, scale: 0 });

// Listed in the requirement text.
const PRIMITIVES = {
    keyboard: ['press', 'type', 'down', 'up', 'insertText'],
    mouse: ['click', 'dblclick', 'down', 'up', 'move', 'wheel'],
    touchscreen: ['tap'],
};

// A constant rng pins every draw: a between-actions pause is 900 ms, a key gap 140 ms, a think pause 500 ms, so the three kinds can be told apart.
const MIDDLE_RNG = () => 0.5;
const BETWEEN_ACTIONS_MS = 900;

/** A stand-in for one Playwright input device class: every listed method logs `device.method(args)` and returns `device.method`. */
function fakeDeviceClass(device, methods, log) {
    const DeviceClass = class {};
    for (const method of methods) {
        DeviceClass.prototype[method] = async function fakeAction(...args) {
            log.push(`${device}.${method}(${args.join(',')})`);
            return `${device}.${method}`;
        };
    }
    return DeviceClass;
}

function setup(config = ON, rng = MIDDLE_RNG) {
    const log = [];
    const pacer = createPacer({
        config,
        rng,
        delay: async (ms) => { if (ms > 0) log.push(`wait:${ms}`); },
        extendBudget: () => {},
    });
    const page = {};
    for (const [device, methods] of Object.entries(PRIMITIVES)) page[device] = new (fakeDeviceClass(device, methods, log))();
    installInputPacing(page, pacer);
    const waits = () => log.filter((entry) => entry.startsWith('wait:')).map((entry) => Number(entry.slice(5)));
    return { log, pacer, page, waits };
}

describe('installInputPacing(page, pacer)', () => {
    for (const [device, methods] of Object.entries(PRIMITIVES)) {
        for (const method of methods) {
            it(`pauses 0.3–1.5 s before ${device}.${method}, then runs it with its arguments and result`, async () => {
                const { log, page, waits } = setup(ON, Math.random);
                const result = await page[device][method]('a', 'b');
                expect(result).toBe(`${device}.${method}`);
                expect(log).toHaveLength(2);
                expect(log[0]).toMatch(/^wait:/);
                expect(log[1]).toBe(`${device}.${method}(a,b)`);
                expect(waits()[0]).toBeGreaterThanOrEqual(300);
                expect(waits()[0]).toBeLessThanOrEqual(1_500);
            });
        }
    }

    it('runs a drag as down, move, up in order with one pause before each primitive', async () => {
        const { log, page, waits } = setup();
        await page.mouse.down();
        await page.mouse.move(10, 20);
        await page.mouse.up();
        expect(log).toEqual([
            `wait:${BETWEEN_ACTIONS_MS}`, 'mouse.down()',
            `wait:${BETWEEN_ACTIONS_MS}`, 'mouse.move(10,20)',
            `wait:${BETWEEN_ACTIONS_MS}`, 'mouse.up()',
        ]);
        expect(waits()).toHaveLength(3);
    });

    it('runs primitives inside runUnpaced without any pause, and pauses again after the scope ends', async () => {
        const { log, page, pacer, waits } = setup();
        await pacer.runUnpaced(async () => {
            await page.keyboard.press('Enter');
            await page.mouse.move(1, 2);
            await page.mouse.wheel(0, 100);
            await page.touchscreen.tap(3, 4);
        });
        expect(waits()).toEqual([]);
        expect(log).toHaveLength(4);
        await page.keyboard.press('Escape');
        expect(waits()).toHaveLength(1);
    });

    it('never pauses while pacing is off', async () => {
        const { log, page, waits } = setup(OFF);
        await page.keyboard.press('F5');
        await page.mouse.click(1, 2);
        await page.touchscreen.tap(3, 4);
        expect(log).toEqual(['keyboard.press(F5)', 'mouse.click(1,2)', 'touchscreen.tap(3,4)']);
        expect(waits()).toEqual([]);
    });

    it('installing again still pauses once per primitive', async () => {
        const { page, pacer, waits } = setup();
        installInputPacing(page, pacer);
        await page.mouse.click(1, 2);
        expect(waits()).toHaveLength(1);
    });
});

describe('typing keeps its own key gaps when the input primitives are paced', () => {
    const KEY_GAP_MS = 140;
    const TEXT = 'abcdefghijklmnopqrstuvwxyz1234';

    /** A stand-in for Playwright's Locator, paced like the real one (press, pressSequentially and fill pause first). */
    function fakeLocator(log, pacer, { value = '' } = {}) {
        const Locator = class {
            async evaluate() { return ''; }
            async selectText() { log.push('selectText'); }
            async inputValue() { return value; }
            async fill(text) { log.push(`fill(${text})`); }
            async press(key) { log.push(`press(${key})`); }
            async pressSequentially(text) { log.push(`pressSequentially(${text})`); }
        };
        installActionPacing(Locator.prototype, ['fill', 'press', 'pressSequentially'], pacer);
        return new Locator();
    }

    const betweenActionPauses = (waits) => waits.filter((ms) => ms === BETWEEN_ACTIONS_MS);
    const keyGaps = (waits) => waits.filter((ms) => ms === KEY_GAP_MS);

    it('humanTypeAtFocus pauses once before the first key, then only the 60–220 ms key gaps and think pauses', async () => {
        const { log, page, pacer, waits } = setup();
        await createTyper(pacer).humanTypeAtFocus(page.keyboard, TEXT);
        expect(betweenActionPauses(waits())).toHaveLength(1);
        expect(keyGaps(waits())).toHaveLength(TEXT.length);
        expect(log.filter((entry) => entry.startsWith('keyboard.type(')).map((entry) => entry.slice('keyboard.type('.length, -1)).join('')).toBe(TEXT);
    });

    it('humanTypeAtFocus presses a line break as Shift+Enter with the same single pause', async () => {
        const { log, page, pacer, waits } = setup();
        await createTyper(pacer).humanTypeAtFocus(page.keyboard, 'ab\ncd');
        expect(betweenActionPauses(waits())).toHaveLength(1);
        expect(log).toContain('keyboard.press(Shift+Enter)');
    });

    it('humanTypeAtFocus pastes text over 200 characters with one pause', async () => {
        const { log, page, pacer, waits } = setup();
        const long = 'x'.repeat(201);
        await createTyper(pacer).humanTypeAtFocus(page.keyboard, long);
        expect(log).toEqual([`wait:${BETWEEN_ACTIONS_MS}`, `keyboard.type(${long})`]);
        expect(waits()).toEqual([BETWEEN_ACTIONS_MS]);
    });

    it('humanTypeAtFocus types without any wait while pacing is off', async () => {
        const { log, page, pacer, waits } = setup(OFF);
        await createTyper(pacer).humanTypeAtFocus(page.keyboard, 'hello');
        expect(log).toEqual(['keyboard.type(hello)']);
        expect(waits()).toEqual([]);
    });

    it('humanType pauses once before the first key and types every character', async () => {
        const { log, pacer, waits } = setup();
        const locator = fakeLocator(log, pacer);
        await createTyper(pacer).humanType(locator, TEXT);
        expect(betweenActionPauses(waits())).toHaveLength(1);
        expect(keyGaps(waits())).toHaveLength(TEXT.length);
        expect(log.filter((entry) => entry.startsWith('pressSequentially(')).map((entry) => entry.slice('pressSequentially('.length, -1)).join('')).toBe(TEXT);
    });

    it('humanType fills an empty string with one pause, like a paste', async () => {
        const { log, pacer, waits } = setup();
        await createTyper(pacer).humanType(fakeLocator(log, pacer), '');
        expect(log).toEqual([`wait:${BETWEEN_ACTIONS_MS}`, 'fill()']);
        expect(waits()).toEqual([BETWEEN_ACTIONS_MS]);
    });
});
