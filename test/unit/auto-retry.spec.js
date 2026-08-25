/**
 * content/auto-retry.js — retry-button detection, polling and master-switch gating.
 *
 * Settings surface: the module owns no storage access. It hands master-switch
 * gating to content/feature-toggle.js, which asks background for the initial
 * value (DSS_GET_SETTINGS) and reacts to DSS_SETTINGS_CHANGED broadcasts.
 * Tests therefore drive it through chrome.runtime: a stubbed sendMessage for
 * the initial GET, and onMessage.callListeners() for later changes.
 *
 * feature-toggle keeps its registry and its shared onMessage listener in module
 * scope, so every test loads a fresh copy (vi.resetModules + dynamic import)
 * bound to that test's chrome stubs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/settings-message-constants.js';

const MASTER_KEY = 'isEnabled';
const UNRELATED_KEY = 'dsHideThinking';

// ─────────────────────────────────────────────────────────────────────────────
//  DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

const RETRY_MARKUP =
    '<div role="button" class="ds-button ds-button--warning ds-button--filled ds-button--circle ds-button--xs ds-button--icon-relative-m a3b9bd76 _76a2310" tabindex="0"></div>';

function addRetryButton() {
    document.body.innerHTML = RETRY_MARKUP;
    return document.body.firstElementChild;
}

function addFallbackOnlyButton() {
    // Only the hashed classes are present — the primary semantic selector
    // (.ds-button--warning.ds-button--circle.ds-button--xs) must not match.
    const el = document.createElement('div');
    el.className = 'a3b9bd76 _76a2310';
    document.body.appendChild(el);
    return el;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Messaging harness (same shape as width-feature.spec.js)
// ─────────────────────────────────────────────────────────────────────────────

/** Fresh chrome.runtime.onMessage stub with a fireable listener set. */
function createOnMessageStub() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        callListeners: (...args) => [...listeners].forEach((fn) => fn(...args)),
        listenerCount: () => listeners.size,
    };
}

let onMessage;
let sendMessage;
let AutoRetry;

/** Queue the values every GET_SETTINGS round trip resolves with. */
function respondWith(values) {
    sendMessage.mockImplementation((_message, callback) => {
        const response = { ok: true, values };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

/** Let the pending sendMessage promise chains settle. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Storage-change payload shape: { key: { oldValue, newValue } }. */
function change(key, newValue, oldValue) {
    return { [key]: { oldValue, newValue } };
}

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
function broadcast(changes, area = 'local') {
    onMessage.callListeners(
        { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes },
        { id: 'test-extension-id' },
        () => {},
    );
}

/**
 * Load a fresh AutoRetry (and a fresh feature-toggle) whose module-load
 * auto-start sees `values` as the answer to its initial GET_SETTINGS.
 */
async function loadAutoRetry(values = { [MASTER_KEY]: false }) {
    respondWith(values);
    vi.resetModules();
    await import('../../content/feature-toggle.js');
    AutoRetry = (await import('../../content/auto-retry.js')).default;
    await flush();
    return AutoRetry;
}

function stopTimer() {
    if (AutoRetry && AutoRetry._timer) {
        clearInterval(AutoRetry._timer);
        AutoRetry._timer = null;
    }
    if (AutoRetry) AutoRetry.enabled = false;
}

beforeEach(async () => {
    document.body.innerHTML = '';
    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;
    await loadAutoRetry();
});

afterEach(() => {
    stopTimer();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. _findRetryButton()
// ─────────────────────────────────────────────────────────────────────────────

describe('_findRetryButton()', () => {
    it('finds the button via the primary semantic selector', () => {
        const el = addRetryButton();
        expect(AutoRetry._findRetryButton()).toBe(el);
    });

    it('falls back to the hashed selector when only hashed classes are present', () => {
        const el = addFallbackOnlyButton();
        expect(AutoRetry._findRetryButton()).toBe(el);
    });

    it('returns null when no retry button is present', () => {
        expect(AutoRetry._findRetryButton()).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. _tick()
// ─────────────────────────────────────────────────────────────────────────────

describe('_tick()', () => {
    it('clicks the retry button when enabled', () => {
        const el = addRetryButton();
        const clickSpy = vi.fn();
        el.addEventListener('click', clickSpy);
        AutoRetry.enabled = true;
        AutoRetry._tick();
        expect(clickSpy).toHaveBeenCalledOnce();
    });

    it('does not click when enabled is false', () => {
        const el = addRetryButton();
        const clickSpy = vi.fn();
        el.addEventListener('click', clickSpy);
        AutoRetry.enabled = false;
        AutoRetry._tick();
        expect(clickSpy).not.toHaveBeenCalled();
    });

    it('does not throw when no retry button is present', () => {
        AutoRetry.enabled = true;
        expect(() => AutoRetry._tick()).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. enable() / disable()
// ─────────────────────────────────────────────────────────────────────────────

describe('enable()', () => {
    it('sets enabled = true', () => {
        AutoRetry.enable();
        expect(AutoRetry.enabled).toBe(true);
    });

    it('creates a timer', () => {
        AutoRetry.enable();
        expect(AutoRetry._timer).not.toBeNull();
    });

    it('is idempotent — does not replace an existing timer on second call', () => {
        AutoRetry.enable();
        const timer = AutoRetry._timer;
        AutoRetry.enable();
        expect(AutoRetry._timer).toBe(timer);
    });
});

describe('disable()', () => {
    it('is idempotent — does nothing if not enabled', () => {
        expect(() => AutoRetry.disable()).not.toThrow();
        expect(AutoRetry.enabled).toBe(false);
    });

    it('sets enabled = false', () => {
        AutoRetry.enable();
        AutoRetry.disable();
        expect(AutoRetry.enabled).toBe(false);
    });

    it('clears and nulls the timer', () => {
        AutoRetry.enable();
        AutoRetry.disable();
        expect(AutoRetry._timer).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. Timer behaviour (fake timers)
// ─────────────────────────────────────────────────────────────────────────────

describe('timer behaviour', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clicks a persistent button once per second while enabled', () => {
        const el = addRetryButton();
        const clickSpy = vi.fn();
        el.addEventListener('click', clickSpy);

        AutoRetry.enable();
        vi.advanceTimersByTime(3000);

        expect(clickSpy).toHaveBeenCalledTimes(3);
    });

    it('stops clicking after disable()', () => {
        const el = addRetryButton();
        const clickSpy = vi.fn();
        el.addEventListener('click', clickSpy);

        AutoRetry.enable();
        vi.advanceTimersByTime(3000);
        expect(clickSpy).toHaveBeenCalledTimes(3);

        AutoRetry.disable();
        vi.advanceTimersByTime(3000);
        expect(clickSpy).toHaveBeenCalledTimes(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. start() — master-switch integration over the messaging pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('start()', () => {
    it('asks background for the master key and nothing else', async () => {
        sendMessage.mockClear();

        AutoRetry.start();
        await flush();

        expect(sendMessage).toHaveBeenCalledWith({
            type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS,
            keys: [MASTER_KEY],
        });
    });

    it('enables when background reports isEnabled: true', async () => {
        await loadAutoRetry({ [MASTER_KEY]: true });

        expect(AutoRetry.enabled).toBe(true);
    });

    it('stays disabled when background reports isEnabled: false', async () => {
        await loadAutoRetry({ [MASTER_KEY]: false });

        expect(AutoRetry.enabled).toBe(false);
    });
});

describe('SETTINGS_CHANGED broadcasts', () => {
    it('enables when the master key changes to true', async () => {
        await loadAutoRetry({ [MASTER_KEY]: false });

        broadcast(change(MASTER_KEY, true, false));

        expect(AutoRetry.enabled).toBe(true);
    });

    it('disables when the master key changes to false', async () => {
        await loadAutoRetry({ [MASTER_KEY]: true });
        expect(AutoRetry.enabled).toBe(true);

        broadcast(change(MASTER_KEY, false, true));

        expect(AutoRetry.enabled).toBe(false);
    });

    it('ignores a change naming only other keys', async () => {
        await loadAutoRetry({ [MASTER_KEY]: false });

        broadcast(change(UNRELATED_KEY, true, false));

        expect(AutoRetry.enabled).toBe(false);
    });
});
