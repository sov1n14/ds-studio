/**
 * Scenario — the shared auto-click loop follows the feature-toggle state across a broadcast sequence.
 *
 * Trigger (CLAUDE.md Scenario Unit Tests): cross-module mutable state — content/feature-toggle.js owns the gate state, content/auto-retry.js reads it to decide which buttons each round activates.
 * Real modules: feature-toggle.js, auto-click.delay.js, auto-retry.js, react-click-bridge.main.js, ds-selectors.js. Mocked trust boundary: chrome.runtime (sendMessage / onMessage) only. Math.random is stubbed to fix the round delay at 2500 ms.
 * Assertions are on the observable end state per phase: which buttons got activated (their React onClick guard accepted the event), and whether a round is pending.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    MASTER_KEY, RETRY_KEY, CONTINUE_KEY, R_2500, RETRY_MARKUP, CONTINUE_MARKUP,
    mount, guardButton, stubRandom, installChromeRuntime, broadcast, changes, loadAutoClick, settle,
} from '../helpers/auto-click-harness.js';

const ROUND_MS = 2500;
const ALL_OFF = { [MASTER_KEY]: false, [RETRY_KEY]: false, [CONTINUE_KEY]: false };

let sendMessage;
let retry;
let cont;

/** Activations each button received during `rounds` more rounds. */
function activationsOver(rounds) {
    const before = [retry.mock.calls.length, cont.mock.calls.length];
    vi.advanceTimersByTime(rounds * ROUND_MS);
    return { retry: retry.mock.calls.length - before[0], continue: cont.mock.calls.length - before[1] };
}

beforeEach(() => {
    vi.useFakeTimers();
    ({ sendMessage } = installChromeRuntime());
    mount(RETRY_MARKUP, CONTINUE_MARKUP);
    retry = guardButton('retry');
    cont = guardButton('continue');
    stubRandom(R_2500);
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('broadcast sequence: master on -> autoContinue on -> autoRetry on -> master off -> master on', () => {
    it('activates exactly the gated buttons in each phase', async () => {
        await loadAutoClick(ALL_OFF);
        expect(activationsOver(3), 'phase 0: everything off').toEqual({ retry: 0, continue: 0 });

        broadcast(changes([MASTER_KEY, true, false]));
        expect(vi.getTimerCount(), 'phase 1 timers: master on, own keys off').toBe(0);
        expect(activationsOver(3), 'phase 1: master on, own keys off').toEqual({ retry: 0, continue: 0 });

        broadcast(changes([CONTINUE_KEY, true, false]));
        expect(activationsOver(3), 'phase 2: autoContinue on').toEqual({ retry: 0, continue: 3 });

        broadcast(changes([RETRY_KEY, true, false]));
        expect(vi.getTimerCount(), 'phase 3 timers: both on').toBe(1);
        expect(activationsOver(3), 'phase 3: autoRetry on too').toEqual({ retry: 3, continue: 3 });

        broadcast(changes([MASTER_KEY, false, true]));
        expect(vi.getTimerCount(), 'phase 4 timers: master off').toBe(0);
        expect(activationsOver(3), 'phase 4: master off').toEqual({ retry: 0, continue: 0 });

        broadcast(changes([MASTER_KEY, true, false]));
        expect(vi.getTimerCount(), 'phase 5 timers: master back on').toBe(1);
        expect(activationsOver(3), 'phase 5: master back on, both own keys still on').toEqual({ retry: 3, continue: 3 });
    });
});

describe('initial GET_SETTINGS failure modes at the chrome.runtime boundary', () => {
    const failures = {
        'promise rejection': () => Promise.reject(new Error('Could not establish connection.')),
        'synchronous throw': () => { throw new Error('Extension context invalidated.'); },
        'timeout (never settles)': () => new Promise(() => {}),
    };

    it.each(Object.keys(failures))('%s: stays dormant, then a broadcast turning everything on starts the loop', async (mode) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        sendMessage.mockImplementation(failures[mode]);

        await loadAutoClick();
        await settle();
        expect(vi.getTimerCount(), 'timers after the failed initial read').toBe(0);
        expect(activationsOver(3), 'activations after the failed initial read').toEqual({ retry: 0, continue: 0 });

        broadcast(changes([MASTER_KEY, true, false], [RETRY_KEY, true, false], [CONTINUE_KEY, true, false]));
        expect(activationsOver(2), 'activations after the recovery broadcast').toEqual({ retry: 2, continue: 2 });
    });
});
