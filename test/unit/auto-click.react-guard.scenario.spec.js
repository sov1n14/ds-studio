/**
 * Scenario — the auto-click loop must activate DeepSeek's React-guarded buttons, not merely fire click events.
 *
 * Confirmed live defect (chat.deepseek.com, DevTools): the continue and retry buttons act only through React's onClick, whose parent handler runs only when e.nativeEvent.isTrusted === true && e.nativeEvent instanceof Event. The loop's button.click() (untrusted) was ignored, so auto-continue/auto-retry did nothing while every click-counting test stayed green. Calling the element's __reactProps$<random>.onClick with a trusted-looking nativeEvent from the MAIN world did activate it.
 *
 * Contract:
 *   - content/react-click-bridge.main.js runs in the MAIN world (manifest content_scripts entry with "world": "MAIN" on chat.deepseek.com). On a `dss:react-click` event reaching `document`, it calls the target element's own __reactProps$* onClick with { nativeEvent (passes the guard), target, currentTarget, preventDefault(), stopPropagation() }; with no such onClick it falls back to element.click().
 *   - content/auto-retry.js dispatches new CustomEvent('dss:react-click', { bubbles: true }) on each found button.
 *
 * Trigger (CLAUDE.md Scenario Unit Tests): cross-module state across worlds — the isolated-world loop decides, the MAIN-world bridge acts on the shared DOM. Real modules: feature-toggle.js, auto-click.delay.js, auto-retry.js, react-click-bridge.main.js, ds-selectors.js (one happy-dom document stands in for both worlds). Mocked trust boundary: chrome.runtime only. Math.random fixes the round delay at 2500 ms.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    MASTER_KEY, RETRY_KEY, CONTINUE_KEY, R_2500, RETRY_MARKUP, CONTINUE_MARKUP, BRIDGE_PATH,
    mount, clickSpy, guardButton, stubRandom, installChromeRuntime, loadAutoClick, loadBridge, isBridgePresent,
} from '../helpers/auto-click-harness.js';

const ROOT = path.resolve(__dirname, '../..');
const RETRY_ONLY = { [MASTER_KEY]: true, [RETRY_KEY]: true, [CONTINUE_KEY]: false };
const CONTINUE_ONLY = { [MASTER_KEY]: true, [RETRY_KEY]: false, [CONTINUE_KEY]: true };

const fixtureEl = (name) => document.querySelector(`[data-fixture="${name}"]`);
const reactClick = (el) => el.dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true }));

beforeEach(() => {
    vi.useFakeTimers();
    installChromeRuntime();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('bridge wiring', () => {
    it(`${BRIDGE_PATH} exists`, () => {
        expect(isBridgePresent(), `${BRIDGE_PATH} does not exist`).toBe(true);
    });

    it('manifest loads the bridge as a MAIN-world content script on chat.deepseek.com', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
        const entries = manifest.content_scripts.filter((entry) => entry.js?.includes(BRIDGE_PATH));

        expect(entries.map((entry) => ({ world: entry.world, isDeepSeek: entry.matches?.includes('*://chat.deepseek.com/*') })),
            `content_scripts entries loading ${BRIDGE_PATH}`).toEqual([{ world: 'MAIN', isDeepSeek: true }]);
    });
});

describe('guarded fixture (models the live onClick guard)', () => {
    it('an untrusted .click() does not activate the guarded button', () => {
        mount(CONTINUE_MARKUP);
        const activated = guardButton('continue');

        fixtureEl('continue').click();

        expect(activated, 'activations after an untrusted click').toHaveBeenCalledTimes(0);
    });

    it('the MAIN-world call observed live does activate it', () => {
        mount(CONTINUE_MARKUP);
        const activated = guardButton('continue');
        const el = fixtureEl('continue');
        const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));

        el[key].onClick({ nativeEvent: Object.create(Event.prototype, { isTrusted: { value: true } }) });

        expect(activated, 'activations after the live-verified call').toHaveBeenCalledTimes(1);
    });
});

describe('bridge: dss:react-click on an element', () => {
    beforeEach(async () => {
        await loadBridge();
    });

    it('activates a React-guarded button once, passing a usable synthetic event', () => {
        mount(CONTINUE_MARKUP);
        const activated = guardButton('continue');
        const el = fixtureEl('continue');

        reactClick(el);

        expect(activated, 'guarded button activations after dss:react-click').toHaveBeenCalledTimes(1);
        const [event] = activated.mock.calls[0];
        expect([event.target, event.currentTarget], 'synthetic event target / currentTarget').toEqual([el, el]);
        expect(() => { event.preventDefault(); event.stopPropagation(); }, 'preventDefault / stopPropagation are callable').not.toThrow();
    });

    it('falls back to a native click on an element without React props', () => {
        mount(CONTINUE_MARKUP);
        const clicked = clickSpy('continue');

        reactClick(fixtureEl('continue'));

        expect(clicked, 'native clicks on a plain element after dss:react-click').toHaveBeenCalledTimes(1);
    });
});

/** Spy on listener exceptions. Observed in this vitest + happy-dom setup: an exception thrown inside an event listener propagates out of dispatchEvent to the caller, with no ErrorEvent on window and no console.error — so the `not.toThrow()` around the dispatch is the assertion that detects an escape. The window `error` counter never fires here; it is kept as a guard for browser-like semantics (a real page reports listener exceptions as a window ErrorEvent and dispatchEvent returns normally) should happy-dom switch to them. The console.error spy silences and records the bridge's own [DSS] logs. */
function watchListenerErrors() {
    const errors = vi.fn();
    window.addEventListener('error', errors);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return { errors, stop: () => window.removeEventListener('error', errors) };
}

describe('bridge: robustness', () => {
    beforeEach(async () => {
        await loadBridge();
    });

    // Live DeepSeek: the inner span.ds-button__content carries a __reactProps$ expando with only className and children. The other rows are defensive: a props expando whose onClick is not callable, or whose value is null.
    it.each([
        ['props without onClick (live inner span)', { className: 'ds-button__content', children: '继续生成' }],
        ['props whose onClick is not a function', { className: 'ds-button__content', onClick: 'not-callable' }],
        ['props expando whose value is null', null],
    ])('%s: falls back to one native click without a listener error', (_label, props) => {
        mount(CONTINUE_MARKUP);
        const span = fixtureEl('continue').querySelector('.ds-button__content');
        span.__reactProps$s1 = props;
        const clicked = vi.fn();
        span.addEventListener('click', clicked);
        const watch = watchListenerErrors();

        try {
            expect(() => reactClick(span), 'dispatching dss:react-click').not.toThrow();
            expect(watch.errors, 'listener errors reported on window').toHaveBeenCalledTimes(0);
            expect(clicked, 'native clicks on the span').toHaveBeenCalledTimes(1);
        } finally {
            watch.stop();
        }
    });

    // Guideline: DOM event listeners catch and log console.error('[DSS] <context>:', err) instead of letting the error escape.
    it('a React onClick that throws is caught and logged as [DSS] react-click-bridge, not raised as a listener error', () => {
        mount(CONTINUE_MARKUP);
        const el = fixtureEl('continue');
        const thrown = new Error('onClick failed');
        el.__reactProps$t1 = { onClick: () => { throw thrown; } };
        const watch = watchListenerErrors();

        try {
            expect(() => reactClick(el), 'dispatching dss:react-click on a button whose onClick throws').not.toThrow();
            expect(watch.errors, 'listener errors reported on window').toHaveBeenCalledTimes(0);
            const bridgeLogs = vi.mocked(console.error).mock.calls.filter(([first]) => String(first).includes('[DSS] react-click-bridge'));
            expect(bridgeLogs.map((args) => args.includes(thrown)), 'console.error calls tagged [DSS] react-click-bridge (does each carry the thrown error?)').toEqual([true]);
        } finally {
            watch.stop();
        }
    });

    it('dss:react-click dispatched on document itself (not an Element) is ignored silently: no listener error, no [DSS] react-click-bridge log', () => {
        const watch = watchListenerErrors();

        try {
            expect(() => document.dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true })), 'dispatching on document').not.toThrow();
            expect(watch.errors, 'listener errors reported on window').toHaveBeenCalledTimes(0);
            const bridgeLogs = vi.mocked(console.error).mock.calls.filter(([first]) => String(first).includes('[DSS] react-click-bridge'));
            expect(bridgeLogs, 'console.error calls tagged [DSS] react-click-bridge').toEqual([]);
        } finally {
            watch.stop();
        }
    });
});

describe('auto-click loop + bridge on the guarded live buttons', () => {
    beforeEach(() => {
        stubRandom(R_2500);
    });

    it.each([
        ['continue', CONTINUE_MARKUP, CONTINUE_ONLY],
        ['retry', RETRY_MARKUP, RETRY_ONLY],
    ])('toggle on: the guarded %s button is activated once per round', async (name, markup, values) => {
        mount(markup);
        const activated = guardButton(name);
        await loadAutoClick(values);

        vi.advanceTimersByTime(2499);
        expect(activated, `${name} activations before the first round`).toHaveBeenCalledTimes(0);
        vi.advanceTimersByTime(1);
        expect(activated, `${name} activations after round 1 (guarded onClick must accept the event)`).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2500);
        expect(activated, `${name} activations after round 2`).toHaveBeenCalledTimes(2);
    });

    it('toggle on: a continue button without React props still gets one native click per round', async () => {
        mount(CONTINUE_MARKUP);
        const clicked = clickSpy('continue');
        await loadAutoClick(CONTINUE_ONLY);

        vi.advanceTimersByTime(2 * 2500);

        expect(clicked, 'native clicks on a plain continue button after 2 rounds').toHaveBeenCalledTimes(2);
    });
});
