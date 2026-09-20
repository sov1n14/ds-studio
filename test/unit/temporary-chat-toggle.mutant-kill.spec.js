import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import '../../utils/temporary-chat-constants.js';
import TemporaryChatToggle from '../../content/temporary-chat-toggle.js';
const DSSelectors = require('../../content/ds-selectors.js');

const STORAGE_KEY = globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY;
const CHANGED_EVENT = globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_CHANGED_EVENT;
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
    loadedInstances.push({ instance, onMessage: chrome.runtime.onMessage });
    await flush();
    return instance;
}

function createAnchorInDOM() {
    const parent = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.className = DSSelectors.FLOATING_BUTTON_BAR_SELECTOR.slice(1);
    parent.appendChild(anchor);
    document.body.appendChild(parent);
    return anchor;
}

beforeEach(() => { settingsStore = {}; installSettingsRoute(); });

afterEach(() => {
    loadedInstances.forEach(({ onMessage }) => {
        onMessage.callListeners({ type: MSG().SETTINGS_CHANGED, area: 'local', changes: { [IS_ENABLED_KEY]: { newValue: false } } }, { id: 'test-extension-id' }, () => {});
    });
    loadedInstances = [];
    document.body.innerHTML = '';
});

describe('MK-A -- MutationObserver re-injects when row is externally removed', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-A1: observer re-injects the row after removal from DOM on homepage', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
        document.getElementById('dss-temp-chat-toggle-row').remove();
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
        document.body.appendChild(document.createElement('span'));
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
    });
});

describe('MK-B -- MutationObserver does NOT inject on non-homepage', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-B1: observer ignores DOM mutations on non-homepage with master enabled', async () => {
        window.history.replaceState({}, '', '/a/chat/s/some-uuid');
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await flush();
        createAnchorInDOM();
        document.body.appendChild(document.createElement('span'));
        await flush(); await flush();
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });
});

describe('MK-C -- MutationObserver does not duplicate rows', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-C1: multiple DOM mutations produce only one row', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
        for (let i = 0; i < 5; i++) document.body.appendChild(document.createElement('span'));
        await flush();
        expect(document.querySelectorAll('#dss-temp-chat-toggle-row')).toHaveLength(1);
    });
});

describe('MK-D -- handleNavigation preserves existing row on homepage', () => {
    beforeEach(() => { document.body.innerHTML = ''; TemporaryChatToggle.writeEnabledFlag(false); });
    it('MK-D1: navigating to / does NOT remove an existing injected row', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
        TemporaryChatToggle.handleNavigation('/', '/a/chat/s/uuid');
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
    });
    it('MK-D2: navigating from / to / preserves the row', () => {
        const anchor = createAnchorInDOM();
        TemporaryChatToggle.injectToggleRow(anchor);
        TemporaryChatToggle.handleNavigation('/', '/');
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
    });
});

describe('MK-E -- popstate event triggers handleNavigation', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-E1: popstate on non-homepage removes the row', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
        window.history.replaceState({}, '', '/a/chat/s/uuid');
        window.dispatchEvent(new Event('popstate'));
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });
    it('MK-E2: popstate back to homepage triggers observer re-injection', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
        window.history.replaceState({}, '', '/a/chat/s/uuid');
        window.dispatchEvent(new Event('popstate'));
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
        window.history.replaceState({}, '', '/');
        document.body.appendChild(document.createElement('span'));
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
    });
});

describe('MK-F -- Observer injects when anchor appears after init', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-F1: row appears when anchor is added to DOM after init on homepage', async () => {
        window.history.replaceState({}, '', '/');
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await flush();
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
        createAnchorInDOM();
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
    });
});

describe('MK-G -- cross-tab sync dispatches toggle event without row', () => {
    it('MK-G1: broadcast dispatches event even when no row is injected', async () => {
        window.history.replaceState({}, '', '/non-homepage');
        await loadToggle({ [STORAGE_KEY]: false });
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
        const received = [];
        const handler = (e) => received.push(e.detail);
        window.addEventListener(CHANGED_EVENT, handler);
        broadcast({ [STORAGE_KEY]: { newValue: true } });
        window.removeEventListener(CHANGED_EVENT, handler);
        expect(received).toHaveLength(1);
        expect(received[0].isEnabled).toBe(true);
    });
});

describe('MK-H -- Navigation API navigate event triggers row removal', () => {
    let originalNavigation;
    beforeEach(() => { document.body.innerHTML = ''; originalNavigation = window.navigation; });
    afterEach(() => { if (originalNavigation === undefined) { delete window.navigation; } else { window.navigation = originalNavigation; } });
    it('MK-H1: navigate event to non-homepage removes the row', async () => {
        const navListeners = [];
        window.navigation = { addEventListener: (type, fn) => { if (type === 'navigate') navListeners.push(fn); }, removeEventListener: () => {} };
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
        navListeners.forEach((fn) => fn({ destination: { url: 'https://chat.deepseek.com/a/chat/s/uuid' } }));
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });
    it('MK-H2: navigate event to homepage does NOT remove the row', async () => {
        const navListeners = [];
        window.navigation = { addEventListener: (type, fn) => { if (type === 'navigate') navListeners.push(fn); }, removeEventListener: () => {} };
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
        navListeners.forEach((fn) => fn({ destination: { url: 'https://chat.deepseek.com/' } }));
        expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull();
    });
});

describe('MK-I -- init starts the MutationObserver', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-I1: anchor added after init gets a row injected via observer', async () => {
        window.history.replaceState({}, '', '/');
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await flush();
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
        createAnchorInDOM();
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
    });
});

describe('MK-J -- tryInject respects masterEnabled gate', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-J1: with master disabled, anchor on homepage produces no row', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: false });
        await flush();
        document.body.appendChild(document.createElement('span'));
        await flush();
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });
});

// -- MK-K: after master disabled, DOM mutations must NOT re-inject --
// Kills: id 78 (!_masterEnabled -> false) -- observer tryInject after disable
describe('MK-K -- after master disabled, observer does NOT re-inject', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-K1: DOM mutation after master disable does not re-inject the row', async () => {
        window.history.replaceState({}, '', '/');
        createAnchorInDOM();
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
        // Disable master via broadcast
        broadcast({ [IS_ENABLED_KEY]: { newValue: false } });
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
        // Now trigger DOM mutation -- observer should NOT re-inject
        document.body.appendChild(document.createElement('span'));
        await flush();
        await flush();
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
    });
});
// -- MK-L: subtree observer detects deep-nested anchor --
// Kills: id 111 (subtree:true -> false)
describe('MK-L -- Observer detects anchor added deep in subtree', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    it('MK-L1: anchor added inside existing nested wrapper triggers injection', async () => {
        window.history.replaceState({}, '', '/');
        await loadToggle({ [IS_ENABLED_KEY]: true });
        await flush();
        expect(document.getElementById('dss-temp-chat-toggle-row')).toBeNull();
        const wrapper = document.createElement('div');
        document.body.appendChild(wrapper);
        await flush();
        const parent = document.createElement('div');
        const anchor = document.createElement('div');
        anchor.className = DSSelectors.FLOATING_BUTTON_BAR_SELECTOR.slice(1);
        parent.appendChild(anchor);
        wrapper.appendChild(parent);
        await vi.waitFor(() => { expect(document.getElementById('dss-temp-chat-toggle-row')).not.toBeNull(); });
    });
});
