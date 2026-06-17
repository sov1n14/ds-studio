import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TemporaryChatToggle from '../../content/temporary-chat-toggle.js';

const STORAGE_KEY = 'dss-temporary-chat-enabled';
const CHANGED_EVENT = 'dss-temporary-chat-changed';

// ── Group A: readEnabledFlag ──────────────────────────────────────────────────

describe('A — readEnabledFlag', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
        sessionStorage.clear();
    });

    it('A1: returns false when key is absent', () => {
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('A2: returns false when key is "false"', () => {
        sessionStorage.setItem(STORAGE_KEY, 'false');
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('A3: returns false when key is "0"', () => {
        sessionStorage.setItem(STORAGE_KEY, '0');
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('A4: returns false when key is empty string', () => {
        sessionStorage.setItem(STORAGE_KEY, '');
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(false);
    });

    it('A5: returns true only when key is exactly "true"', () => {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        expect(TemporaryChatToggle.readEnabledFlag()).toBe(true);
    });
});

// ── Group B: writeEnabledFlag ─────────────────────────────────────────────────

describe('B — writeEnabledFlag', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
        sessionStorage.clear();
    });

    it('B1: writes "true" when called with true', () => {
        TemporaryChatToggle.writeEnabledFlag(true);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    it('B2: writes "false" when called with false', () => {
        TemporaryChatToggle.writeEnabledFlag(false);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('false');
    });

    it('B3: overwrites existing value', () => {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        TemporaryChatToggle.writeEnabledFlag(false);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('false');
    });
});

// ── Group C: dispatchToggleEvent ──────────────────────────────────────────────

describe('C — dispatchToggleEvent', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('C1: dispatches dss-temporary-chat-changed with isEnabled true', () => {
        const received = [];
        const handler = (e) => received.push(e.detail);
        window.addEventListener(CHANGED_EVENT, handler);

        TemporaryChatToggle.dispatchToggleEvent(true);

        window.removeEventListener(CHANGED_EVENT, handler);
        expect(received).toHaveLength(1);
        expect(received[0].isEnabled).toBe(true);
    });

    it('C2: dispatches dss-temporary-chat-changed with isEnabled false', () => {
        const received = [];
        const handler = (e) => received.push(e.detail);
        window.addEventListener(CHANGED_EVENT, handler);

        TemporaryChatToggle.dispatchToggleEvent(false);

        window.removeEventListener(CHANGED_EVENT, handler);
        expect(received).toHaveLength(1);
        expect(received[0].isEnabled).toBe(false);
    });
});

// ── Group D: homepage-only guard ──────────────────────────────────────────────

describe('D — homepage-only guard in init()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        // Clean up any injected rows
        document.getElementById('dss-temp-chat-toggle-row')?.remove();
        document.body.innerHTML = '';
    });

    it('D1: init() does nothing when pathname is not "/"', () => {
        window.history.replaceState({}, '', '/a/chat/s/some-uuid');
        const tryInjectSpy = vi.spyOn(TemporaryChatToggle, 'injectToggleRow');

        // Create an anchor so injection would be possible if guard were absent
        const anchor = document.createElement('div');
        anchor.className = 'aaff8b8f';
        document.body.appendChild(anchor);

        TemporaryChatToggle.init();

        expect(tryInjectSpy).not.toHaveBeenCalled();
    });
});

// ── Group E: injectToggleRow & createToggleRow ────────────────────────────────

describe('E — injectToggleRow', () => {
    beforeEach(() => {
        sessionStorage.clear();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        sessionStorage.clear();
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

    it('E1: injects a row element after the anchor', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        const row = document.getElementById('dss-temp-chat-toggle-row');
        expect(row).not.toBeNull();
        expect(anchor.nextSibling).toBe(row);
    });

    it('E2: does not inject duplicate row on second call', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        TemporaryChatToggle.injectToggleRow(anchor);

        const rows = document.querySelectorAll('#dss-temp-chat-toggle-row');
        expect(rows).toHaveLength(1);
    });

    it('E3: checkbox is unchecked by default (OFF state)', () => {
        sessionStorage.removeItem(STORAGE_KEY);
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        const input = document.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(false);
    });

    it('E4: checkbox is checked when sessionStorage is "true"', () => {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        const input = document.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(true);
    });
});

// ── Group F: applyVisualState ─────────────────────────────────────────────────

describe('F — applyVisualState', () => {
    function makeRow(isEnabled) {
        return TemporaryChatToggle.createToggleRow(isEnabled);
    }

    it('F1: adds --on class to label when enabled', () => {
        const row = makeRow(false);
        TemporaryChatToggle.applyVisualState(row, true);
        const label = row.querySelector('.dss-temp-chat-label');
        expect(label.classList.contains('dss-temp-chat-label--on')).toBe(true);
    });

    it('F2: removes --on class from label when disabled', () => {
        const row = makeRow(true);
        TemporaryChatToggle.applyVisualState(row, false);
        const label = row.querySelector('.dss-temp-chat-label');
        expect(label.classList.contains('dss-temp-chat-label--on')).toBe(false);
    });

    it('F3: sets input.checked to true when enabled', () => {
        const row = makeRow(false);
        TemporaryChatToggle.applyVisualState(row, true);
        const input = row.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(true);
    });

    it('F4: sets input.checked to false when disabled', () => {
        const row = makeRow(true);
        TemporaryChatToggle.applyVisualState(row, false);
        const input = row.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(false);
    });

    it('F5: is a no-op when row is null', () => {
        // Should not throw
        expect(() => TemporaryChatToggle.applyVisualState(null, true)).not.toThrow();
    });
});

// ── Group G: toggle interaction (change event) ────────────────────────────────

describe('G — toggle interaction writes storage and dispatches event', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it('G1: toggling ON writes "true" to sessionStorage', () => {
        const row = TemporaryChatToggle.createToggleRow(false);
        document.body.appendChild(row);

        const input = row.querySelector('.dss-temp-chat-switch__input');
        input.checked = true;
        input.dispatchEvent(new Event('change'));

        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('true');
        document.body.removeChild(row);
    });

    it('G2: toggling OFF writes "false" to sessionStorage', () => {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        const row = TemporaryChatToggle.createToggleRow(true);
        document.body.appendChild(row);

        const input = row.querySelector('.dss-temp-chat-switch__input');
        input.checked = false;
        input.dispatchEvent(new Event('change'));

        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('false');
        document.body.removeChild(row);
    });

    it('G3: toggling ON dispatches dss-temporary-chat-changed with isEnabled=true', () => {
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

    it('G4: toggling OFF dispatches dss-temporary-chat-changed with isEnabled=false', () => {
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

// ── Group H: removeToggleRow ──────────────────────────────────────────────────

describe('H — removeToggleRow', () => {
    beforeEach(() => {
        sessionStorage.clear();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        sessionStorage.clear();
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

    it('H1: removeToggleRow removes the injected row from DOM', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();

        TemporaryChatToggle.removeToggleRow();

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('H2: removeToggleRow is a no-op when row does not exist', () => {
        expect(() => TemporaryChatToggle.removeToggleRow()).not.toThrow();
    });

    it('H3: removeToggleRow does NOT modify sessionStorage enabled flag', () => {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        TemporaryChatToggle.removeToggleRow();

        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    it('H4: removeToggleRow is idempotent (calling twice does not throw)', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        TemporaryChatToggle.removeToggleRow();
        expect(() => TemporaryChatToggle.removeToggleRow()).not.toThrow();
    });
});

// ── Group I: handleNavigation (SPA-aware inject/remove) ───────────────────────

describe('I — handleNavigation (SPA-aware)', () => {
    beforeEach(() => {
        sessionStorage.clear();
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        sessionStorage.clear();
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

    it('I1: handleNavigation to "/" injects toggle row when anchor exists', () => {
        createAnchorInDOM();

        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/some-uuid');

        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
    });

    it('I2: handleNavigation to non-"/" pathname removes the toggle row', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();

        TemporaryChatToggle.handleNavigation('/a/chat/s/some-uuid', '/');

        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });

    it('I3: handleNavigation back to "/" re-injects after prior remove', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        TemporaryChatToggle.handleNavigation('/a/chat/s/some-uuid', '/');
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();

        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/some-uuid');
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
    });

    it('I4: no duplicate rows when handleNavigation to "/" called twice', () => {
        createAnchorInDOM();

        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/some-uuid');
        TemporaryChatToggle.handleNavigation('/', '/');

        const rows = document.querySelectorAll('#dss-temp-chat-toggle-row');
        expect(rows).toHaveLength(1);
    });

    it('I5: re-injected row reflects persisted enabled flag (true)', () => {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        createAnchorInDOM();

        TemporaryChatToggle.handleNavigation('/a/chat/s/uuid', '/');
        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/uuid');

        const input = document.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(true);
    });

    it('I6: re-injected row reflects persisted enabled flag (false)', () => {
        sessionStorage.setItem(STORAGE_KEY, 'false');
        createAnchorInDOM();

        TemporaryChatToggle.handleNavigation('/a/chat/s/uuid', '/');
        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/uuid');

        const input = document.querySelector('.dss-temp-chat-switch__input');
        expect(input.checked).toBe(false);
    });

    it('I7: removal does NOT change the sessionStorage enabled flag', () => {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);

        TemporaryChatToggle.handleNavigation('/a/chat/s/uuid', '/');

        expect(sessionStorage.getItem(STORAGE_KEY)).toBe('true');
    });
});
