/**
 * content/auto-retry.js — one shared auto-click loop for DeepSeek's retry and continue buttons.
 *
 * Requirement:
 *   - Gates: retry = master "isEnabled" ON && "isAutoRetryEnabled" true; continue = master ON && "isAutoContinueEnabled" true. Both own keys default false. Initial values come from DSS_GET_SETTINGS (both own keys requested), changes from DSS_SETTINGS_CHANGED (area 'local').
 *   - Location by window.DSstudio.Selectors only: retry = RETRY_BUTTON_SELECTOR, fallback RETRY_BUTTON_FALLBACK_SELECTOR; continue = CONTINUE_BUTTON_SELECTOR, fallback CONTINUE_BUTTON_FALLBACK_SELECTOR. Never by button text.
 *   - Timing: one setTimeout chain. While any gate is open: wait DSSAutoClickDelay.nextDelayMs() (floor(Math.random() * 31) * 100 ms), click each gated, present button once, schedule the next round with a fresh delay. At most one pending timer. No click cap. All gates closed -> no timer.
 *
 * Math.random is stubbed to pick the delay; fake timers drive the loop.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    MASTER_KEY, RETRY_KEY, CONTINUE_KEY, R_300, R_1500, R_2500, R_2700,
    selectors, RETRY_MARKUP, CONTINUE_MARKUP, RETRY_FALLBACK_ONLY_MARKUP, CONTINUE_FALLBACK_ONLY_MARKUP, DECOY_MARKUP,
    mount, clickSpy, stubRandom, installChromeRuntime, requestedKeys, broadcast, changes, loadAutoClick,
} from '../helpers/auto-click-harness.js';

const ALL_ON = { [MASTER_KEY]: true, [RETRY_KEY]: true, [CONTINUE_KEY]: true };
const RETRY_ONLY = { [MASTER_KEY]: true, [RETRY_KEY]: true, [CONTINUE_KEY]: false };
const CONTINUE_ONLY = { [MASTER_KEY]: true, [RETRY_KEY]: false, [CONTINUE_KEY]: true };
const FRESH_INSTALL = { [MASTER_KEY]: true, [RETRY_KEY]: false, [CONTINUE_KEY]: false };

/** [retry clicks, continue clicks] */
const counts = (retry, cont) => [retry.mock.calls.length, cont.mock.calls.length];

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    installChromeRuntime();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. Selector contract (window.DSstudio.Selectors)
// ─────────────────────────────────────────────────────────────────────────────

describe('selector contract', () => {
    it.each([
        ['RETRY_BUTTON_SELECTOR', '.ds-button--warning.ds-button--circle.ds-button--xs'],
        ['RETRY_BUTTON_FALLBACK_SELECTOR', '.a3b9bd76._76a2310'],
        ['CONTINUE_BUTTON_SELECTOR', '._8e85838 > .ds-button[role="button"]'],
        ['CONTINUE_BUTTON_FALLBACK_SELECTOR', '._6eef0b0'],
    ])('Selectors.%s === %s', (name, value) => {
        expect(selectors()[name]).toBe(value);
    });

    it.each([
        ['retry', RETRY_MARKUP, ['RETRY_BUTTON_SELECTOR', 'RETRY_BUTTON_FALLBACK_SELECTOR'], ['CONTINUE_BUTTON_SELECTOR', 'CONTINUE_BUTTON_FALLBACK_SELECTOR']],
        ['continue', CONTINUE_MARKUP, ['CONTINUE_BUTTON_SELECTOR', 'CONTINUE_BUTTON_FALLBACK_SELECTOR'], ['RETRY_BUTTON_SELECTOR', 'RETRY_BUTTON_FALLBACK_SELECTOR']],
    ])('the real %s button matches its own two selectors and neither of the other button', (name, markup, own, other) => {
        mount(markup);
        const el = document.querySelector(`[data-fixture="${name}"]`);
        const s = selectors();
        for (const key of [...own, ...other]) expect(s[key], `Selectors.${key} must be a string`).toBeTypeOf('string');
        expect(own.map((key) => el.matches(s[key])), `matches ${own.join(', ')}`).toEqual([true, true]);
        expect(other.map((key) => el.matches(s[key])), `matches ${other.join(', ')}`).toEqual([false, false]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. Initial settings request
// ─────────────────────────────────────────────────────────────────────────────

describe('initial settings request', () => {
    it('requests both own keys (and the master key) through GET_SETTINGS', async () => {
        await loadAutoClick(FRESH_INSTALL);

        expect(requestedKeys()).toEqual(expect.arrayContaining([MASTER_KEY, RETRY_KEY, CONTINUE_KEY]));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. Timing — random per-round delay
// ─────────────────────────────────────────────────────────────────────────────

describe('round timing', () => {
    it('waits exactly nextDelayMs() before the first click (1500 ms: none at 1499, one at 1500)', async () => {
        mount(RETRY_MARKUP);
        const retry = clickSpy('retry');
        stubRandom(R_1500);
        await loadAutoClick(RETRY_ONLY);

        vi.advanceTimersByTime(1499);
        expect(retry, 'no click before the first delay elapses').toHaveBeenCalledTimes(0);
        vi.advanceTimersByTime(1);
        expect(retry, 'one click when the first delay elapses').toHaveBeenCalledTimes(1);
    });

    it('draws a fresh delay for every round (300 ms, then 2700 ms, then 1500 ms)', async () => {
        mount(RETRY_MARKUP);
        const retry = clickSpy('retry');
        stubRandom(R_300, R_2700, R_1500);
        await loadAutoClick(RETRY_ONLY);

        vi.advanceTimersByTime(299);
        expect(retry, 't=299').toHaveBeenCalledTimes(0);
        vi.advanceTimersByTime(1);
        expect(retry, 't=300 (round 1)').toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2699);
        expect(retry, 't=2999').toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(retry, 't=3000 (round 2)').toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(1500);
        expect(retry, 't=4500 (round 3)').toHaveBeenCalledTimes(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. Gating — which buttons a round clicks
// ─────────────────────────────────────────────────────────────────────────────

describe('gating with both buttons present', () => {
    let retry;
    let cont;

    beforeEach(() => {
        mount(RETRY_MARKUP, CONTINUE_MARKUP);
        retry = clickSpy('retry');
        cont = clickSpy('continue');
        stubRandom(R_2500);
    });

    it('retry-only: clicks retry once per round, never continue', async () => {
        await loadAutoClick(RETRY_ONLY);

        vi.advanceTimersByTime(5000);

        expect(counts(retry, cont), '[retry, continue] after 2 rounds').toEqual([2, 0]);
    });

    it('continue-only: clicks continue once per round, never retry', async () => {
        await loadAutoClick(CONTINUE_ONLY);

        vi.advanceTimersByTime(5000);

        expect(counts(retry, cont), '[retry, continue] after 2 rounds').toEqual([0, 2]);
    });

    it('both on: clicks both in the same round', async () => {
        await loadAutoClick(ALL_ON);

        vi.advanceTimersByTime(2499);
        expect(counts(retry, cont), 't=2499').toEqual([0, 0]);
        vi.advanceTimersByTime(1);
        expect(counts(retry, cont), 't=2500 (round 1)').toEqual([1, 1]);
    });

    it('neither on (fresh install, master on): schedules no timer and clicks nothing', async () => {
        await loadAutoClick(FRESH_INSTALL);

        expect(vi.getTimerCount(), 'pending timers with both gates closed').toBe(0);
        vi.advanceTimersByTime(30000);
        expect(counts(retry, cont)).toEqual([0, 0]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. Live gate changes
// ─────────────────────────────────────────────────────────────────────────────

describe('live gate changes', () => {
    let retry;
    let cont;

    beforeEach(async () => {
        mount(RETRY_MARKUP, CONTINUE_MARKUP);
        retry = clickSpy('retry');
        cont = clickSpy('continue');
        stubRandom(R_2500);
        await loadAutoClick(ALL_ON);
        vi.advanceTimersByTime(2500);
    });

    it('turning retry off stops retry clicks from the next round; continue keeps going', () => {
        expect(counts(retry, cont), 'precondition: round 1').toEqual([1, 1]);

        broadcast(changes([RETRY_KEY, false, true]));
        vi.advanceTimersByTime(5000);

        expect(counts(retry, cont), 'after 2 more rounds').toEqual([1, 3]);
        expect(vi.getTimerCount(), 'loop still running for continue').toBe(1);
    });

    it('turning both own keys off clears the timer; turning one back on resumes with a fresh delay', () => {
        expect(counts(retry, cont), 'precondition: round 1').toEqual([1, 1]);

        broadcast(changes([RETRY_KEY, false, true], [CONTINUE_KEY, false, true]));
        expect(vi.getTimerCount(), 'timers after both gates closed').toBe(0);
        vi.advanceTimersByTime(30000);
        expect(counts(retry, cont), 'while both off').toEqual([1, 1]);

        broadcast(changes([CONTINUE_KEY, true, false]));
        vi.advanceTimersByTime(2499);
        expect(counts(retry, cont), '2499 ms after continue back on').toEqual([1, 1]);
        vi.advanceTimersByTime(1);
        expect(counts(retry, cont), '2500 ms after continue back on').toEqual([1, 2]);
    });

    it('master off clears the timer and stops both; master on resumes both', () => {
        expect(counts(retry, cont), 'precondition: round 1').toEqual([1, 1]);

        broadcast(changes([MASTER_KEY, false, true]));
        expect(vi.getTimerCount(), 'timers after master off').toBe(0);
        vi.advanceTimersByTime(30000);
        expect(counts(retry, cont), 'while master off').toEqual([1, 1]);

        broadcast(changes([MASTER_KEY, true, false]));
        vi.advanceTimersByTime(2500);
        expect(counts(retry, cont), 'one round after master on').toEqual([2, 2]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  6. Single shared loop
// ─────────────────────────────────────────────────────────────────────────────

describe('single shared loop', () => {
    let retry;
    let cont;

    beforeEach(() => {
        mount(RETRY_MARKUP, CONTINUE_MARKUP);
        retry = clickSpy('retry');
        cont = clickSpy('continue');
        stubRandom(R_2500);
    });

    it('with both gates open there is one timer and one click per button per round', async () => {
        await loadAutoClick(ALL_ON);

        expect(vi.getTimerCount(), 'timers with both gates open').toBe(1);
        vi.advanceTimersByTime(2500);
        expect(counts(retry, cont)).toEqual([1, 1]);
        expect(vi.getTimerCount(), 'timers after a round').toBe(1);
    });

    it('repeated toggling never leaves more than one loop running', async () => {
        await loadAutoClick(FRESH_INSTALL);

        for (let i = 0; i < 5; i++) {
            broadcast(changes([RETRY_KEY, true, false]));
            broadcast(changes([CONTINUE_KEY, true, false]));
            expect(vi.getTimerCount(), `timers with both on, cycle ${i}`).toBeLessThanOrEqual(1);
            broadcast(changes([RETRY_KEY, false, true]));
            expect(vi.getTimerCount(), `timers with continue only, cycle ${i}`).toBeLessThanOrEqual(1);
            broadcast(changes([CONTINUE_KEY, false, true]));
            expect(vi.getTimerCount(), `timers with both off, cycle ${i}`).toBe(0);
        }
        broadcast(changes([RETRY_KEY, true, false], [CONTINUE_KEY, true, false]));
        expect(vi.getTimerCount(), 'timers after toggling settles with both on').toBe(1);

        vi.advanceTimersByTime(2500);
        expect(counts(retry, cont), 'clicks in the first round').toEqual([1, 1]);
    });

    it('repeated identical broadcasts do not add loops', async () => {
        await loadAutoClick(ALL_ON);

        for (let i = 0; i < 5; i++) {
            broadcast(changes([MASTER_KEY, true, true], [RETRY_KEY, true, true], [CONTINUE_KEY, true, true]));
        }

        expect(vi.getTimerCount(), 'timers after 5 identical broadcasts').toBe(1);
        vi.advanceTimersByTime(2500);
        expect(counts(retry, cont), 'clicks in the first round').toEqual([1, 1]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  7. Persistence — no cap, missing buttons
// ─────────────────────────────────────────────────────────────────────────────

describe('loop persistence', () => {
    it('keeps clicking a persistent button every round (20 rounds, no cap)', async () => {
        mount(RETRY_MARKUP, CONTINUE_MARKUP);
        const retry = clickSpy('retry');
        const cont = clickSpy('continue');
        stubRandom(R_2500);
        await loadAutoClick(ALL_ON);

        vi.advanceTimersByTime(20 * 2500);

        expect(counts(retry, cont)).toEqual([20, 20]);
    });

    it('a round with the gated button absent clicks nothing and the loop continues', async () => {
        stubRandom(R_2500);
        await loadAutoClick(CONTINUE_ONLY);

        vi.advanceTimersByTime(2500);
        expect(vi.getTimerCount(), 'loop still scheduled after an empty round').toBe(1);

        vi.advanceTimersByTime(100);
        mount(CONTINUE_MARKUP);
        const cont = clickSpy('continue');
        vi.advanceTimersByTime(2399);
        expect(cont, 't=4999').toHaveBeenCalledTimes(0);
        vi.advanceTimersByTime(1);
        expect(cont, 't=5000 (round 2)').toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  8. Button location — selectors, fallbacks, never text
// ─────────────────────────────────────────────────────────────────────────────

describe('button location', () => {
    beforeEach(() => {
        stubRandom(R_2500);
    });

    it.each([
        ['retry', RETRY_FALLBACK_ONLY_MARKUP, RETRY_ONLY],
        ['continue', CONTINUE_FALLBACK_ONLY_MARKUP, CONTINUE_ONLY],
    ])('clicks a %s button matched only by its fallback selector', async (name, markup, values) => {
        mount(markup);
        const fallback = clickSpy(`${name}-fallback`);
        await loadAutoClick(values);

        vi.advanceTimersByTime(5000);

        expect(fallback, 'fallback-only button after 2 rounds').toHaveBeenCalledTimes(2);
    });

    it.each([
        ['retry', RETRY_FALLBACK_ONLY_MARKUP, RETRY_MARKUP, RETRY_ONLY],
        ['continue', CONTINUE_FALLBACK_ONLY_MARKUP, CONTINUE_MARKUP, CONTINUE_ONLY],
    ])('prefers the %s primary match over an earlier fallback-only element', async (name, fallbackMarkup, markup, values) => {
        mount(fallbackMarkup, markup);
        const fallback = clickSpy(`${name}-fallback`);
        const primary = clickSpy(name);
        await loadAutoClick(values);

        vi.advanceTimersByTime(2500);

        expect([primary.mock.calls.length, fallback.mock.calls.length], '[primary, fallback-only]').toEqual([1, 0]);
    });

    it('never clicks text-only decoys, before or after a real continue button appears', async () => {
        mount(DECOY_MARKUP);
        const decoys = ['decoy-div', 'decoy-button', 'decoy-span'].map((name) => clickSpy(name));
        await loadAutoClick(ALL_ON);

        vi.advanceTimersByTime(3 * 2500);
        expect(decoys.map((spy) => spy.mock.calls.length), 'decoy clicks with no real button').toEqual([0, 0, 0]);

        document.body.insertAdjacentHTML('beforeend', CONTINUE_MARKUP);
        const cont = clickSpy('continue');
        vi.advanceTimersByTime(2500);

        expect(cont, 'real continue button in the next round').toHaveBeenCalledTimes(1);
        expect(decoys.map((spy) => spy.mock.calls.length), 'decoy clicks after the real button appears').toEqual([0, 0, 0]);
    });
});
