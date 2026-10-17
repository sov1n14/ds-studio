/**
 * Auto-click feature — targeted tests for behaviors the main specs left unpinned (surviving Stryker mutants).
 *
 * Requirements asserted:
 *   A. content/auto-retry.js starts on load and needs content/auto-click.delay.js (globalThis.DSSAutoClickDelay) loaded first. Without it, loading fails with an Error and no round timer is ever scheduled.
 *   B. A round whose activation attempt throws (the button's dispatchEvent throws) is reported through console.error and does not stop the loop: the next round is still scheduled and activates the button.
 *   C. popup live sync: a storage change removing isAutoRetryEnabled / isAutoContinueEnabled (newValue undefined) shows the setting's default, false, so the checkbox unchecks.
 *   E. With both gates open and both buttons present, an activation attempt that throws on one button does not skip activating the other button in the same round (checked for each button, so iteration order does not matter), the console.error report names the failing button, and the next round is still scheduled.
 *   "Activated" = the button's React onClick guard accepted the event (harness guardButton); a bare click event is not success.
 *   D. popup toggles: changing #autoRetryToggle / #autoContinueToggle shows the save-status indicator (ctx.showSaveStatus, the popup's injected indicator) after the change is saved.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';
import { mountPopupHtml } from '../helpers/popup-master-switch-harness.js';
import {
    MASTER_KEY, RETRY_KEY, CONTINUE_KEY, R_2500, RETRY_MARKUP, CONTINUE_MARKUP,
    mount, guardButton, stubRandom, installChromeRuntime, respondWith, loadAutoClick, settle,
} from '../helpers/auto-click-harness.js';

const K = StorageManager.KEYS;

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

// ── A. delay module is a hard dependency ──

describe('auto-retry.js loaded without auto-click.delay.js', () => {
    let savedDelay;

    beforeEach(() => {
        vi.useFakeTimers();
        installChromeRuntime();
        savedDelay = globalThis.DSSAutoClickDelay;
    });

    afterEach(() => {
        globalThis.DSSAutoClickDelay = savedDelay;
    });

    it('fails to load with an Error and schedules no round timer, even with every gate on', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        respondWith({ [MASTER_KEY]: true, [RETRY_KEY]: true, [CONTINUE_KEY]: true });
        mount(RETRY_MARKUP);
        const retry = guardButton('retry');
        vi.resetModules();
        await import('../../content/feature-toggle.js');
        delete globalThis.DSSAutoClickDelay;

        const loading = import('../../content/auto-retry.js');

        await expect(loading, 'loading auto-retry.js without its delay dependency').rejects.toBeInstanceOf(Error);
        await settle();
        expect(vi.getTimerCount(), 'pending timers after the failed start').toBe(0);
        vi.advanceTimersByTime(30000);
        expect(retry, 'activations after the failed start').toHaveBeenCalledTimes(0);
    });
});

/** Make fixture `name`'s dispatchEvent throw on the first `throwTimes` calls, then dispatch normally. Returns the call counter; assert only that it grows, since how many events one activation dispatches is not part of the contract. */
function throwOnDispatch(name, failure, throwTimes) {
    const button = document.querySelector(`[data-fixture="${name}"]`);
    const dispatch = button.dispatchEvent.bind(button);
    const state = { attempts: 0 };
    button.dispatchEvent = (event) => {
        state.attempts += 1;
        if (state.attempts <= throwTimes) throw failure;
        return dispatch(event);
    };
    return state;
}

// ── B. a throwing activation attempt does not kill the loop ──

describe('auto-click round whose activation attempt throws', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        installChromeRuntime();
        stubRandom(R_2500);
    });

    it('reports the error and still runs the next round, which activates the button', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mount(RETRY_MARKUP);
        const activated = guardButton('retry');
        const failure = new Error('dispatch blew up');
        const retry = throwOnDispatch('retry', failure, 1);
        await loadAutoClick({ [MASTER_KEY]: true, [RETRY_KEY]: true, [CONTINUE_KEY]: false });

        expect(() => vi.advanceTimersByTime(2500), 'round 1 (attempt throws) must not escape the timer').not.toThrow();
        expect(retry.attempts, 'round 1 attempted the retry button').toBeGreaterThan(0);
        expect(errorSpy.mock.calls.some((args) => args.includes(failure)), 'the thrown error is reported via console.error').toBe(true);
        expect(vi.getTimerCount(), 'next round scheduled after the failed round').toBe(1);

        vi.advanceTimersByTime(2500);
        expect(activated, 'round 2 activated the retry button').toHaveBeenCalledTimes(1);
    });
});

// ── E. a throwing attempt on one button does not skip the other in the same round ──

describe('auto-click round with both gates open where one button activation attempt throws', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        installChromeRuntime();
        stubRandom(R_2500);
    });

    it.each([
        // [throwing fixture, surviving fixture]
        ['retry', 'continue'],
        ['continue', 'retry'],
    ])('%s attempt throws: %s is still activated in that round, and the next round runs', async (failing, surviving) => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mount(RETRY_MARKUP, CONTINUE_MARKUP);
        guardButton(failing);
        const other = guardButton(surviving);
        const failure = new Error(`${failing} dispatch blew up`);
        const broken = throwOnDispatch(failing, failure, Infinity);
        await loadAutoClick({ [MASTER_KEY]: true, [RETRY_KEY]: true, [CONTINUE_KEY]: true });

        expect(() => vi.advanceTimersByTime(2500), 'round 1 must not escape the timer').not.toThrow();
        const round1Attempts = broken.attempts;
        expect(round1Attempts, `round 1 attempted the ${failing} button`).toBeGreaterThan(0);
        expect(other, `round 1 activated ${surviving} despite the ${failing} attempt throwing`).toHaveBeenCalledTimes(1);
        const reports = errorSpy.mock.calls.filter((args) => args.includes(failure)).map(([message]) => String(message));
        expect(reports.length, `round 1 reported the ${failing} failure via console.error`).toBeGreaterThan(0);
        expect(reports.every((message) => message.includes(failing)), `the report names the failing button (${failing}): ${JSON.stringify(reports)}`).toBe(true);
        expect(vi.getTimerCount(), 'next round scheduled after round 1').toBe(1);

        vi.advanceTimersByTime(2500);
        expect(broken.attempts, `round 2 attempted the ${failing} button again`).toBeGreaterThan(round1Attempts);
        expect(other, `round 2 activated ${surviving} again`).toHaveBeenCalledTimes(2);
    });
});

// ── popup modules (classic-script factories, eval-loaded as in popup-live-sync.spec.js / popup-auto-click-toggles.spec.js) ──

const POPUP_TOGGLES = [
    // [storage key, element id]
    [K.AUTO_RETRY, 'autoRetryToggle'],
    [K.AUTO_CONTINUE, 'autoContinueToggle'],
];

beforeAll(() => {
    evalPopupScript('popup/popup.live-sync.js');
    evalPopupScript('popup/popup.toggles.js');
});

/** Real popup.html DOM keyed by id, plus the websearch radio group. */
function buildPopupDom() {
    mountPopupHtml();
    const dom = {};
    document.querySelectorAll('[id]').forEach((el) => { dom[el.id] = el; });
    dom.websearchRadios = [...document.querySelectorAll('input[name="websearchToggle"]')];
    return dom;
}

// ── C. live sync: key removed -> default false ──

describe('popup live sync — auto-click key removed from storage', () => {
    function startLiveSync(dom) {
        let listener;
        vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation((fn) => { listener = fn; });
        window.__DS_PopupLiveSync.createLiveSyncListener({
            StorageManager,
            dom,
            applyMasterSwitchUI: () => {},
            updateEditPresetBtnState: () => {},
            getPresets: () => [],
            setPresets: () => {},
            getActivePresetId: () => '',
            setActivePresetId: () => {},
            getChatPresetMap: () => ({}),
            setChatPresetMap: () => {},
            getCustomSelect: () => null,
        }).start();
        expect(listener, 'start() registered a storage listener').toBeTypeOf('function');
        return listener;
    }

    it.each(POPUP_TOGGLES)('%s removed (newValue undefined) unchecks #%s', (key, id) => {
        const dom = buildPopupDom();
        dom[id].checked = true;
        const listener = startLiveSync(dom);

        listener({ [key]: { oldValue: true, newValue: undefined } }, 'local');

        expect(dom[id].checked, `#${id} after ${key} was removed`).toBe(false);
    });
});

// ── D. toggles: change shows the save-status indicator ──

describe('popup toggles — auto-click checkbox change shows the save status', () => {
    it.each(POPUP_TOGGLES)('%s: changing #%s shows the save status once', async (_key, id) => {
        const dom = buildPopupDom();
        const showSaveStatus = vi.fn();
        window.__DS_PopupToggles.createToggleManager({
            StorageManager,
            refreshSyncStatus: async () => {},
            showSaveStatus,
            applyMasterSwitchUI: () => {},
            getPresets: () => [],
            setPresets: () => {},
            getActivePresetId: () => '',
            setActivePresetId: () => {},
        }).bindToggles(dom);

        // Storage chain settles on chained setTimeout(0) turns; drain it in virtual time.
        vi.useFakeTimers();
        dom[id].checked = true;
        dom[id].dispatchEvent(new Event('change'));
        await vi.advanceTimersByTimeAsync(1000);

        expect(showSaveStatus, `save status shown after changing #${id}`).toHaveBeenCalledTimes(1);
    });
});
