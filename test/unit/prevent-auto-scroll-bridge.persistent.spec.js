/**
 * Unit tests for the persistent-lock feature of content/prevent-auto-scroll-bridge.js
 *
 * Coverage map:
 *   § 1  setPersistent()/isPersistent() — explicit API contract
 *   § 2  disable() regression guard while persistent
 *   § 3  non-persistent behaviour unchanged
 *   § 4  settings subscription — reacts live to the shared toggle pipeline
 *
 * Public API asserted:
 *   PreventAutoScroll.setPersistent(shouldPersist: boolean): void
 *   PreventAutoScroll.isPersistent(): boolean
 *   PreventAutoScroll.enable(): void
 *   PreventAutoScroll.disable(): void
 *   PreventAutoScroll.isEnabled(): boolean
 *
 * § 4 drives the module the way background/settings-routes.js does: the master
 * switch (isEnabled) and the feature's own key (dsPreventAutoScroll) arrive
 * through DSS_GET_SETTINGS at start-up and through DSS_SETTINGS_CHANGED
 * broadcasts afterwards. The module auto-starts on load, so start-up state is
 * arranged by queueing the GET_SETTINGS response BEFORE loading it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import '../../utils/settings-message-constants.js';

const MASTER_KEY = 'isEnabled';
const SETTING_KEY = 'dsPreventAutoScroll';
const UNRELATED_KEY = 'isHideThinkingEnabled';
const BRIDGE_ID = 'dss-prevent-auto-scroll-bridge';

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
let enable;
let disable;
let isEnabled;
let setPersistent;
let isPersistent;

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
 * (Re)load the module under test against the currently queued GET_SETTINGS
 * response. The module auto-starts on load, so respondWith() must run first.
 */
async function load() {
    // Fresh feature-toggle instance per load: its registry and its shared
    // onMessage listener are module state, so the previous load's registration
    // dies with the previous instance and cannot leak into this test.
    vi.resetModules();
    await import('../../content/feature-toggle.js');
    const mod = await import('../../content/prevent-auto-scroll-bridge.js');
    const api = mod.default ?? mod;
    // start() is invoked by the module itself as its auto-start point.
    ({ enable, disable, isEnabled, setPersistent, isPersistent } = api);
    await flush();
    return api;
}

beforeEach(async () => {
    // The bridge element lives on documentElement and carries all of this
    // module's state (enabled / persistent), so it must go before each test.
    // The injected <script id=SCRIPT_ID> is deliberately left in place: it is
    // only an idempotency marker, and removing it makes every test re-inject
    // and re-fetch it.
    document.getElementById(BRIDGE_ID)?.remove();

    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;

    // Default arrangement: registered but dormant (master switch off).
    respondWith({ [MASTER_KEY]: false, [SETTING_KEY]: false });
    await load();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('setPersistent()', () => {
    it('setPersistent(true) activates protection: isEnabled() and isPersistent() both become true', () => {
        setPersistent(true);
        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });

    it('setPersistent(false) clears persistent mode and deactivates protection', () => {
        setPersistent(true);
        setPersistent(false);
        expect(isPersistent()).toBe(false);
        expect(isEnabled()).toBe(false);
    });

    it('enable() remains idempotent while persistent: does not change isPersistent(), leaves isEnabled() true', () => {
        setPersistent(true);
        enable();
        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });

    it('setPersistent(true) called twice is idempotent: no error, still enabled and persistent', () => {
        setPersistent(true);
        expect(() => setPersistent(true)).not.toThrow();
        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });
});

describe('disable() while persistent', () => {
    it('does NOT deactivate protection while persistent mode is on', () => {
        setPersistent(true);
        disable();
        expect(isEnabled()).toBe(true);
        expect(isPersistent()).toBe(true);
    });
});

describe('enable()/disable() when persistent mode is off', () => {
    it('enable() then disable() flips isEnabled() true then false, as before', () => {
        expect(isPersistent()).toBe(false);
        enable();
        expect(isEnabled()).toBe(true);
        disable();
        expect(isEnabled()).toBe(false);
    });
});

describe('settings subscription', () => {
    /** Load with both the master switch and the feature key switched on. */
    async function loadFullyOn() {
        respondWith({ [MASTER_KEY]: true, [SETTING_KEY]: true });
        await load();
        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    }

    it('persistent mode is on at start-up when the master switch and dsPreventAutoScroll both read as true', async () => {
        await loadFullyOn();
    });

    it('persistent mode stays off at start-up when the master switch is on but dsPreventAutoScroll reads as false', async () => {
        respondWith({ [MASTER_KEY]: true, [SETTING_KEY]: false });
        await load();

        expect(isPersistent()).toBe(false);
        expect(isEnabled()).toBe(false);
    });

    it('persistent mode stays off at start-up when dsPreventAutoScroll is true but the master switch is off', async () => {
        respondWith({ [MASTER_KEY]: false, [SETTING_KEY]: true });
        await load();

        expect(isPersistent()).toBe(false);
        expect(isEnabled()).toBe(false);
    });

    it('flipping dsPreventAutoScroll to false turns persistent mode off live, without a reload', async () => {
        await loadFullyOn();

        broadcast(change(SETTING_KEY, false));

        expect(isPersistent()).toBe(false);
        expect(isEnabled()).toBe(false);
    });

    it('turning the master switch off turns persistent mode off live', async () => {
        await loadFullyOn();

        broadcast(change(MASTER_KEY, false));

        expect(isPersistent()).toBe(false);
        expect(isEnabled()).toBe(false);
    });

    it('turning the master switch back on restores persistent mode', async () => {
        await loadFullyOn();

        broadcast(change(MASTER_KEY, false));
        expect(isPersistent()).toBe(false);

        broadcast(change(MASTER_KEY, true));

        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });

    it('ignores a change reported for an area other than "local"', async () => {
        await loadFullyOn();

        broadcast(change(SETTING_KEY, false), 'sync');

        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });

    it('ignores a broadcast that carries only an unrelated key', async () => {
        await loadFullyOn();

        broadcast(change(UNRELATED_KEY, false));

        expect(isPersistent()).toBe(true);
        expect(isEnabled()).toBe(true);
    });
});
