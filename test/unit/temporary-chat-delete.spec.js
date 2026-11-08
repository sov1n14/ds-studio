import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';

// chrome.* comes from the shared mock in test/setup/vitest.setup.js (real in-memory
// chrome.storage.local + a fan-in storage.onChanged), and the three
// temporary-chat-delete.* part bundles plus TemporaryChatEnabledFlag are preloaded
// there too. No spec-local `global.chrome = {...}`: static imports are hoisted, so
// that assignment ran AFTER the module under test had already captured the setup
// mock -- the module and the tests were talking to two different chrome objects.

// ── TemporaryChatDeleteApi mock ────────────────────────────────────────────────
global.TemporaryChatDeleteApi = {
    deleteChatSession: vi.fn().mockResolvedValue(true),
    deleteChatSessionWithRetry: vi.fn().mockResolvedValue(undefined),
    showDeleteFailedToast: vi.fn(),
};

// ── TemporaryChatPendingStore mock ──────────────────────────────────────────────
global.TemporaryChatPendingStore = makePendingStoreMock();

import '../../utils/temporary-chat-constants.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// ── Helper ─────────────────────────────────────────────────────────────────────

/** Build a minimal NavigateEvent-like object understood by handleNavigationEvent. */
function makeNavigateEvent({ destinationUrl, navigationType = 'push' }) {
    return {
        destination: { url: destinationUrl },
        navigationType,
    };
}

const MSG = () => globalThis.DSS_SETTINGS_MSG;

/** Backing store the fake settings route answers from; re-seeded per test. */
let settingsStore = {};

/**
 * Answer GET_SETTINGS / SET_SETTINGS out of settingsStore the way background
 * does. The enabled flag reaches this module through TemporaryChatEnabledFlag,
 * which asks background for its value instead of reading chrome.storage.
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

// Clear all TemporaryChatPendingStore mock call history before every test in this file.
beforeEach(() => {
    Object.values(global.TemporaryChatPendingStore).forEach((fn) => fn.mockClear());
    settingsStore = {};
    installSettingsRoute();
});

// A DSS_SETTINGS_CHANGED broadcast for the enabled key makes the flag module's
// cross-tab sync call attachListeners() on this module. Detach after every test
// so listener state never leaks between tests.
afterEach(() => {
    TemporaryChatDelete.detachListeners();
});


/** Reset all state fields to initial values (replaces __resetState). */
function resetState() {
    Object.assign(TemporaryChatDelete.state, {
        capturedAuthToken: null,
        trackedTemporaryUuid: null,
        createdSessionIds: new Set(),
        sentSessionIds: new Set(),
        enabledFirstSendIds: new Set(),
        pendingTemporaryUuid: null,
        suppressNextUnloadDelete: false,
        isKeyboardRefresh: false,
        isListening: false,
    });
    globalThis.TemporaryChatEnabledFlag.__setCache(false);
}

/** Apply a state object, routing enabledFlagCache through the flag module (replaces __setState). */
function applyState(obj) {
    const { enabledFlagCache, ...rest } = obj;
    Object.assign(TemporaryChatDelete.state, rest);
    if ('enabledFlagCache' in obj) globalThis.TemporaryChatEnabledFlag.__setCache(enabledFlagCache);
}

/** DSS_CHAT_CREATE_DETECTED as the main-world hook posts it when a create response returns createdSessionId. */
function createMessage(createdSessionId, source = window) {
    return new MessageEvent('message', { data: { type: 'DSS_CHAT_CREATE_DETECTED', createdSessionId }, source });
}

/** DSS_CHAT_COMPLETION_DETECTED as the main-world hook posts it for a message sent in chatSessionId. */
function completionMessage(chatSessionId, source = window) {
    return new MessageEvent('message', { data: { type: 'DSS_CHAT_COMPLETION_DETECTED', chatSessionId }, source });
}

/** Every DSS_TRACK_FOR_DELETION request sent to background (the observable "marked temporary" output). */
function trackRequests() {
    return chrome.runtime.sendMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.type === 'DSS_TRACK_FOR_DELETION');
}

/** On the homepage with the switch on: a create returns uuid, then the first message is sent in uuid. */
function matchOnHomepage(uuid) {
    globalThis.TemporaryChatEnabledFlag.__setCache(true);
    TemporaryChatDelete.handleCreateMessage(createMessage(uuid));
    TemporaryChatDelete.handleCompletionMessage(completionMessage(uuid));
}
// ── Group A: initEnabledFlagFromStorage ───────────────────────────────────────

describe('A — initEnabledFlagFromStorage', () => {
    beforeEach(() => {
        resetState();
    });

    it('A1: reads dss-temporary-chat-enabled through the settings pipeline', async () => {
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = true;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('A2: sets _enabledFlagCache to true when the reported value is true', async () => {
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = true;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('A3: sets _enabledFlagCache to false when the value is absent', async () => {
        // settingsStore is empty
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('A4: sets _enabledFlagCache to false when the reported value is false', async () => {
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = false;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });
});

// ── Group B: readEnabledFlag ──────────────────────────────────────────────────

describe('B — readEnabledFlag', () => {
    beforeEach(() => {
        resetState();
    });

    it('B1: returns false when cache is not initialised (default)', () => {
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('B2: returns true when cache was set to true', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('B3: the in-memory cache wins over a diverging persisted value, and the read is synchronous', async () => {
        // Observable form of "reads only from cache": persist the OPPOSITE value in
        // both backing stores, then read. A cache-only read returns the cached value
        // immediately; anything that consulted storage would have to return false --
        // or a Promise, which `toBe(true)` also rejects.
        await chrome.storage.local.set({ [globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY]: false });
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = false;
        globalThis.TemporaryChatEnabledFlag.__setCache(true);

        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);

        // ...and symmetrically, so the assertion cannot pass on a hardcoded `true`.
        await chrome.storage.local.set({ [globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY]: true });
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = true;
        globalThis.TemporaryChatEnabledFlag.__setCache(false);

        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });
});

// ── Group C: sessionStorage helpers ──────────────────────────────────────────

describe('C — sessionStorage helpers', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
    });

    it('C1: loadTrackedUuid returns null when sessionStorage key is absent', () => {
        expect(TemporaryChatDelete.loadTrackedUuid()).toBeNull();
    });

    it('C2: saveTrackedUuid persists a uuid and loadTrackedUuid retrieves it', () => {
        TemporaryChatDelete.saveTrackedUuid('aaaa-bbbb');
        expect(TemporaryChatDelete.loadTrackedUuid()).toBe('aaaa-bbbb');
    });

    it('C3: saveTrackedUuid with null removes the key', () => {
        TemporaryChatDelete.saveTrackedUuid('some-uuid');
        TemporaryChatDelete.saveTrackedUuid(null);
        expect(TemporaryChatDelete.loadTrackedUuid()).toBeNull();
    });
});

// ── Group D: extractUuidFromUrl ───────────────────────────────────────────────

describe('D — extractUuidFromUrl', () => {
    it.each([
        ['D1', '/a/chat/s/aaaa1111-bbbb-cccc-dddd-eeeeeeee0000', 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0000'],
        ['D5', 'https://chat.deepseek.com/a/chat/s/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6?foo=bar', 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6'],
        ['D6', 'https://chat.deepseek.com/a/chat/s/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6#msg-42', 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6'],
        ['D7', 'https://chat.deepseek.com/a/chat/s/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6?model=v3#msg-42', 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6'],
    ])('%s: extracts uuid from %s', (_label, input, expected) => {
        expect(TemporaryChatDelete.extractUuidFromUrl(input)).toBe(expected);
    });

    it.each([
        ['D2', '/'],
        ['D3', '/a/other/path'],
    ])('%s: returns null for %s', (_label, input) => {
        expect(TemporaryChatDelete.extractUuidFromUrl(input)).toBeNull();
    });

    it('D4: uses window.location.pathname when no argument given', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        window.history.replaceState({}, '', `/a/chat/s/${uuid}`);
        expect(TemporaryChatDelete.extractUuidFromUrl()).toBe(uuid);
        window.history.replaceState({}, '', '/');
    });
});

// ── Group E: handleAuthMessage ────────────────────────────────────────────────

describe('E — handleAuthMessage', () => {
    beforeEach(() => {
        resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('E1: captures token from DSS_AUTH_CAPTURED message', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer abc' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.state.capturedAuthToken).toBe('Bearer abc');
    });

    it('E5: sends DSS_SET_LAST_AUTH_TOKEN to background when token present', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer abc' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'DSS_SET_LAST_AUTH_TOKEN', token: 'Bearer abc' });
    });

    it('E6: does NOT send DSS_SET_LAST_AUTH_TOKEN to background when authorization is absent', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: null },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DSS_SET_LAST_AUTH_TOKEN' }));
    });

    it('E2: ignores messages not from window (source !== window)', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer foreign' },
            source: null,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.state.capturedAuthToken).toBeNull();
    });

    it('E3: ignores messages with wrong type', () => {
        const event = new MessageEvent('message', {
            data: { type: 'SOME_OTHER_TYPE', authorization: 'Bearer wrong' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.state.capturedAuthToken).toBeNull();
    });

    it('E4: captures token regardless of toggle state (token always saved)', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(false);
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer unconditional' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.state.capturedAuthToken).toBe('Bearer unconditional');
    });
});

// ── Group F: handleCreateMessage — the created session id ─────────────────────

describe('F — handleCreateMessage (created session id)', () => {
    const U = 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0f01';

    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        setPathname(`/a/chat/s/${U}`);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('F1: a create for U after the first send in U with the switch on (completion first) tracks U on its page', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));
        expect(trackRequests(), 'a send alone is not enough').toEqual([]);

        TemporaryChatDelete.handleCreateMessage(createMessage(U));

        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: U }]);
    });

    it('F2: a create that arrives while the switch is off still counts once the first send in U goes out with the switch on', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(false);
        TemporaryChatDelete.handleCreateMessage(createMessage(U));
        globalThis.TemporaryChatEnabledFlag.__setCache(true);

        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));

        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: U }]);
    });

    it.each([
        ['F3: ignores messages not from window', () => createMessage(U, null)],
        ['F4: ignores messages with wrong type', () => new MessageEvent('message', { data: { type: 'WRONG_TYPE', createdSessionId: U }, source: window })],
        ['F5: ignores a create message without createdSessionId', () => new MessageEvent('message', { data: { type: 'DSS_CHAT_CREATE_DETECTED' }, source: window })],
        ['F6: a create for another session does not make U temporary', () => createMessage('bbbb2222-bbbb-cccc-dddd-eeeeeeee0f02')],
    ])('%s — U is not tracked', (_label, makeEvent) => {
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));

        TemporaryChatDelete.handleCreateMessage(makeEvent());

        expect(trackRequests()).toEqual([]);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });
});

// ── Group G: handleCompletionMessage — the first send ─────────────────────────

describe('G — handleCompletionMessage (first send)', () => {
    const U = 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0c01';

    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        setPathname(`/a/chat/s/${U}`);
        TemporaryChatDelete.handleCreateMessage(createMessage(U));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it.each([
        ['G1: ignores messages from non-window source', true, () => completionMessage(U, null)],
        ['G2: ignores messages with wrong type', true, () => new MessageEvent('message', { data: { type: 'WRONG_TYPE', chatSessionId: U }, source: window })],
        ['G3: a first send with the switch off does not mark U', false, () => completionMessage(U)],
        ['G5: a completion without a chatSessionId does not mark U', true, () => completionMessage(null)],
    ])('%s', (_label, isEnabled, makeEvent) => {
        globalThis.TemporaryChatEnabledFlag.__setCache(isEnabled);

        TemporaryChatDelete.handleCompletionMessage(makeEvent());

        expect(trackRequests()).toEqual([]);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });

    it('G4: the first send in created U with the switch on, while the URL is U, tracks U at once', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(true);

        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(U);
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBe(U);
        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: U }]);
    });

    it('G6: a later send with the switch on does not mark U when its first send went out with the switch off', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(false);
        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));
        globalThis.TemporaryChatEnabledFlag.__setCache(true);

        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));

        expect(trackRequests()).toEqual([]);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });
});

// ── Group H: matching a created session with its first send ───────────────────
// Rule: U is temporary only when a create response in this page load returned U AND the first
// message sent in U went out with the switch on, in either order, with no time window.

describe('H — temporary-session matching (created + first send with the switch on)', () => {
    const U = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee'; // created by this page load
    const X = 'da794fe0-243a-4ba5-817a-b88ff327e634'; // an existing conversation opened at page load
    const N = '26c81320-1ce0-4172-bd5e-cb5b7a55f332'; // the empty session the page-load create returns

    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        setPathname('/');
        vi.useFakeTimers();
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    function navigateTo(uuid) {
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({ destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}` }));
    }

    it('H1: a created U that is never sent in is never marked, not even when navigation reaches U', () => {
        TemporaryChatDelete.handleCreateMessage(createMessage(U));
        vi.advanceTimersByTime(60000);

        navigateTo(U);

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(trackRequests()).toEqual([]);
    });

    it('H2: a send in U that this page load never created is never marked, not even when navigation reaches U', () => {
        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));

        navigateTo(U);

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(trackRequests()).toEqual([]);
    });

    it('H3: created U first sent with the switch on while on the homepage — nothing is tracked yet', () => {
        TemporaryChatDelete.handleCreateMessage(createMessage(U));
        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBeNull();
        expect(trackRequests()).toEqual([]);
    });

    it('H4: there is no time window — a first send 30 s after the create still marks U on its page', () => {
        setPathname(`/a/chat/s/${U}`);
        TemporaryChatDelete.handleCreateMessage(createMessage(U));
        vi.advanceTimersByTime(30000);

        TemporaryChatDelete.handleCompletionMessage(completionMessage(U));

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(U);
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBe(U);
    });

    it('H5: existing conversation X open at page load — the create returns N, the user sends in X — X is never tracked', () => {
        setPathname(`/a/chat/s/${X}`);
        TemporaryChatDelete.handleCreateMessage(createMessage(N));
        TemporaryChatDelete.handleCompletionMessage(completionMessage(X));
        vi.advanceTimersByTime(5000);

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBeNull();
    });

    it('H6: DSS_TRACK_FOR_DELETION goes only to the matched created+sent uuid, never to the open existing conversation', () => {
        setPathname(`/a/chat/s/${X}`);
        TemporaryChatDelete.handleCreateMessage(createMessage(N));
        TemporaryChatDelete.handleCompletionMessage(completionMessage(X));
        expect(trackRequests(), 'sending in existing conversation X must not track anything').toEqual([]);

        // The user starts the new conversation N: its first send goes out while the URL is N.
        setPathname(`/a/chat/s/${N}`);
        TemporaryChatDelete.handleCompletionMessage(completionMessage(N));

        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: N }]);
    });
});

// ── Group I: handleNavigationEvent — marking new temporary conversations ──────

describe('I — handleNavigationEvent (marking)', () => {
    const U = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee'; // created + first sent with the switch on
    const X = 'eeee5555-ffff-0000-1111-222233334444'; // an existing conversation

    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        chrome.runtime.sendMessage.mockClear();
        setPathname('/');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    function navigateTo(uuid) {
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: uuid ? `https://chat.deepseek.com/a/chat/s/${uuid}` : 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));
    }

    it('I1: with U matched on the homepage, navigating to existing X does not mark X; navigating to U marks U', () => {
        matchOnHomepage(U);

        navigateTo(X);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid, 'existing conversation X must never be marked').toBeNull();

        setPathname(`/a/chat/s/${X}`);
        navigateTo(U);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(U);
    });

    it('I1b: sends DSS_TRACK_FOR_DELETION for the matched U only, never for X', () => {
        matchOnHomepage(U);

        navigateTo(X);
        setPathname(`/a/chat/s/${X}`);
        navigateTo(U);

        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: U }]);
    });

    it('I2: persists U to sessionStorage once navigation reaches U, and nothing before', () => {
        matchOnHomepage(U);
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBeNull();

        navigateTo(U);

        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBe(U);
    });

    it('I3: does NOT mark when nothing was matched (switch on, no create or send)', () => {
        globalThis.TemporaryChatEnabledFlag.__setCache(true);

        navigateTo(U);

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(trackRequests()).toEqual([]);
    });

    it('I4: does NOT mark the matched U when the switch is OFF at navigate time', () => {
        matchOnHomepage(U);
        globalThis.TemporaryChatEnabledFlag.__setCache(false);

        navigateTo(U);

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(trackRequests()).toEqual([]);
    });

    it('I5: a destination without a chat uuid marks nothing, and U is still marked when navigation reaches it', () => {
        matchOnHomepage(U);

        navigateTo(null);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();

        navigateTo(U);
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(U);
    });
});

// ── Group J: handleNavigationEvent — deletion on leave ───────────────────────

describe('J — handleNavigationEvent (deletion on leave)', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('J1: posts DSS_FIBER_DELETE_SESSION message (keepalive: false) when leaving tracked conversation', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_SESSION',
            sessionId: uuid
        }, '*');

        postMessageSpy.mockRestore();
    });

    it('J2: does NOT ask background to schedule a delete retry on navigation (keepalive: false path)', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DSS_SCHEDULE_DELETE_RETRY' }));
    });

    it('J3: clears trackedTemporaryUuid after navigation deletion', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });

    it.each([
        ['J4: does NOT delete when leaving a NON-tracked conversation', '/a/chat/s/bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', { trackedTemporaryUuid: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', capturedAuthToken: 'Bearer tok' }],
        ['J5: does NOT delete when no tracked uuid', '/a/chat/s/cccc3333-cccc-cccc-cccc-cccccccccccc', { trackedTemporaryUuid: null, capturedAuthToken: 'Bearer tok' }],
    ])('%s', (_label, pathname, state) => {
        setPathname(pathname);
        applyState(state);

        // DSS_FIBER_DELETE_SESSION is the PRIMARY navigation delete channel and
        // deleteChatSessionWithRetry only its fallback, so asserting on the fallback
        // alone would miss a delete that actually fired.
        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        // Nothing was deleted, so whatever was tracked must still be tracked --
        // dropping it here would leak an undeleted temporary conversation.
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(state.trackedTemporaryUuid);

        postMessageSpy.mockRestore();
    });

    it('J6: hands off to service worker when no auth token — no delete, releases lease and schedules retry', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        setPathname(`/a/chat/s/${uuid}`);
        applyState({ trackedTemporaryUuid: uuid, capturedAuthToken: null });
        sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, uuid);

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        // No delete attempt — neither Fiber postMessage nor API retry.
        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        // Hands off to service worker: release lease so background can manage the pending delete.
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: globalThis.DSS_TEMP_CHAT.DSS_MSG_RELEASE_LEASE, uuid });
        // Tracked UUID is cleared — the content script is no longer responsible.
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBeNull();

        postMessageSpy.mockRestore();
    });
});

// ── Group K: same-URL and reload suppression ──────────────────────────────────

describe('K — same-URL / reload must NOT delete', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('K1: navigationType reload → no deletion, suppressNextUnloadDelete set', () => {
        const uuid = 'a1b2c3d4-1111-1111-1111-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'reload',
        }));

        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);
        expect(TemporaryChatDelete.state.suppressNextUnloadDelete).toBe(true);

        postMessageSpy.mockRestore();
    });

    it('K1b: after a genuine reload navigation, the subsequent beforeunload does NOT dispatch the delete (suppress correctly armed)', () => {
        const uuid = 'a1b2c3d4-1112-1112-1112-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'reload',
        }));

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
        // Suppressed, not consumed: the conversation stays tracked so a later real
        // departure can still delete it.
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);
    });

    it('K2: same-URL push (navigationType "push") → no deletion on the navigate event itself, but does NOT arm suppressNextUnloadDelete (only a real reload arms it)', () => {
        const uuid = 'a1b2c3d4-2222-2222-2222-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const currentHref = window.location.href;
        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: currentHref,
            navigationType: 'push',
        }));

        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);
        expect(TemporaryChatDelete.state.suppressNextUnloadDelete).toBe(false);

        postMessageSpy.mockRestore();
    });

    it('K2b (regression): after a same-URL push, a subsequent leave to an external site (beforeunload) DOES dispatch the keepalive delete — suppress must not have been wrongly armed', () => {
        // vi.restoreAllMocks() in this suite's afterEach wipes vi.fn() implementations (mockReset
        // semantics), so re-arm the resolved value here — matching the pattern used in Groups M/N/O.
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValue(true);
        const uuid = 'a1b2c3d4-2223-2223-2223-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const currentHref = window.location.href;
        // Same-URL SPA push (e.g. second navigation while creating the temp chat)
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: currentHref,
            navigationType: 'push',
        }));

        // User then leaves to an external site — no `navigate` event fires for this,
        // only `beforeunload`.
        TemporaryChatDelete.handleBeforeUnload();

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, 'Bearer tok', { keepalive: true });
    });

    it('K3: tracked uuid persists after reload navigation (not cleared)', () => {
        const uuid = 'a1b2c3d4-3333-3333-3333-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'reload',
        }));

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);
    });

    it('K4: isKeyboardRefresh true at navigate time → no deletion, suppress set', () => {
        const uuid = 'a1b2c3d4-4444-4444-4444-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            isKeyboardRefresh: true,
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);
        expect(TemporaryChatDelete.state.suppressNextUnloadDelete).toBe(true);

        postMessageSpy.mockRestore();
    });

    it('K5: isKeyboardRefresh is reset to false after handleNavigationEvent', () => {
        const uuid = 'a1b2c3d4-5555-5555-5555-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            isKeyboardRefresh: true,
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(false);
    });
});

// ── Group L: handleRefreshKeydown ─────────────────────────────────────────────

describe('L — handleRefreshKeydown', () => {
    beforeEach(() => {
        resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['L1: F5 sets isKeyboardRefresh to true', { key: 'F5', ctrlKey: false, metaKey: false }, true],
        ['L2: Ctrl+R sets isKeyboardRefresh to true', { key: 'r', ctrlKey: true, metaKey: false }, true],
        ['L3: Ctrl+R (uppercase) sets isKeyboardRefresh to true', { key: 'R', ctrlKey: true, metaKey: false }, true],
        ['L4: Cmd+R sets isKeyboardRefresh to true', { key: 'r', ctrlKey: false, metaKey: true }, true],
        ['L5: arbitrary key (Enter) does NOT set isKeyboardRefresh', { key: 'Enter', ctrlKey: false, metaKey: false }, false],
        ['L6: Ctrl+S does NOT set isKeyboardRefresh', { key: 's', ctrlKey: true, metaKey: false }, false],
    ])('%s', (_label, keyEvent, expected) => {
        TemporaryChatDelete.handleRefreshKeydown(keyEvent);
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(expected);
    });
});

// ── Group M: handleBeforeUnload ───────────────────────────────────────────────

describe('M — handleBeforeUnload (tab close)', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValue(true);
        chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('M1: calls TemporaryChatDeleteApi.deleteChatSession(uuid, token, {keepalive:true}) on tab close', () => {
        const uuid = 'face0000-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, 'Bearer tok', { keepalive: true });
    });

    it('M2: does NOT ask background to schedule a delete retry (tab-close routes through deleteChatSession)', () => {
        const uuid = 'face0000-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DSS_SCHEDULE_DELETE_RETRY' }));
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
    });

    it.each([
        ['M3: does NOT delete when suppressNextUnloadDelete is true', '/a/chat/s/face0001-f00d-dead-beef-0123456789ab', { trackedTemporaryUuid: 'face0001-f00d-dead-beef-0123456789ab', capturedAuthToken: 'Bearer tok', suppressNextUnloadDelete: true }],
        ['M4: does NOT delete when isKeyboardRefresh is true', '/a/chat/s/face0002-f00d-dead-beef-0123456789ab', { trackedTemporaryUuid: 'face0002-f00d-dead-beef-0123456789ab', capturedAuthToken: 'Bearer tok', suppressNextUnloadDelete: false, isKeyboardRefresh: true }],
        ['M5: does NOT delete when current URL uuid !== tracked uuid', '/a/chat/s/bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', { trackedTemporaryUuid: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', capturedAuthToken: 'Bearer tok', suppressNextUnloadDelete: false, isKeyboardRefresh: false }],
        ['M6: does NOT delete when URL has no chat uuid', '/', { trackedTemporaryUuid: 'face0006-f00d-dead-beef-0123456789ab', capturedAuthToken: 'Bearer tok', suppressNextUnloadDelete: false, isKeyboardRefresh: false }],
        ['M7: does NOT delete when no auth token', '/a/chat/s/face0003-f00d-dead-beef-0123456789ab', { trackedTemporaryUuid: 'face0003-f00d-dead-beef-0123456789ab', capturedAuthToken: null, suppressNextUnloadDelete: false, isKeyboardRefresh: false }],
    ])('%s', (_label, pathname, state) => {
        setPathname(pathname);
        sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, state.trackedTemporaryUuid);
        applyState(state);

        TemporaryChatDelete.handleBeforeUnload();

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
        // A suppressed unload leaves tracking intact, in memory and in sessionStorage,
        // so the conversation is still deletable on the next real departure.
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(state.trackedTemporaryUuid);
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBe(state.trackedTemporaryUuid);
    });
});

// ── Group N: deleteTrackedAndClear ─────────────────────────────────────────────

describe('N — deleteTrackedAndClear', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValue(true);
        chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
    });

    it('N10: sends DSS_REMOVE_OPEN_UUID to background on departure', () => {
        const uuid = 'dede0009-dead-dead-dead-deaddeaddead';
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'DSS_REMOVE_OPEN_UUID', uuid });
    });

    it('N1: navigation (keepalive: false) — posts DSS_FIBER_DELETE_SESSION message', () => {
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_SESSION',
            sessionId: uuid
        }, '*');

        postMessageSpy.mockRestore();
    });

    it('N2: navigation (keepalive: false) — falls back to API if fiber delete fails', () => {
        vi.useFakeTimers();
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        // Simulate failure response
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_FIBER_DELETE_RESULT', sessionId: uuid, success: false },
            source: window
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).toHaveBeenCalledWith(uuid, 'Bearer tok');
        vi.useRealTimers();
    });

    it('N8: navigation (keepalive: false) — falls back to API on timeout', () => {
        vi.useFakeTimers();
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        // Fast-forward 3 seconds
        vi.advanceTimersByTime(3000);

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).toHaveBeenCalledWith(uuid, 'Bearer tok');
        vi.useRealTimers();
    });

    it('N9: navigation (keepalive: false) — does NOT fallback to API if fiber delete succeeds; sends DSS_REMOVE_PENDING_DELETE', () => {
        vi.useFakeTimers();
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        // Simulate success response
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_FIBER_DELETE_RESULT', sessionId: uuid, success: true },
            source: window
        }));

        // Fast-forward 3 seconds
        vi.advanceTimersByTime(3000);

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'DSS_REMOVE_PENDING_DELETE', uuid });
        vi.useRealTimers();
    });

    it('N3: tab close (keepalive: true) — calls TemporaryChatDeleteApi.deleteChatSession(uuid, token, {keepalive:true})', () => {
        const uuid = 'dede0002-dead-dead-dead-deaddeaddead';
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, 'Bearer close', { keepalive: true });
    });

    it('N4: tab close (keepalive: true) — does NOT ask background to schedule a delete retry nor call deleteChatSessionWithRetry', () => {
        const uuid = 'dede0002-dead-dead-dead-deaddeaddead';
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DSS_SCHEDULE_DELETE_RETRY' }));
    });

    it('N11: tab close (keepalive: true) — sends DSS_REMOVE_PENDING_DELETE after a successful deleteChatSession', async () => {
        const uuid = 'dede0010-dead-dead-dead-deaddeaddead';
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValueOnce(true);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        // Allow the .then() microtask chain on the deleteChatSession promise to settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'DSS_REMOVE_PENDING_DELETE', uuid });
    });

    it('N12: tab close (keepalive: true) — sends no DSS_REMOVE_PENDING_DELETE when deleteChatSession fails', async () => {
        const uuid = 'dede0011-dead-dead-dead-deaddeaddead';
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValueOnce(false);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        await Promise.resolve();
        await Promise.resolve();

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DSS_REMOVE_PENDING_DELETE' }));
    });

    it('N5: clears _trackedTemporaryUuid and saves null to sessionStorage', () => {
        const uuid = 'dede0003-dead-dead-dead-deaddeaddead';
        sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, uuid);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBeNull();
    });

    it.each([
        ['N6: is a no-op when trackedTemporaryUuid is null', { capturedAuthToken: 'Bearer tok', trackedTemporaryUuid: null }],
        ['N7: is a no-op when capturedAuthToken is null', { trackedTemporaryUuid: 'dede0004-dead-dead-dead-deaddeaddead', capturedAuthToken: null }],
    ])('%s', (_label, state) => {
        if (state.trackedTemporaryUuid) sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, state.trackedTemporaryUuid);
        applyState(state);

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.deleteTrackedAndClear();

        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        // A no-op must leave tracking exactly as it found it -- clearing here would
        // silently orphan a conversation that was never deleted.
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(state.trackedTemporaryUuid);
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBe(state.trackedTemporaryUuid);

        postMessageSpy.mockRestore();
    });
});

// ── Group O: toggle-off with active tracked conversation ──────────────────────

describe('O — toggle-off still deletes tracked conversation', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValue(true);
        chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it.each([
        ['O1: handleToggleChanged(false) with a tracked uuid keeps listeners attached', 'face0005-f00d-dead-beef-0123456789ab', true],
        ['O2: handleToggleChanged(false) without tracked uuid detaches listeners', null, false],
    ])('%s', (_label, trackedTemporaryUuid, expectedIsListening) => {
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid,
            isListening: true,
        });

        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: false } });
        TemporaryChatDelete.handleToggleChanged(evt);

        expect(TemporaryChatDelete.state.isListening).toBe(expectedIsListening);
    });

    it('O3: after toggle off, leaving tracked conversation still calls deleteTrackedAndClear (keepalive: true)', () => {
        const uuid = 'face0004-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, { trackedTemporaryUuid: uuid, capturedAuthToken: 'Bearer tok', suppressNextUnloadDelete: false, isKeyboardRefresh: false });
        globalThis.TemporaryChatEnabledFlag.__setCache(false);

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, 'Bearer tok', { keepalive: true });
    });

    it.each([
        ['O5: handleToggleChanged(true) updates _enabledFlagCache to true', false, true],
        ['O6: handleToggleChanged(false) updates _enabledFlagCache to false', true, false],
    ])('%s', (_label, initialEnabledFlagCache, toggleTo) => {
        // Arrange
        globalThis.TemporaryChatEnabledFlag.__setCache(initialEnabledFlagCache);
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(initialEnabledFlagCache);

        // Act
        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: toggleTo } });
        TemporaryChatDelete.handleToggleChanged(evt);

        // Assert
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(toggleTo);
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(toggleTo);
    });
});

// ── Group P: listener lifecycle ────────────────────────────────────────────────

describe('P — listener lifecycle', () => {
    beforeEach(() => {
        resetState();
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
        vi.restoreAllMocks();
    });

    it('P1: attachListeners sets isListening to true', () => {
        TemporaryChatDelete.attachListeners();
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });

    it('P2: attachListeners is idempotent (calling twice does not double-register)', () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.attachListeners();
        expect(TemporaryChatDelete.state.isListening).toBe(true);
    });

    it('P3: detachListeners sets isListening to false', () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.detachListeners();
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });

    it('P4: detachListeners is idempotent (calling when already detached is safe)', () => {
        expect(() => TemporaryChatDelete.detachListeners()).not.toThrow();
        expect(TemporaryChatDelete.state.isListening).toBe(false);
    });

    // ── Real init() behaviour ────────────────────────────────────────────────
    // Replaces the former P5/P6/P7, which re-implemented init()'s attach ordering
    // inline in the test body and therefore passed no matter what init() did.
    // These call the real init() and assert only what an outside observer can see.

    it('P5: init() seeds the enabled flag from the settings pipeline', async () => {
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = true;
        globalThis.TemporaryChatEnabledFlag.__setCache(false);

        await TemporaryChatDelete.init();

        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('P6: after init() with the flag enabled, real window messages reach the handlers (listeners are live)', async () => {
        const U = 'eeee6666-2222-3333-4444-555555555555';
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = true;
        resetState();
        setPathname(`/a/chat/s/${U}`);

        await TemporaryChatDelete.init();

        // Auth capture: dispatched on window, NOT handed to the handler directly.
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer post-init' },
            source: window,
        }));
        expect(TemporaryChatDelete.state.capturedAuthToken).toBe('Bearer post-init');

        // Create + first send for the open conversation U, through the same live window.
        window.dispatchEvent(createMessage(U));
        window.dispatchEvent(completionMessage(U));
        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: U }]);

        setPathname('/');
        sessionStorage.clear();
    });

    it('P7: init() restores a tracked uuid from sessionStorage and goes live even while the flag is disabled', async () => {
        const uuid = 'eeee1111-2222-3333-4444-555555555555';
        sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, uuid);
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = false;
        resetState();

        await TemporaryChatDelete.init();

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);
        // A tracked conversation must still be deletable, so the listeners must be live
        // even though the toggle is off: prove it through an observable state mutation.
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer tracked' },
            source: window,
        }));
        expect(TemporaryChatDelete.state.capturedAuthToken).toBe('Bearer tracked');

        sessionStorage.clear();
    });

    it('P8: with no tracked uuid and the flag disabled, init() leaves the listeners detached', async () => {
        sessionStorage.clear();
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = false;
        resetState();

        await TemporaryChatDelete.init();

        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer should-be-ignored' },
            source: window,
        }));
        expect(TemporaryChatDelete.state.capturedAuthToken).toBeNull();
    });

    it('P9: with the flag disabled at init(), a create still reaches the session observer — switching on, then the first send in U tracks U', async () => {
        const U = 'eeee9999-2222-3333-4444-555555555555';
        sessionStorage.clear();
        settingsStore[globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_STORAGE_KEY] = false;
        resetState();
        setPathname(`/a/chat/s/${U}`);

        await TemporaryChatDelete.init();

        // DeepSeek creates the session at page load, before the user turns the switch on.
        window.dispatchEvent(createMessage(U));
        window.dispatchEvent(new CustomEvent(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_CHANGED_EVENT, { detail: { isEnabled: true } }));
        window.dispatchEvent(completionMessage(U));

        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: U }]);

        setPathname('/');
        sessionStorage.clear();
    });
});

// ── Group R: handleNavigationEvent (same-conversation guard) ─────────────────

describe('R — handleNavigationEvent (same-conversation guard)', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('R1: same uuid, destination identical to current href → no delete, uuid stays tracked', () => {
        const uuid = 'a1b2c3d4-1111-2222-3333-a1b2c3d4e5f6';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: window.location.href,
            navigationType: 'push',
        }));

        expect(postMessageSpy).not.toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_SESSION',
            sessionId: uuid,
        }, '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);

        postMessageSpy.mockRestore();
    });

    it.each([
        ['R2: same uuid, destination differs only by query string', 'a1b2c3d4-2222-3333-4444-a1b2c3d4e5f6', '?model=v3'],
        ['R3: same uuid, destination differs only by hash fragment', 'a1b2c3d4-3333-4444-5555-a1b2c3d4e5f6', '#msg-42'],
        ['R4: same uuid, destination differs by BOTH query string and hash fragment', 'a1b2c3d4-4444-5555-6666-a1b2c3d4e5f6', '?model=v3#msg-42'],
    ])('%s → no delete, uuid stays tracked', (_label, uuid, suffix) => {
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}${suffix}`,
            navigationType: 'push',
        }));

        expect(postMessageSpy).not.toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_SESSION',
            sessionId: uuid,
        }, '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);

        postMessageSpy.mockRestore();
    });

    it('R5: DIFFERENT uuid, destination has query/hash → deletion STILL fires (guard compares uuid, not full URL)', () => {
        const trackedUuid = 'a1b2c3d4-5555-6666-7777-a1b2c3d4e5f6';
        const destUuid = 'b2b2c3d4-6666-7777-8888-b2b2c3d4e5f6';
        setPathname(`/a/chat/s/${trackedUuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: trackedUuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${destUuid}?model=v3#msg-42`,
            navigationType: 'push',
        }));

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_SESSION',
            sessionId: trackedUuid,
        }, '*');
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();

        postMessageSpy.mockRestore();
    });

    it('R6: no tracked uuid, destination has a uuid → isSameConversation false, deletion no-ops (no tracked uuid)', () => {
        const destUuid = 'c3c3d4e5-7777-8888-9999-c3c3d4e5f6a7';
        setPathname('/');
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: null,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${destUuid}?model=v3`,
            navigationType: 'push',
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });

    it('R7: destination has NO uuid (homepage) while leaving tracked conversation → normal deletion-on-leave still fires', () => {
        const uuid = 'a1b2c3d4-6666-7777-8888-a1b2c3d4e5f6';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_SESSION',
            sessionId: uuid,
        }, '*');
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();

        postMessageSpy.mockRestore();
    });
});

// ── Group Q: handleHistoryNavMessage ─────────────────────────────────────────

describe('Q — handleHistoryNavMessage', () => {
    const U = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee'; // created + first sent with the switch on
    const X = 'bbbb2222-cccc-dddd-eeee-ffffffffffff'; // an existing conversation

    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        setPathname('/');
        matchOnHomepage(U);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    function historyNav(uuid, { source = window, type = 'DSS_HISTORY_NAV' } = {}) {
        return new MessageEvent('message', {
            data: { type, url: `https://chat.deepseek.com/a/chat/s/${uuid}` },
            source,
        });
    }

    it.each([
        ['Q1: ignores message when e.source !== window — U is not marked', { source: null }],
        ['Q2: ignores message when e.data.type !== DSS_HISTORY_NAV — U is not marked', { type: 'SOME_OTHER_TYPE' }],
    ])('%s', (_label, override) => {
        TemporaryChatDelete.handleHistoryNavMessage(historyNav(U, override));

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
        expect(trackRequests()).toEqual([]);
    });

    it('Q3: delegates to handleNavigationEvent — a DSS_HISTORY_NAV to existing X marks nothing, one to the matched U marks U', () => {
        // handleHistoryNavMessage calls handleNavigationEvent inside the part closure (a spy cannot
        // intercept it), so delegation is verified through what navigation marks.
        TemporaryChatDelete.handleHistoryNavMessage(historyNav(X));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid, 'existing conversation X must never be marked').toBeNull();

        TemporaryChatDelete.handleHistoryNavMessage(historyNav(U));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(U);
        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: U }]);
    });

    it('Q4: handleWindowMessage routes DSS_HISTORY_NAV to handleHistoryNavMessage — X is not marked, the matched U is', () => {
        TemporaryChatDelete.handleWindowMessage(historyNav(X));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid, 'existing conversation X must never be marked').toBeNull();

        TemporaryChatDelete.handleWindowMessage(historyNav(U));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(U);
        expect(trackRequests()).toEqual([{ type: 'DSS_TRACK_FOR_DELETION', uuid: U }]);
    });
});

// ── Group S: download navigation must NOT delete ────────────────────────────

describe('S — download navigation (blob / downloadRequest) must NOT delete', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
        chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    /**
     * Build a NavigateEvent that represents a file download triggered by
     * an <a download> click. Chrome fires navigation.navigate for these
     * with event.downloadRequest set to the filename and
     * event.destination.url set to the blob URL.
     */
    function makeDownloadNavigateEvent({
        downloadRequest = null,
        destinationUrl,
        navigationType = 'push',
    }) {
        return {
            destination: { url: destinationUrl },
            navigationType,
            ...(downloadRequest != null ? { downloadRequest } : {}),
        };
    }

    it('S1: blob destination + downloadRequest set → no deletion, tracking retained', () => {
        const uuid = 'dddd1111-aaaa-bbbb-cccc-dddddddddddd';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeDownloadNavigateEvent({
            downloadRequest: 'conversation.md',
            destinationUrl: 'blob:https://chat.deepseek.com/abc-123-def',
        }));

        // No deletion must have occurred — neither Fiber nor API.
        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
        // Tracking must be retained — the user is still on the page.
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBeNull();

        postMessageSpy.mockRestore();
    });

    it('S2: downloadRequest set with a NON-blob destination → no deletion, tracking retained', () => {
        const uuid = 'dddd2222-aaaa-bbbb-cccc-dddddddddddd';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeDownloadNavigateEvent({
            downloadRequest: 'export.json',
            destinationUrl: 'https://chat.deepseek.com/api/export/file.json',
        }));

        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);

        postMessageSpy.mockRestore();
    });

    it('S3: blob destination but downloadRequest absent → no deletion, tracking retained', () => {
        const uuid = 'dddd3333-aaaa-bbbb-cccc-dddddddddddd';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeDownloadNavigateEvent({
            // downloadRequest is omitted (absent/null)
            destinationUrl: 'blob:https://chat.deepseek.com/xyz-789-ghi',
        }));

        expect(postMessageSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DSS_FIBER_DELETE_SESSION' }), '*');
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(uuid);

        postMessageSpy.mockRestore();
    });

    it('S4 (contrast): genuine navigation away — no downloadRequest, no blob — deletion DOES occur', () => {
        const uuid = 'dddd4444-aaaa-bbbb-cccc-dddddddddddd';
        setPathname(`/a/chat/s/${uuid}`);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/a/chat/s/eeee5555-ffff-0000-1111-222233334444',
            navigationType: 'push',
        }));

        // Genuine leave: deletion MUST fire.
        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'DSS_FIBER_DELETE_SESSION',
            sessionId: uuid,
        }, '*');
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();

        postMessageSpy.mockRestore();
    });
});
