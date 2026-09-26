/**
 * Auto-click feature — targeted tests for behaviors the main specs left unpinned (surviving Stryker mutants).
 *
 * Requirements asserted:
 *   A. content/auto-retry.js starts on load and needs content/auto-click.delay.js (globalThis.DSSAutoClickDelay) loaded first. Without it, loading fails with an Error and no round timer is ever scheduled.
 *   B. A round whose button click throws is reported through console.error and does not stop the loop: the next round is still scheduled and clicks again.
 *   C. popup live sync: a storage change removing isAutoRetryEnabled / isAutoContinueEnabled (newValue undefined) shows the setting's default, false, so the checkbox unchecks.
 *   E. With both gates open and both buttons present, a click that throws on one button does not skip the other button in the same round (checked for each button, so iteration order does not matter), and the next round is still scheduled.
 *   D. popup toggles: changing #autoRetryToggle / #autoContinueToggle shows the save-status indicator (ctx.showSaveStatus, the popup's injected indicator) after the change is saved.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';
import { mountPopupHtml } from '../helpers/popup-master-switch-harness.js';
import {
    MASTER_KEY, RETRY_KEY, CONTINUE_KEY, R_2500, RETRY_MARKUP, CONTINUE_MARKUP,
    mount, clickSpy, stubRandom, installChromeRuntime, respondWith, loadAutoClick, settle,
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
        const retry = clickSpy('retry');
        vi.resetModules();
        await import('../../content/feature-toggle.js');
        delete globalThis.DSSAutoClickDelay;

        const loading = import('../../content/auto-retry.js');

        await expect(loading, 'loading auto-retry.js without its delay dependency').rejects.toBeInstanceOf(Error);
        await settle();
        expect(vi.getTimerCount(), 'pending timers after the failed start').toBe(0);
        vi.advanceTimersByTime(30000);
        expect(retry, 'clicks after the failed start').toHaveBeenCalledTimes(0);
    });
});

// ── B. a throwing click does not kill the loop ──

describe('auto-click round whose click throws', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        installChromeRuntime();
        stubRandom(R_2500);
    });

    it('reports the error and still runs the next round, which clicks again', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mount(RETRY_MARKUP);
        const button = document.querySelector('[data-fixture="retry"]');
        const failure = new Error('click handler blew up');
        let attempts = 0;
        button.click = () => {
            attempts += 1;
            if (attempts === 1) throw failure;
        };
        await loadAutoClick({ [MASTER_KEY]: true, [RETRY_KEY]: true, [CONTINUE_KEY]: false });

        expect(() => vi.advanceTimersByTime(2500), 'round 1 (click throws) must not escape the timer').not.toThrow();
        expect(attempts, 'round 1 attempted the click').toBe(1);
        expect(errorSpy.mock.calls.some((args) => args.includes(failure)), 'the thrown error is reported via console.error').toBe(true);
        expect(vi.getTimerCount(), 'next round scheduled after the failed round').toBe(1);

        vi.advanceTimersByTime(2500);
        expect(attempts, 'round 2 clicked again').toBe(2);
    });
});

// ── E. a throwing click on one button does not skip the other in the same round ──

describe('auto-click round with both gates open where one button click throws', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        installChromeRuntime();
        stubRandom(R_2500);
    });

    it.each([
        // [throwing fixture, surviving fixture]
        ['retry', 'continue'],
        ['continue', 'retry'],
    ])('%s click throws: %s is still clicked in that round, and the next round runs', async (failing, surviving) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mount(RETRY_MARKUP, CONTINUE_MARKUP);
        const other = clickSpy(surviving);
        let attempts = 0;
        document.querySelector(`[data-fixture="${failing}"]`).click = () => {
            attempts += 1;
            throw new Error(`${failing} click blew up`);
        };
        await loadAutoClick({ [MASTER_KEY]: true, [RETRY_KEY]: true, [CONTINUE_KEY]: true });

        expect(() => vi.advanceTimersByTime(2500), 'round 1 must not escape the timer').not.toThrow();
        expect(attempts, `round 1 attempted the ${failing} click`).toBe(1);
        expect(other, `round 1 clicked ${surviving} despite the ${failing} click throwing`).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount(), 'next round scheduled after round 1').toBe(1);

        vi.advanceTimersByTime(2500);
        expect(attempts, `round 2 attempted the ${failing} click again`).toBe(2);
        expect(other, `round 2 clicked ${surviving} again`).toHaveBeenCalledTimes(2);
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
