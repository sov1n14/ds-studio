/**
 * content/mobile-homepage-cleanup.js — homepage cleanup lifecycle behavior.
 *
 * The module obtains its master-switch state through the shared toggle pipeline
 * (content/feature-toggle.js -> DSS_GET_SETTINGS / DSS_SETTINGS_CHANGED), and
 * delegates mobile detection to content/mobile-device.js. This spec therefore
 * drives it exclusively through those two seams: the GET_SETTINGS response the
 * background is stubbed to return, and SETTINGS_CHANGED broadcasts.
 *
 * Everything is asserted through DOM state (are the target elements gone?)
 * rather than through internal call sequences. The mobile-detection truth table
 * lives in test/unit/mobile-device.spec.js; only the one behavioral consequence
 * for this feature (a desktop navigator keeps the feature dormant) is asserted
 * here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/settings-message-constants.js';

const MASTER_KEY = 'isEnabled';
const UNRELATED_KEY = 'isHideThinkingEnabled';
const TARGET_CLASS = '_9579690';
const TARGET_SELECTOR = '._9579690';

/**
 * Fresh chrome.runtime.onMessage stub (same shape as the shared mock) plus a
 * listener count, so "the listener is gone after destroy" is checkable.
 */
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
let cleanup;

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

// ── Navigator / location helpers ────────────────────────────────────────────

function stubMobileTouch() {
    vi.stubGlobal('navigator', { maxTouchPoints: 2, userAgent: 'Chrome Desktop' });
}

function stubDesktop() {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Mozilla/5.0 Chrome Desktop' });
}

function stubHomepage() {
    vi.stubGlobal('location', { pathname: '/' });
}

function stubNonHomepage(path = '/a/chat/s/some-uuid') {
    vi.stubGlobal('location', { pathname: path });
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

function addTargetElements(count = 1) {
    const els = [];
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = TARGET_CLASS;
        document.body.appendChild(el);
        els.push(el);
    }
    return els;
}

const targetCount = () => document.querySelectorAll(TARGET_SELECTOR).length;

/** MutationObserver records are delivered asynchronously; give them a tick. */
function settleObserver() {
    return new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * (Re)load the module under test against the currently stubbed navigator,
 * location and GET_SETTINGS response. The module auto-starts on load, so the
 * arrangement must be in place BEFORE calling this.
 */
async function load() {
    if (cleanup) cleanup.destroy();

    // Fresh feature-toggle instance per load: its shared onMessage listener and
    // its registry are module state, and must attach to this test own stub.
    vi.resetModules();
    await import('../../content/mobile-device.js');
    await import('../../content/feature-toggle.js');
    const mod = await import('../../content/mobile-homepage-cleanup.js');
    cleanup = mod.default ?? mod;
    await flush();
    return cleanup;
}

beforeEach(async () => {
    document.body.innerHTML = '';
    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;

    stubMobileTouch();
    stubHomepage();
    cleanup = null;
    // Default arrangement: registered but dormant (master switch off).
    respondWith({ [MASTER_KEY]: false });
    await load();
});

afterEach(() => {
    if (cleanup) cleanup.destroy();
    cleanup = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. Device gating (one behavioral case; the detection truth table lives in
//     test/unit/mobile-device.spec.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('device gating', () => {
    it('a desktop navigator keeps the feature dormant: no cleanup, and a master-on broadcast changes nothing', async () => {
        stubDesktop();
        respondWith({ [MASTER_KEY]: true });
        addTargetElements(3);

        await load();

        expect(targetCount()).toBe(3);

        broadcast(change(MASTER_KEY, true));
        await settleObserver();

        expect(targetCount()).toBe(3);
        expect(cleanup.enabled).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. _isHomepage()
// ─────────────────────────────────────────────────────────────────────────────

describe('_isHomepage()', () => {
    it('returns true when pathname is "/"', () => {
        stubHomepage();
        expect(cleanup._isHomepage()).toBe(true);
    });

    it('returns false for a chat pathname', () => {
        stubNonHomepage('/a/chat/s/some-uuid');
        expect(cleanup._isHomepage()).toBe(false);
    });

    it('returns false for any non-root pathname', () => {
        stubNonHomepage('/settings');
        expect(cleanup._isHomepage()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. _removeTargetElements()
// ─────────────────────────────────────────────────────────────────────────────

describe('_removeTargetElements()', () => {
    it('removes all elements with class _9579690 from the DOM', () => {
        addTargetElements(3);
        expect(targetCount()).toBe(3);
        cleanup._removeTargetElements();
        expect(targetCount()).toBe(0);
    });

    it('does nothing if no target elements exist', () => {
        expect(() => cleanup._removeTargetElements()).not.toThrow();
        expect(targetCount()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. enable()
// ─────────────────────────────────────────────────────────────────────────────

describe('enable()', () => {
    it('does nothing if not a mobile device', () => {
        stubDesktop();
        cleanup.enable();
        expect(cleanup.enabled).toBe(false);
        expect(cleanup._observer).toBeNull();
    });

    it('is idempotent — the second call keeps the same observer', () => {
        cleanup.enable();
        const observer = cleanup._observer;

        cleanup.enable();

        expect(cleanup._observer).toBe(observer);
        expect(cleanup.enabled).toBe(true);
    });

    it('sets enabled = true', () => {
        cleanup.enable();
        expect(cleanup.enabled).toBe(true);
    });

    it('removes existing target elements when on the homepage', () => {
        stubHomepage();
        addTargetElements(3);

        cleanup.enable();

        expect(targetCount()).toBe(0);
    });

    it('does NOT remove target elements when not on the homepage', () => {
        stubNonHomepage();
        addTargetElements(3);

        cleanup.enable();

        expect(targetCount()).toBe(3);
    });

    it('starts an observer that clears target elements inserted later', async () => {
        stubHomepage();
        cleanup.enable();

        addTargetElements(2);
        await settleObserver();

        expect(targetCount()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. disable()
// ─────────────────────────────────────────────────────────────────────────────

describe('disable()', () => {
    it('is idempotent — does nothing if not enabled', () => {
        expect(cleanup.enabled).toBe(false);
        expect(() => cleanup.disable()).not.toThrow();
        expect(cleanup.enabled).toBe(false);
        expect(cleanup._observer).toBeNull();
    });

    it('sets enabled = false', () => {
        cleanup.enable();
        expect(cleanup.enabled).toBe(true);
        cleanup.disable();
        expect(cleanup.enabled).toBe(false);
    });

    it('stops the observer: elements inserted afterwards survive', async () => {
        stubHomepage();
        cleanup.enable();
        cleanup.disable();

        addTargetElements(2);
        await settleObserver();

        expect(cleanup._observer).toBeNull();
        expect(targetCount()).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  6. _startObserver() / _stopObserver()
// ─────────────────────────────────────────────────────────────────────────────

describe('_startObserver()', () => {
    it('creates a MutationObserver when none exists', () => {
        cleanup._startObserver();
        expect(cleanup._observer).not.toBeNull();
    });

    it('is idempotent — does not replace an existing observer on second call', () => {
        cleanup._startObserver();
        const first = cleanup._observer;
        cleanup._startObserver();
        expect(cleanup._observer).toBe(first);
    });
});

describe('_stopObserver()', () => {
    it('disconnects and nullifies the observer', () => {
        cleanup._startObserver();
        const obs = cleanup._observer;
        const disconnectSpy = vi.spyOn(obs, 'disconnect');
        cleanup._stopObserver();
        expect(disconnectSpy).toHaveBeenCalledOnce();
        expect(cleanup._observer).toBeNull();
    });

    it('is idempotent — safe to call when no observer exists', () => {
        expect(cleanup._observer).toBeNull();
        expect(() => cleanup._stopObserver()).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  7. start() — initial settings read through the toggle pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('start() — initial settings', () => {
    it('removes the homepage target elements when the master switch reads as on', async () => {
        stubMobileTouch();
        stubHomepage();
        respondWith({ [MASTER_KEY]: true });
        addTargetElements(3);

        await load();

        expect(targetCount()).toBe(0);
    });

    it('leaves the target elements alone when the master switch reads as off', async () => {
        stubMobileTouch();
        stubHomepage();
        respondWith({ [MASTER_KEY]: false });
        addTargetElements(3);

        await load();

        expect(targetCount()).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  8. SETTINGS_CHANGED broadcasts
// ─────────────────────────────────────────────────────────────────────────────

describe('SETTINGS_CHANGED broadcasts', () => {
    it('master switch turning on resumes cleanup', () => {
        addTargetElements(3);
        expect(targetCount()).toBe(3);

        broadcast(change(MASTER_KEY, true));

        expect(targetCount()).toBe(0);
    });

    it('master switch turning off stops cleanup: later insertions survive', async () => {
        broadcast(change(MASTER_KEY, true));
        addTargetElements(1);
        await settleObserver();
        expect(targetCount()).toBe(0);

        broadcast(change(MASTER_KEY, false));

        addTargetElements(2);
        await settleObserver();
        expect(targetCount()).toBe(2);
    });

    it('an unrelated key changes nothing', async () => {
        addTargetElements(3);

        broadcast(change(UNRELATED_KEY, true));
        await settleObserver();

        expect(targetCount()).toBe(3);
        expect(cleanup.enabled).toBe(false);
    });

    it('a master-switch-off change reported for the sync area is ignored', async () => {
        broadcast(change(MASTER_KEY, true));
        expect(cleanup.enabled).toBe(true);

        broadcast(change(MASTER_KEY, false), 'sync');

        // Still active: elements inserted after the ignored broadcast are cleared.
        addTargetElements(2);
        await settleObserver();
        expect(targetCount()).toBe(0);
        expect(cleanup.enabled).toBe(true);
    });
});
