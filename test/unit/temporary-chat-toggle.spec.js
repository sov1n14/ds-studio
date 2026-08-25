import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Loaded before the module under test: temporary-chat-toggle.js resolves
// StorageManager.KEYS.IS_ENABLED at load time (init() runs on load) and inside its
// top-level chrome.storage.onChanged listener. Real module, not a stub, so the key
// name under test is the one production ships.
import '../../utils/storage-manager.js';
// chrome.* and TemporaryChatEnabledFlag both come from test/setup/vitest.setup.js
// (shared in-memory chrome.storage mock + preloaded flag module). No local chrome
// mock here: a spec-local `global.chrome = {...}` runs AFTER this hoisted import and
// therefore produced two mock universes -- the module registered against the setup
// mock while the tests drove a stub nobody listened to.
import TemporaryChatToggle from '../../content/temporary-chat-toggle.js';

const STORAGE_KEY = 'dss-temporary-chat-enabled';
const CHANGED_EVENT = 'dss-temporary-chat-changed';
const IS_ENABLED_KEY = StorageManager.KEYS.IS_ENABLED;
const MSG = () => globalThis.DSS_SETTINGS_MSG;

/** Backing store the fake settings route answers from; re-seeded per test. */
let settingsStore = {};
/** Fresh instances loaded by loadToggle(); disarmed after each test. */
let loadedInstances = [];

/**
 * Answer GET_SETTINGS / SET_SETTINGS out of settingsStore the way background
 * does. One implementation keyed on message.keys serves both readers: the
 * feature-toggle pipeline asks for ['isEnabled'], the flag module asks for
 * ['dss-temporary-chat-enabled'].
 */
function installSettingsRoute() {
    chrome.runtime.sendMessage = vi.fn(async (message) => {
        if (message?.type === MSG().GET_SETTINGS) {
            const values = {};
            (message.keys || []).forEach((key) => {
                if (key in settingsStore) values[key] = settingsStore[key];
            });
            return { ok: true, values };
        }
        if (message?.type === MSG().SET_SETTINGS) {
            Object.assign(settingsStore, message.values);
            return { ok: true };
        }
        return { ok: true, values: {} };
    });
}

/** Fresh chrome.runtime.onMessage stub (same shape as the shared mock). */
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

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
function broadcast(changes, area = 'local') {
    chrome.runtime.onMessage.callListeners(
        { type: MSG().SETTINGS_CHANGED, area, changes },
        { id: 'test-extension-id' },
        () => {},
    );
}

/** Let pending sendMessage promise chains settle. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Load a pristine toggle instance whose master gating and enabled flag are both
 * driven by the given settings values.
 *
 * Fresh per test because content/feature-toggle.js keeps its feature registry
 * and its single shared onMessage listener in module scope: a stale instance
 * would keep reacting to this test's broadcasts. The onMessage stub is replaced
 * in the same step so orphaned listeners cannot see the new broadcasts.
 */
async function loadToggle(values = {}) {
    settingsStore = { ...values };
    chrome.runtime.onMessage = createOnMessageStub();
    installSettingsRoute();
    vi.resetModules();
    await import('../../content/temporary-chat-enabled-flag.js');
    await import('../../content/feature-toggle.js');
    const mod = await import('../../content/temporary-chat-toggle.js');
    const instance = mod.default ?? mod;
    loadedInstances.push(instance);
    await flush();
    return instance;
}

beforeEach(() => {
    settingsStore = {};
    installSettingsRoute();
});

// Every loaded instance keeps a MutationObserver on document.body; disarming the
// master switch is what stops it from re-injecting rows into later tests.
afterEach(() => {
    loadedInstances.forEach((instance) => instance.__setMasterEnabled(false));
    loadedInstances = [];
});

/** Collect every dss-temporary-chat-changed detail dispatched while fn() runs. */
function captureToggleEvents(fn) {
    const received = [];
    const handler = (e) => received.push(e.detail);
    window.addEventListener(CHANGED_EVENT, handler);
    try {
        fn();
    } finally {
        window.removeEventListener(CHANGED_EVENT, handler);
    }
    return received;
}

// ── Group A: initEnabledFlagFromStorage (via init) ───────────────────────────
// initEnabledFlagFromStorage is private; test its effects via init() which awaits it.

describe('A — initEnabledFlagFromStorage (via init())', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/non-homepage');
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('A1: after init(), readEnabledFlag() returns true when settings report true', async () => {
        settingsStore[STORAGE_KEY] = true;
        await TemporaryChatToggle.init();
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
    });

    it('A2: after init(), readEnabledFlag() returns false when the settings key is absent', async () => {
        // settingsStore is empty
        await TemporaryChatToggle.init();
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('A3: after init(), readEnabledFlag() returns false when settings report false', async () => {
        settingsStore[STORAGE_KEY] = false;
        await TemporaryChatToggle.init();
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });
});

// ── Group B: readEnabledFlag ──────────────────────────────────────────────────

describe('B — readEnabledFlag', () => {
    beforeEach(() => {
        // Use writeEnabledFlag to reset cache to false
        TemporaryChatToggle.writeEnabledFlag(false);
    });

    it('B1: returns false when cache was set to false', () => {
        TemporaryChatToggle.writeEnabledFlag(false);
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('B2: returns the cached value without reading storage or asking background', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        const getSpy = vi.spyOn(chrome.storage.local, 'get');
        const syncGetSpy = vi.spyOn(chrome.storage.sync, 'get');
        chrome.runtime.sendMessage.mockClear();

        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
        expect(getSpy).not.toHaveBeenCalled();
        expect(syncGetSpy).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

        getSpy.mockRestore();
        syncGetSpy.mockRestore();
    });
});

// ── Group C: writeEnabledFlag ─────────────────────────────────────────────────

describe('C — writeEnabledFlag', () => {
    beforeEach(() => {
        TemporaryChatToggle.writeEnabledFlag(false);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('C1: updates cache immediately to true', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
    });

    it('C2: updates cache immediately to false', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        TemporaryChatToggle.writeEnabledFlag(false);
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('C3: asks background to persist the new value (true)', async () => {
        chrome.runtime.sendMessage.mockClear();
        TemporaryChatToggle.writeEnabledFlag(true);
        await vi.waitFor(() => {
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: MSG().SET_SETTINGS,
            values: { [STORAGE_KEY]: true },
        });
    });

    it('C4: asks background to persist the new value (false)', async () => {
        chrome.runtime.sendMessage.mockClear();
        TemporaryChatToggle.writeEnabledFlag(false);
        await vi.waitFor(() => {
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: MSG().SET_SETTINGS,
            values: { [STORAGE_KEY]: false },
        });
    });
});

// ── Group D: __setCacheForCrossTabSync ────────────────────────────────────────

describe('D — __setCacheForCrossTabSync', () => {
    beforeEach(() => {
        TemporaryChatToggle.writeEnabledFlag(false);
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('D1: updates cache to the new value', () => {
        TemporaryChatToggle.__setCacheForCrossTabSync(true);
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
    });

    it('D2: dispatches the toggle event with the new value', () => {
        const received = [];
        const handler = (e) => received.push(e.detail);
        window.addEventListener(CHANGED_EVENT, handler);

        TemporaryChatToggle.__setCacheForCrossTabSync(true);

        window.removeEventListener(CHANGED_EVENT, handler);
        expect(received).toHaveLength(1);
        expect(received[0].isEnabled).toBe(true);
    });

    it('D3: calls applyVisualState on injected row when one exists', () => {
        // Inject a row so _injectedRow is set
        const parent = document.createElement('div');
        const anchor = document.createElement('div');
        anchor.className = 'aaff8b8f';
        parent.appendChild(anchor);
        document.body.appendChild(parent);
        TemporaryChatToggle.injectToggleRow(anchor);

        TemporaryChatToggle.__setCacheForCrossTabSync(true);

        const input = document.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(true);
    });

    it('D4: does NOT throw when no row is injected', () => {
        expect(() => TemporaryChatToggle.__setCacheForCrossTabSync(false)).not.toThrow();
    });
});

// ── Group E: dispatchToggleEvent ──────────────────────────────────────────────

describe('E — dispatchToggleEvent', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('E1: dispatches dss-temporary-chat-changed with isEnabled true', () => {
        const received = [];
        const handler = (e) => received.push(e.detail);
        window.addEventListener(CHANGED_EVENT, handler);

        TemporaryChatToggle.dispatchToggleEvent(true);

        window.removeEventListener(CHANGED_EVENT, handler);
        expect(received).toHaveLength(1);
        expect(received[0].isEnabled).toBe(true);
    });

    it('E2: dispatches dss-temporary-chat-changed with isEnabled false', () => {
        const received = [];
        const handler = (e) => received.push(e.detail);
        window.addEventListener(CHANGED_EVENT, handler);

        TemporaryChatToggle.dispatchToggleEvent(false);

        window.removeEventListener(CHANGED_EVENT, handler);
        expect(received).toHaveLength(1);
        expect(received[0].isEnabled).toBe(false);
    });
});

// ── Group F: homepage-only guard ──────────────────────────────────────────────

describe('F — homepage-only guard in init()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.getElementById('dss-temp-chat-toggle-row')?.remove();
        document.body.innerHTML = '';
    });

    it('F1: init() injects nothing when pathname is not "/", even with the master switch on', async () => {
        window.history.replaceState({}, '', '/a/chat/s/some-uuid');

        const anchor = document.createElement('div');
        anchor.className = 'aaff8b8f';
        document.body.appendChild(anchor);

        await loadToggle({ isEnabled: true });
        await flush();

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });
});

// ── Group G: injectToggleRow & createToggleRow ────────────────────────────────

describe('G — injectToggleRow', () => {
    beforeEach(() => {
        TemporaryChatToggle.writeEnabledFlag(false);
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    function createAnchorInDOM() {
        const parent = document.createElement('div');
        const anchor = document.createElement('div');
        anchor.className = 'aaff8b8f';
        parent.appendChild(anchor);
        document.body.appendChild(parent);
        return anchor;
    }

    it('G1: injects a row element after the anchor', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        const row = document.getElementById('dss-temp-chat-toggle-row');
        expect(row).not.toBeNull();
        expect(anchor.nextSibling).toBe(row);
    });

    it('G2: does not inject duplicate row on second call', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        TemporaryChatToggle.injectToggleRow(anchor);

        const rows = document.querySelectorAll('#dss-temp-chat-toggle-row');
        expect(rows).toHaveLength(1);
    });

    it('G3: checkbox is unchecked by default (cache is false)', () => {
        TemporaryChatToggle.writeEnabledFlag(false);
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        const input = document.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(false);
    });

    it('G4: checkbox is checked when cache is true', () => {
        TemporaryChatToggle.writeEnabledFlag(true);

        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        const input = document.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(true);
    });
});

// ── Group H: applyVisualState ─────────────────────────────────────────────────

describe('H — applyVisualState', () => {
    function makeRow(isEnabled) {
        return TemporaryChatToggle.createToggleRow(isEnabled);
    }

    it('H1: adds --on class to label when enabled', () => {
        const row = makeRow(false);
        TemporaryChatToggle.applyVisualState(row, true);
        const label = row.querySelector('.dss-temp-chat-label');
        expect(label.classList.contains('dss-temp-chat-label--on')).toBe(true);
    });

    it('H2: removes --on class from label when disabled', () => {
        const row = makeRow(true);
        TemporaryChatToggle.applyVisualState(row, false);
        const label = row.querySelector('.dss-temp-chat-label');
        expect(label.classList.contains('dss-temp-chat-label--on')).toBe(false);
    });

    it('H3: sets input.checked to true when enabled', () => {
        const row = makeRow(false);
        TemporaryChatToggle.applyVisualState(row, true);
        const input = row.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(true);
    });

    it('H4: sets input.checked to false when disabled', () => {
        const row = makeRow(true);
        TemporaryChatToggle.applyVisualState(row, false);
        const input = row.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(false);
    });

    it('H5: is a no-op when row is null', () => {
        expect(() => TemporaryChatToggle.applyVisualState(null, true)).not.toThrow();
    });
});

// ── Group I: toggle interaction (change event) ────────────────────────────────

describe('I — toggle interaction writes storage and dispatches event', () => {
    beforeEach(() => {
        TemporaryChatToggle.writeEnabledFlag(false);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('I1: toggling ON updates cache to true', () => {
        const row = TemporaryChatToggle.createToggleRow(false);
        document.body.appendChild(row);

        const input = row.querySelector('.dss-temp-chat-switch__input');
        input.checked = true;
        input.dispatchEvent(new Event('change'));

        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
        document.body.removeChild(row);
    });

    it('I2: toggling OFF updates cache to false', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        const row = TemporaryChatToggle.createToggleRow(true);
        document.body.appendChild(row);

        const input = row.querySelector('.dss-temp-chat-switch__input');
        input.checked = false;
        input.dispatchEvent(new Event('change'));

        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
        document.body.removeChild(row);
    });

    // Dispatch COUNT is deliberately not asserted: chrome.storage.onChanged fires in the
    // writing context too, so the write echoes back through the flag module's cross-tab
    // sync and dispatches a second, identical event. The requirement is that the event
    // is dispatched and that every dispatch reports the new value.
    it('I3: toggling ON dispatches dss-temporary-chat-changed with isEnabled=true', () => {
        const row = TemporaryChatToggle.createToggleRow(false);
        document.body.appendChild(row);
        const input = row.querySelector('.dss-temp-chat-switch__input');

        const received = captureToggleEvents(() => {
            input.checked = true;
            input.dispatchEvent(new Event('change'));
        });

        document.body.removeChild(row);
        expect(received.length).toBeGreaterThanOrEqual(1);
        expect(received.every((detail) => detail.isEnabled === true)).toBe(true);
    });

    it('I4: toggling OFF dispatches dss-temporary-chat-changed with isEnabled=false', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        const row = TemporaryChatToggle.createToggleRow(true);
        document.body.appendChild(row);
        const input = row.querySelector('.dss-temp-chat-switch__input');

        const received = captureToggleEvents(() => {
            input.checked = false;
            input.dispatchEvent(new Event('change'));
        });

        document.body.removeChild(row);
        expect(received.length).toBeGreaterThanOrEqual(1);
        expect(received.every((detail) => detail.isEnabled === false)).toBe(true);
    });
});

// ── Group J: removeToggleRow ──────────────────────────────────────────────────

describe('J — removeToggleRow', () => {
    beforeEach(() => {
        TemporaryChatToggle.writeEnabledFlag(false);
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    function createAnchorInDOM() {
        const parent = document.createElement('div');
        const anchor = document.createElement('div');
        anchor.className = 'aaff8b8f';
        parent.appendChild(anchor);
        document.body.appendChild(parent);
        return anchor;
    }

    it('J1: removeToggleRow removes the injected row from DOM', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();

        TemporaryChatToggle.removeToggleRow();

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('J2: removeToggleRow is a no-op when row does not exist', () => {
        expect(() => TemporaryChatToggle.removeToggleRow()).not.toThrow();
    });

    it('J3: removeToggleRow does NOT modify the enabled cache', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        TemporaryChatToggle.removeToggleRow();

        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
    });

    it('J4: removeToggleRow is idempotent (calling twice does not throw)', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        TemporaryChatToggle.removeToggleRow();
        expect(() => TemporaryChatToggle.removeToggleRow()).not.toThrow();
    });
});

// ── Group K: handleNavigation (SPA-aware inject/remove) ──────────────────────

describe('K — handleNavigation (SPA-aware)', () => {
    beforeEach(() => {
        TemporaryChatToggle.writeEnabledFlag(false);
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/');
    });

    function createAnchorInDOM() {
        const parent = document.createElement('div');
        const anchor = document.createElement('div');
        anchor.className = 'aaff8b8f';
        parent.appendChild(anchor);
        document.body.appendChild(parent);
        return anchor;
    }

    it('K1: handleNavigation to "/" does NOT inject synchronously (MutationObserver handles it)', () => {
        createAnchorInDOM();

        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/some-uuid');

        // Injection is deferred to the MutationObserver; no row should be present yet
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('K2: handleNavigation to non-"/" pathname removes the toggle row', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();

        TemporaryChatToggle.handleNavigation('/a/chat/s/some-uuid', '/');

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('K3: handleNavigation back to "/" leaves injection to MutationObserver (row absent after call)', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        TemporaryChatToggle.handleNavigation('/a/chat/s/some-uuid', '/');
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();

        // handleNavigation to '/' no longer injects synchronously
        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/some-uuid');
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('K4: no duplicate rows when handleNavigation to "/" called twice (MutationObserver dedupes via injectToggleRow guard)', () => {
        createAnchorInDOM();

        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/some-uuid');
        TemporaryChatToggle.handleNavigation('/', '/');

        // Both calls do nothing synchronously; no row is present
        const rows = document.querySelectorAll('#dss-temp-chat-toggle-row');
        expect(rows).toHaveLength(0);
    });

    it('K5: handleNavigation to "/" is a no-op (no row; MutationObserver will inject when anchor appears)', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        createAnchorInDOM();

        TemporaryChatToggle.handleNavigation('/a/chat/s/uuid', '/');
        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/uuid');

        // No synchronous injection — MutationObserver handles it asynchronously
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('K6: handleNavigation to "/" does not inject (flag false, MutationObserver deferred)', () => {
        TemporaryChatToggle.writeEnabledFlag(false);
        createAnchorInDOM();

        TemporaryChatToggle.handleNavigation('/a/chat/s/uuid', '/');
        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/uuid');

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('K7: removal does NOT change the enabled flag cache', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        TemporaryChatToggle.handleNavigation('/a/chat/s/uuid', '/');

        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
    });
});

// ── Group L: master switch (_masterEnabled) ──────────────────────────────────

describe('L — master switch gating (StorageManager.KEYS.IS_ENABLED)', () => {
    function createAnchorInDOM() {
        const parent = document.createElement('div');
        const anchor = document.createElement('div');
        anchor.className = 'aaff8b8f';
        parent.appendChild(anchor);
        document.body.appendChild(parent);
        return anchor;
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        // Reset master switch + injected row to a known baseline before each test.
        TemporaryChatToggle.__setMasterEnabled(false);
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        TemporaryChatToggle.__setMasterEnabled(false);
        document.body.innerHTML = '';
    });

    it('L1: master switch reported false keeps the row off the homepage', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();

        await loadToggle({ [IS_ENABLED_KEY]: false });
        await flush();

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('L2: master switch reported true injects the row on the homepage', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();

        await loadToggle({ [IS_ENABLED_KEY]: true });

        await vi.waitFor(() => {
            expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
        });
    });

    it('L3: __setMasterEnabled(false) removes an existing injected row', () => {
        window.history.replaceState({}, '', '/');
        TemporaryChatToggle.__setMasterEnabled(true);
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();

        TemporaryChatToggle.__setMasterEnabled(false);

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('L4: __setMasterEnabled(true) on homepage re-injects the row', () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();

        TemporaryChatToggle.__setMasterEnabled(true);

        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
    });

    it('L5: __setMasterEnabled(true) off-homepage does NOT inject', () => {
        window.history.replaceState({}, '', '/a/chat/s/some-uuid');
        createAnchorInDOM();

        TemporaryChatToggle.__setMasterEnabled(true);

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('L6: a local IS_ENABLED=true broadcast makes the toggle row appear on the homepage', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: false });
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();

        broadcast({ [IS_ENABLED_KEY]: { newValue: true } });

        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
    });

    it('L6b: a local IS_ENABLED=false broadcast removes an injected toggle row', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await vi.waitFor(() => {
            expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
        });

        broadcast({ [IS_ENABLED_KEY]: { newValue: false } });

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('L7: the enabled-flag branch of the broadcast still works alongside the IS_ENABLED branch', async () => {
        const instance = await loadToggle({ [IS_ENABLED_KEY]: false });

        broadcast({
            [IS_ENABLED_KEY]: { newValue: true },
            [STORAGE_KEY]: { newValue: true },
        });

        expect(instance.readEnabledFlag()).toBe(true);
    });

    it('L8: a broadcast with area !== "local" is ignored by both the master switch and the flag', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        const instance = await loadToggle({ [IS_ENABLED_KEY]: false });

        broadcast({
            [IS_ENABLED_KEY]: { newValue: true },
            [STORAGE_KEY]: { newValue: true },
        }, 'sync');

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
        expect(instance.readEnabledFlag()).toBe(false);
    });
});

// ── Group M: browser form-state restoration opt-out ──────────────────────────
// REQUIREMENT: the injected checkbox must opt out of Chromium's autofill/
// form-state restoration for dynamically-injected inputs, since Chromium
// restores such state on reload and fires a genuine `change` event that would
// otherwise be persisted as if it were a real user action.

describe('M — injected checkbox opts out of browser form-state restoration', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('M1: the injected checkbox input has autocomplete="off"', () => {
        const row = TemporaryChatToggle.createToggleRow(false);
        const input = row.querySelector('.dss-temp-chat-switch__input');
        expect(input.getAttribute('autocomplete')).toBe('off');
    });
});

// ── Group N: async settings-write failure is observed and reported ──────────
// REQUIREMENT: when the DSS_SET_SETTINGS round trip fails -- either because the
// message rejects or because background refuses the write -- the failure must be
// reported on the error boundary rather than surfacing as an unhandled rejection.

describe('N — writeEnabledFlag reports async settings-write failures', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('N1: a rejected DSS_SET_SETTINGS round trip is reported on the error boundary, not left unhandled', async () => {
        const writeError = new Error('message port closed');
        chrome.runtime.sendMessage.mockRejectedValue(writeError);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        TemporaryChatToggle.writeEnabledFlag(true);

        await vi.waitFor(() => {
            expect(errorSpy).toHaveBeenCalled();
        });
        expect(errorSpy.mock.calls[0][0]).toBe('[DSS] enabled-flag:write:');
        expect(errorSpy.mock.calls[0]).toContain(writeError);
    });

    it('N1b: a refused write ({ok:false}) is reported on the same boundary, carrying the reason', async () => {
        chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'quota' });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        TemporaryChatToggle.writeEnabledFlag(true);

        await vi.waitFor(() => {
            expect(errorSpy).toHaveBeenCalled();
        });
        expect(errorSpy.mock.calls[0][0]).toBe('[DSS] enabled-flag:write:');
        expect(errorSpy.mock.calls[0][1]).toBeInstanceOf(Error);
        expect(errorSpy.mock.calls[0][1].message).toBe('quota');
    });
});
