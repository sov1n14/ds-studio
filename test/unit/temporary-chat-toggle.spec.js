import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── chrome.storage.local mock (must be set before module import) ──────────────
const chromeStorageLocalMock = {
    _store: {},
    get(keys) {
        const result = {};
        keys.forEach(k => { if (k in this._store) result[k] = this._store[k]; });
        return Promise.resolve(result);
    },
    set(items) {
        Object.assign(this._store, items);
        return Promise.resolve();
    },
    _reset() { this._store = {}; },
};

global.chrome = {
    storage: {
        local: chromeStorageLocalMock,
        onChanged: { addListener: () => {} },
    },
};

import TemporaryChatToggle from '../../content/temporary-chat-toggle.js';

const STORAGE_KEY = 'dss-temporary-chat-enabled';
const CHANGED_EVENT = 'dss-temporary-chat-changed';

// ── Group A: initEnabledFlagFromStorage (via init) ───────────────────────────
// initEnabledFlagFromStorage is private; test its effects via init() which awaits it.

describe('A — initEnabledFlagFromStorage (via init())', () => {
    beforeEach(() => {
        chromeStorageLocalMock._reset();
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/non-homepage');
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('A1: after init(), readEnabledFlag() returns true when storage has true', async () => {
        chromeStorageLocalMock._store[STORAGE_KEY] = true;
        await TemporaryChatToggle.init();
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
    });

    it('A2: after init(), readEnabledFlag() returns false when storage key is absent', async () => {
        // store is empty
        await TemporaryChatToggle.init();
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('A3: after init(), readEnabledFlag() returns false when storage value is false', async () => {
        chromeStorageLocalMock._store[STORAGE_KEY] = false;
        await TemporaryChatToggle.init();
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });
});

// ── Group B: readEnabledFlag ──────────────────────────────────────────────────

describe('B — readEnabledFlag', () => {
    beforeEach(() => {
        chromeStorageLocalMock._reset();
        // Use writeEnabledFlag to reset cache to false
        TemporaryChatToggle.writeEnabledFlag(false);
    });

    it('B1: returns false when cache was set to false', () => {
        TemporaryChatToggle.writeEnabledFlag(false);
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('B2: returns cached value without reading chrome.storage.local', async () => {
        // Set cache to true via writeEnabledFlag
        TemporaryChatToggle.writeEnabledFlag(true);
        // Now mutate storage to false — cache must remain true
        chromeStorageLocalMock._store[STORAGE_KEY] = false;
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
    });
});

// ── Group C: writeEnabledFlag ─────────────────────────────────────────────────

describe('C — writeEnabledFlag', () => {
    beforeEach(() => {
        chromeStorageLocalMock._reset();
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

    it('C3: calls chrome.storage.local.set with the correct key and value (true)', async () => {
        const setSpy = vi.spyOn(chromeStorageLocalMock, 'set');
        TemporaryChatToggle.writeEnabledFlag(true);
        await Promise.resolve(); // flush microtask
        expect(setSpy).toHaveBeenCalledWith({ [STORAGE_KEY]: true });
        setSpy.mockRestore();
    });

    it('C4: calls chrome.storage.local.set with the correct key and value (false)', async () => {
        const setSpy = vi.spyOn(chromeStorageLocalMock, 'set');
        TemporaryChatToggle.writeEnabledFlag(false);
        await Promise.resolve();
        expect(setSpy).toHaveBeenCalledWith({ [STORAGE_KEY]: false });
        setSpy.mockRestore();
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

    it('F1: init() does nothing when pathname is not "/"', () => {
        window.history.replaceState({}, '', '/a/chat/s/some-uuid');
        const tryInjectSpy = vi.spyOn(TemporaryChatToggle, 'injectToggleRow');

        const anchor = document.createElement('div');
        anchor.className = 'aaff8b8f';
        document.body.appendChild(anchor);

        TemporaryChatToggle.init();

        expect(tryInjectSpy).not.toHaveBeenCalled();
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

    it('I3: toggling ON dispatches dss-temporary-chat-changed with isEnabled=true', () => {
        const row = TemporaryChatToggle.createToggleRow(false);
        document.body.appendChild(row);

        const received = [];
        const handler = (e) => received.push(e.detail);
        window.addEventListener(CHANGED_EVENT, handler);

        const input = row.querySelector('.dss-temp-chat-switch__input');
        input.checked = true;
        input.dispatchEvent(new Event('change'));

        window.removeEventListener(CHANGED_EVENT, handler);
        document.body.removeChild(row);

        expect(received).toHaveLength(1);
        expect(received[0].isEnabled).toBe(true);
    });

    it('I4: toggling OFF dispatches dss-temporary-chat-changed with isEnabled=false', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        const row = TemporaryChatToggle.createToggleRow(true);
        document.body.appendChild(row);

        const received = [];
        const handler = (e) => received.push(e.detail);
        window.addEventListener(CHANGED_EVENT, handler);

        const input = row.querySelector('.dss-temp-chat-switch__input');
        input.checked = false;
        input.dispatchEvent(new Event('change'));

        window.removeEventListener(CHANGED_EVENT, handler);
        document.body.removeChild(row);

        expect(received).toHaveLength(1);
        expect(received[0].isEnabled).toBe(false);
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
