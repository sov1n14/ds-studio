/**
 * tools/human-pacing.mjs — human-like pacing for the tools scripts (tools/poc-login.mjs), reusing test/helpers/pacing.js.
 *
 * Requirement (user ruling, 「每個動作前隨機停 0.3–1.5 秒，送出文字改成逐字輸入」; expected values come from that text and from DSS_E2E_PACE, not from the implementation):
 *   - Every Page and Locator action (click, fill, press, goto, ...) waits 0.3–1.5 s first; evaluate and waitFor stay unpaced.
 *   - Installing on a second context of the same process (desktop pass, then mobile pass) adds no second pause.
 *   - typeText enters text key by key (60–220 ms per key, a line break as Shift+Enter) after one 0.3–1.5 s pause; the keys it presses add no pause of their own.
 *   - Text over 200 characters, or DSS_E2E_PACE=off, enters in one fill; with pacing off no action waits.
 */
import { describe, expect, it } from 'vitest';
import { createCapturePacing } from '../../tools/human-pacing.mjs';

const ON = { DSS_E2E_PACE: '1' };
const OFF = { DSS_E2E_PACE: 'off' };

/** Fake Playwright classes: instances share prototypes, as Page and Locator do, so a patch on the prototype reaches every instance. */
function createFakePlaywright(log) {
    class FakeLocator {
        async click() { log.push('click'); return 'clicked'; }
        async fill(text) { log.push(`fill:${text}`); }
        async press(key) { log.push(`press:${key}`); }
        async pressSequentially(key) { log.push(`key:${key}`); }
        async selectText() { log.push('selectText'); }
        async evaluate() { log.push('evaluate'); return 42; }
        async waitFor() { log.push('waitFor'); }
    }
    class FakePage {
        async goto(url) { log.push(`goto:${url}`); return 'response'; }
        async evaluate() { log.push('page.evaluate'); return 7; }
        locator() { return new FakeLocator(); }
    }
    const newContext = () => ({ pages: () => [new FakePage()], newPage: async () => new FakePage() });
    return { FakeLocator, FakePage, newContext };
}

/** Pacing whose delay resolves at once and logs `delay:<ms>`; every log entry shares one ordered timeline. */
function setup(env, rng = () => 0.5) {
    const log = [];
    const world = createFakePlaywright(log);
    const pacing = createCapturePacing({ env, rng, delay: async (ms) => { log.push(`delay:${ms}`); } });
    const delays = () => log.filter((entry) => entry.startsWith('delay:')).map((entry) => Number(entry.slice(6)));
    return { log, delays, pacing, ...world };
}

describe('installPacing(context)', () => {
    it('waits 0.3-1.5 s before each page and locator action and still returns the action result', async () => {
        const { log, delays, pacing, newContext } = setup(ON);
        const context = newContext();
        await pacing.installPacing(context);
        const page = context.pages()[0];

        expect(await page.goto('https://chat.deepseek.com/')).toBe('response');
        expect(await page.locator('textarea').click()).toBe('clicked');

        expect(log.map((entry) => entry.split(':')[0])).toEqual(['delay', 'goto', 'delay', 'click']);
        for (const ms of delays()) {
            expect(ms).toBeGreaterThanOrEqual(300);
            expect(ms).toBeLessThanOrEqual(1500);
        }
    });

    it('leaves evaluate and waitFor unpaced and keeps their results', async () => {
        const { log, pacing, newContext } = setup(ON);
        const context = newContext();
        await pacing.installPacing(context);
        const page = context.pages()[0];

        expect(await page.evaluate()).toBe(7);
        expect(await page.locator('html').evaluate()).toBe(42);
        await page.locator('html').waitFor();

        expect(log).toEqual(['page.evaluate', 'evaluate', 'waitFor']);
    });

    it('adds one pause per action when a second context of the same process installs again', async () => {
        const { log, delays, pacing, newContext } = setup(ON);
        const desktop = newContext();
        const mobile = newContext();
        await pacing.installPacing(desktop);
        await pacing.installPacing(mobile);

        await mobile.pages()[0].locator('textarea').click();

        expect(delays()).toHaveLength(1);
        expect(log.at(-1)).toBe('click');
    });

    it('opens a page to patch when the context has none', async () => {
        const { delays, pacing, FakePage } = setup(ON);
        const opened = new FakePage();
        await pacing.installPacing({ pages: () => [], newPage: async () => opened });

        await opened.goto('https://chat.deepseek.com/');

        expect(delays()).toHaveLength(1);
    });

    it('runs every action without any wait when DSS_E2E_PACE is off', async () => {
        const { log, delays, pacing, newContext } = setup(OFF);
        const context = newContext();
        await pacing.installPacing(context);
        const page = context.pages()[0];

        await page.goto('https://chat.deepseek.com/');
        await page.locator('textarea').click();

        expect(delays()).toEqual([]);
        expect(log).toEqual(['goto:https://chat.deepseek.com/', 'click']);
    });
});

describe('typeText(locator, text)', () => {
    it('presses the keys in order after one 0.3-1.5 s pause, with 60-220 ms before every key', async () => {
        const { log, pacing, newContext } = setup(ON);
        const context = newContext();
        await pacing.installPacing(context);
        const locator = context.pages()[0].locator('textarea');
        log.length = 0;

        await pacing.typeText(locator, 'Say hi');

        expect(log.filter((entry) => entry.startsWith('key:'))).toEqual([...'Say hi'].map((char) => `key:${char}`));
        expect(log.some((entry) => entry.startsWith('fill:'))).toBe(false);
        expect(log[0].startsWith('delay:')).toBe(true);
        expect(Number(log[0].slice(6))).toBeGreaterThanOrEqual(300);
        // Before each key there is a delay of 60-220 ms since the previous key (think pauses of 300-700 ms may add to it).
        let sinceLastKey = [];
        for (const entry of log.slice(1)) {
            if (entry.startsWith('delay:')) sinceLastKey.push(Number(entry.slice(6)));
            if (entry.startsWith('key:')) {
                expect(sinceLastKey.some((ms) => ms >= 60 && ms <= 220)).toBe(true);
                sinceLastKey = [];
            }
        }
    });

    it('adds no pause of its own for the keys it presses, even though press and pressSequentially are paced actions', async () => {
        const { delays, pacing, newContext } = setup(ON, () => 0.99);
        const context = newContext();
        await pacing.installPacing(context);
        const locator = context.pages()[0].locator('textarea');

        await pacing.typeText(locator, 'hello\nworld');

        // With rng pinned near 1 a between-actions pause is about 1488 ms, a key gap 218 ms, a think pause 696 ms.
        expect(delays().filter((ms) => ms >= 1000)).toHaveLength(1);
    });

    it('types a line break as Shift+Enter and never presses Enter', async () => {
        const { log, pacing, newContext } = setup(ON);
        const context = newContext();
        await pacing.installPacing(context);

        await pacing.typeText(context.pages()[0].locator('textarea'), 'a\nb');

        expect(log.filter((entry) => entry.startsWith('press:') || entry.startsWith('key:'))).toEqual(['key:a', 'press:Shift+Enter', 'key:b']);
    });

    it('replaces the current content: the field is selected before the first key', async () => {
        const { log, pacing, newContext } = setup(ON);
        const context = newContext();
        await pacing.installPacing(context);

        await pacing.typeText(context.pages()[0].locator('textarea'), 'hi');

        expect(log.indexOf('selectText')).toBeGreaterThanOrEqual(0);
        expect(log.indexOf('selectText')).toBeLessThan(log.indexOf('key:h'));
    });

    it('pastes text over 200 characters in one fill after one pause', async () => {
        const { log, delays, pacing, newContext } = setup(ON);
        const context = newContext();
        await pacing.installPacing(context);
        const longText = 'y'.repeat(201);

        await pacing.typeText(context.pages()[0].locator('textarea'), longText);

        expect(log.filter((entry) => entry.startsWith('fill:'))).toEqual([`fill:${longText}`]);
        expect(log.some((entry) => entry.startsWith('key:'))).toBe(false);
        expect(delays()).toHaveLength(1);
    });

    it('fills in one step with no wait when DSS_E2E_PACE is off', async () => {
        const { log, pacing, newContext } = setup(OFF);
        const context = newContext();
        await pacing.installPacing(context);

        await pacing.typeText(context.pages()[0].locator('textarea'), 'hello');

        expect(log).toEqual(['fill:hello']);
    });
});

describe('createCapturePacing', () => {
    it('rejects an invalid DSS_E2E_PACE and names the variable', () => {
        expect(() => createCapturePacing({ env: { DSS_E2E_PACE: 'fast' }, delay: async () => {} })).toThrow(/DSS_E2E_PACE/);
    });
});
