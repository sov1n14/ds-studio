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

// ── Group A: initEnabledFlagFromStorage ───────────────────────────────────────

describe('A — initEnabledFlagFromStorage', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    it('A1: reads dss-temporary-chat-enabled through the settings pipeline', async () => {
        settingsStore['dss-temporary-chat-enabled'] = true;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.__getState().enabledFlagCache).toBe(true);
    });

    it('A2: sets _enabledFlagCache to true when the reported value is true', async () => {
        settingsStore['dss-temporary-chat-enabled'] = true;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('A3: sets _enabledFlagCache to false when the value is absent', async () => {
        // settingsStore is empty
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('A4: sets _enabledFlagCache to false when the reported value is false', async () => {
        settingsStore['dss-temporary-chat-enabled'] = false;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });
});

// ── Group B: readEnabledFlag ──────────────────────────────────────────────────

describe('B — readEnabledFlag', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    it('B1: returns false when cache is not initialised (default)', () => {
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('B2: returns true when cache was set via __setState', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('B3: does NOT call chrome.storage.local (reads only from cache)', async () => {
        const getSpy = vi.spyOn(chrome.storage.local, 'get');
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        TemporaryChatDelete.readEnabledFlag();
        expect(getSpy).not.toHaveBeenCalled();
        getSpy.mockRestore();
    });
});

// ── Group C: sessionStorage helpers ──────────────────────────────────────────

describe('C — sessionStorage helpers', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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
        TemporaryChatDelete.__resetState();
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
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBe('Bearer abc');
    });

    it('E5: calls TemporaryChatPendingStore.setLastAuthToken(token) when token present', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer abc' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(global.TemporaryChatPendingStore.setLastAuthToken).toHaveBeenCalledWith('Bearer abc');
    });

    it('E6: does NOT call setLastAuthToken when authorization is absent', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: null },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(global.TemporaryChatPendingStore.setLastAuthToken).not.toHaveBeenCalled();
    });

    it('E2: ignores messages not from window (source !== window)', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer foreign' },
            source: null,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });

    it('E3: ignores messages with wrong type', () => {
        const event = new MessageEvent('message', {
            data: { type: 'SOME_OTHER_TYPE', authorization: 'Bearer wrong' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });

    it('E4: captures token regardless of toggle state (token always saved)', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: false });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer unconditional' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBe('Bearer unconditional');
    });
});

// ── Group F: handleCreateMessage — creation detection → co-occurrence ─────────

describe('F — handleCreateMessage (creation detection)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['F1: sets _createDetected when toggle is ON', true, window, 'DSS_CHAT_CREATE_DETECTED', true],
        ['F2: does NOT set _createDetected when toggle is OFF', false, window, 'DSS_CHAT_CREATE_DETECTED', false],
        ['F3: ignores messages not from window', true, null, 'DSS_CHAT_CREATE_DETECTED', false],
        ['F4: ignores messages with wrong type', true, window, 'WRONG_TYPE', false],
    ])('%s', (_label, enabledFlagCache, source, type, expected) => {
        TemporaryChatDelete.__setState({ enabledFlagCache });
        const event = new MessageEvent('message', { data: { type }, source });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().createDetected).toBe(expected);
    });
});

// ── Group G: handleCompletionMessage ─────────────────────────────────────────

describe('G — handleCompletionMessage', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['G1: ignores messages from non-window source', true, null, 'DSS_CHAT_COMPLETION_DETECTED'],
        ['G2: ignores messages with wrong type', true, window, 'WRONG_TYPE'],
        ['G3: ignores when _enabledFlagCache is false', false, window, 'DSS_CHAT_COMPLETION_DETECTED'],
    ])('%s', (_label, enabledFlagCache, source, type) => {
        TemporaryChatDelete.__setState({ enabledFlagCache });
        const event = new MessageEvent('message', { data: { type }, source });
        TemporaryChatDelete.handleCompletionMessage(event);
        expect(TemporaryChatDelete.__getState().completionDetected).toBe(false);
    });

    it('G4: sets _completionDetected = true and triggers co-occurrence check (timer started)', () => {
        vi.useFakeTimers();
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_COMPLETION_DETECTED' },
            source: window,
        });
        TemporaryChatDelete.handleCompletionMessage(event);
        const state = TemporaryChatDelete.__getState();
        // completionDetected flag should be set and a timer started (only _completionDetected, not create)
        expect(state.completionDetected).toBe(true);
        expect(state.coOccurrenceTimer).not.toBeNull();
        vi.useRealTimers();
    });
});

// ── Group H: checkCoOccurrence ────────────────────────────────────────────────

describe('H — checkCoOccurrence', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        setPathname('/');
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it.each([
        ['H1: when only _createDetected is true', true, false],
        ['H2: when only _completionDetected is true', false, true],
    ])('%s → does NOT set _isPendingCreate; starts a timer', (_label, createDetected, completionDetected) => {
        TemporaryChatDelete.__setState({ createDetected, completionDetected });
        TemporaryChatDelete.checkCoOccurrence();
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);
        expect(TemporaryChatDelete.__getState().coOccurrenceTimer).not.toBeNull();
    });

    it('H3: when both are true and on homepage → sets _isPendingCreate = true, clears both flags', () => {
        TemporaryChatDelete.__setState({ createDetected: true, completionDetected: true });
        TemporaryChatDelete.checkCoOccurrence();
        const state = TemporaryChatDelete.__getState();
        expect(state.isPendingCreate).toBe(true);
        expect(state.createDetected).toBe(false);
        expect(state.completionDetected).toBe(false);
        expect(state.trackedTemporaryUuid).toBeNull();
    });

    it('H4: timer expiry (1000ms) resets both flags, _isPendingCreate stays false', () => {
        TemporaryChatDelete.__setState({ createDetected: true, completionDetected: false });
        TemporaryChatDelete.checkCoOccurrence();

        vi.advanceTimersByTime(1000);

        const state = TemporaryChatDelete.__getState();
        expect(state.createDetected).toBe(false);
        expect(state.completionDetected).toBe(false);
        expect(state.isPendingCreate).toBe(false);
    });

    it('H5: when both are true and already on chat page → tracks UUID immediately and clears _isPendingCreate', () => {
        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ createDetected: true, completionDetected: true });
        
        TemporaryChatDelete.checkCoOccurrence();
        
        const state = TemporaryChatDelete.__getState();
        expect(state.isPendingCreate).toBe(false);
        expect(state.createDetected).toBe(false);
        expect(state.completionDetected).toBe(false);
        expect(state.trackedTemporaryUuid).toBe(uuid);
        expect(sessionStorage.getItem('dss-temporary-chat-uuid')).toBe(uuid);
    });

    it('H6: when both are true and already on chat page → calls TemporaryChatPendingStore.trackForDeletion(uuid)', () => {
        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ createDetected: true, completionDetected: true });

        TemporaryChatDelete.checkCoOccurrence();

        expect(global.TemporaryChatPendingStore.trackForDeletion).toHaveBeenCalledWith(uuid);
    });
});

// ── Group I: handleNavigationEvent — marking new temporary conversations ──────

describe('I — handleNavigationEvent (marking)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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

    it('I1: marks trackedTemporaryUuid when isPendingCreate is true and destination is a chat URL', () => {
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBe(uuid);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);
    });

    it('I1b: calls TemporaryChatPendingStore.trackForDeletion(uuid) when marking via navigation', () => {
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(global.TemporaryChatPendingStore.trackForDeletion).toHaveBeenCalledWith(uuid);
    });

    it('I2: persists trackedTemporaryUuid to sessionStorage after marking', () => {
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(sessionStorage.getItem('dss-temporary-chat-uuid')).toBe(uuid);
    });

    it.each([
        ['I3: does NOT mark when isPendingCreate is false', { enabledFlagCache: true }],
        ['I4: does NOT mark when toggle is OFF at navigate time (even with pending flag)', { isPendingCreate: true, enabledFlagCache: false }],
    ])('%s', (_label, state) => {
        TemporaryChatDelete.__setState(state);

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it('I5: does NOT mark when destination URL has no chat UUID', () => {
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(true);
    });
});

// ── Group J: handleNavigationEvent — deletion on leave ───────────────────────

describe('J — handleNavigationEvent (deletion on leave)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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
        TemporaryChatDelete.__setState({
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

    it('J2: does NOT call chrome.runtime.sendMessage on navigation (keepalive: false path)', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('J3: clears trackedTemporaryUuid after navigation deletion', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it.each([
        ['J4: does NOT delete when leaving a NON-tracked conversation', '/a/chat/s/bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', { trackedTemporaryUuid: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', capturedAuthToken: 'Bearer tok' }],
        ['J5: does NOT delete when no tracked uuid', '/a/chat/s/cccc3333-cccc-cccc-cccc-cccccccccccc', { trackedTemporaryUuid: null, capturedAuthToken: 'Bearer tok' }],
        ['J6: does NOT delete when no auth token', '/a/chat/s/a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6', { trackedTemporaryUuid: 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6', capturedAuthToken: null }],
    ])('%s', (_label, pathname, state) => {
        setPathname(pathname);
        TemporaryChatDelete.__setState(state);

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
    });
});

// ── Group K: same-URL and reload suppression ──────────────────────────────────

describe('K — same-URL / reload must NOT delete', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'reload',
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.__getState().suppressNextUnloadDelete).toBe(true);
    });

    it('K1b: after a genuine reload navigation, the subsequent beforeunload does NOT dispatch the delete (suppress correctly armed)', () => {
        const uuid = 'a1b2c3d4-1112-1112-1112-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'reload',
        }));

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('K2: same-URL push (navigationType "push") → no deletion on the navigate event itself, but does NOT arm suppressNextUnloadDelete (only a real reload arms it)', () => {
        const uuid = 'a1b2c3d4-2222-2222-2222-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const currentHref = window.location.href;
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: currentHref,
            navigationType: 'push',
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.__getState().suppressNextUnloadDelete).toBe(false);
    });

    it('K2b (regression): after a same-URL push, a subsequent leave to an external site (beforeunload) DOES dispatch the keepalive delete — suppress must not have been wrongly armed', () => {
        // vi.restoreAllMocks() in this suite's afterEach wipes vi.fn() implementations (mockReset
        // semantics), so re-arm the resolved value here — matching the pattern used in Groups M/N/O.
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValue(true);
        const uuid = 'a1b2c3d4-2223-2223-2223-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
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
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'reload',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBe(uuid);
    });

    it('K4: isKeyboardRefresh true at navigate time → no deletion, suppress set', () => {
        const uuid = 'a1b2c3d4-4444-4444-4444-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            isKeyboardRefresh: true,
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.__getState().suppressNextUnloadDelete).toBe(true);
    });

    it('K5: isKeyboardRefresh is reset to false after handleNavigationEvent', () => {
        const uuid = 'a1b2c3d4-5555-5555-5555-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            isKeyboardRefresh: true,
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(false);
    });
});

// ── Group L: handleRefreshKeydown ─────────────────────────────────────────────

describe('L — handleRefreshKeydown', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(expected);
    });
});

// ── Group M: handleBeforeUnload ───────────────────────────────────────────────

describe('M — handleBeforeUnload (tab close)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, 'Bearer tok', { keepalive: true });
    });

    it('M2: does NOT call chrome.runtime.sendMessage (tab-close now routes through deleteChatSession)', () => {
        const uuid = 'face0000-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
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
        TemporaryChatDelete.__setState(state);

        TemporaryChatDelete.handleBeforeUnload();

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });
});

// ── Group N: deleteTrackedAndClear ─────────────────────────────────────────────

describe('N — deleteTrackedAndClear', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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

    it('N10: calls TemporaryChatPendingStore.removeOpenUuid(uuid) on departure', () => {
        const uuid = 'dede0009-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        expect(global.TemporaryChatPendingStore.removeOpenUuid).toHaveBeenCalledWith(uuid);
    });

    it('N1: navigation (keepalive: false) — posts DSS_FIBER_DELETE_SESSION message', () => {
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
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
        TemporaryChatDelete.__setState({
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
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        // Fast-forward 3 seconds
        vi.advanceTimersByTime(3000);

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).toHaveBeenCalledWith(uuid, 'Bearer tok');
        vi.useRealTimers();
    });

    it('N9: navigation (keepalive: false) — does NOT fallback to API if fiber delete succeeds; calls removePendingDelete(uuid)', () => {
        vi.useFakeTimers();
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
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
        expect(global.TemporaryChatPendingStore.removePendingDelete).toHaveBeenCalledWith(uuid);
        vi.useRealTimers();
    });

    it('N3: tab close (keepalive: true) — calls TemporaryChatDeleteApi.deleteChatSession(uuid, token, {keepalive:true})', () => {
        const uuid = 'dede0002-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, 'Bearer close', { keepalive: true });
    });

    it('N4: tab close (keepalive: true) — does NOT call chrome.runtime.sendMessage nor deleteChatSessionWithRetry', () => {
        const uuid = 'dede0002-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('N11: tab close (keepalive: true) — calls removePendingDelete(uuid) after successful deleteChatSession', async () => {
        const uuid = 'dede0010-dead-dead-dead-deaddeaddead';
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValueOnce(true);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        // Allow the .then() microtask chain on the deleteChatSession promise to settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(global.TemporaryChatPendingStore.removePendingDelete).toHaveBeenCalledWith(uuid);
    });

    it('N12: tab close (keepalive: true) — does NOT call removePendingDelete when deleteChatSession fails', async () => {
        const uuid = 'dede0011-dead-dead-dead-deaddeaddead';
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValueOnce(false);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        await Promise.resolve();
        await Promise.resolve();

        expect(global.TemporaryChatPendingStore.removePendingDelete).not.toHaveBeenCalled();
    });

    it('N5: clears _trackedTemporaryUuid and saves null to sessionStorage', () => {
        const uuid = 'dede0003-dead-dead-dead-deaddeaddead';
        sessionStorage.setItem('dss-temporary-chat-uuid', uuid);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
        expect(sessionStorage.getItem('dss-temporary-chat-uuid')).toBeNull();
    });

    it.each([
        ['N6: is a no-op when trackedTemporaryUuid is null', { capturedAuthToken: 'Bearer tok', trackedTemporaryUuid: null }],
        ['N7: is a no-op when capturedAuthToken is null', { trackedTemporaryUuid: 'dede0004-dead-dead-dead-deaddeaddead', capturedAuthToken: null }],
    ])('%s', (_label, state) => {
        TemporaryChatDelete.__setState(state);

        TemporaryChatDelete.deleteTrackedAndClear();

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
});

// ── Group O: toggle-off with active tracked conversation ──────────────────────

describe('O — toggle-off still deletes tracked conversation', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid,
            isListening: true,
        });

        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: false } });
        TemporaryChatDelete.handleToggleChanged(evt);

        expect(TemporaryChatDelete.__getState().isListening).toBe(expectedIsListening);
    });

    it('O3: after toggle off, leaving tracked conversation still calls deleteTrackedAndClear (keepalive: true)', () => {
        const uuid = 'face0004-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            enabledFlagCache: false,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, 'Bearer tok', { keepalive: true });
    });

    it.each([
        ['O5: handleToggleChanged(true) updates _enabledFlagCache to true', false, true],
        ['O6: handleToggleChanged(false) updates _enabledFlagCache to false', true, false],
    ])('%s', (_label, initialEnabledFlagCache, toggleTo) => {
        // Arrange
        TemporaryChatDelete.__setState({ enabledFlagCache: initialEnabledFlagCache });
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(initialEnabledFlagCache);

        // Act
        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: toggleTo } });
        TemporaryChatDelete.handleToggleChanged(evt);

        // Assert
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(toggleTo);
        expect(TemporaryChatDelete.__getState().enabledFlagCache).toBe(toggleTo);
    });

    it('O4: toggle-off does NOT set _createDetected when create message arrives', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: false });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: window,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().createDetected).toBe(false);
    });
});

// ── Group P: listener lifecycle ────────────────────────────────────────────────

describe('P — listener lifecycle', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
        vi.restoreAllMocks();
    });

    it('P1: attachListeners sets isListening to true', () => {
        TemporaryChatDelete.attachListeners();
        expect(TemporaryChatDelete.__getState().isListening).toBe(true);
    });

    it('P2: attachListeners is idempotent (calling twice does not double-register)', () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.attachListeners();
        expect(TemporaryChatDelete.__getState().isListening).toBe(true);
    });

    it('P3: detachListeners sets isListening to false', () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.detachListeners();
        expect(TemporaryChatDelete.__getState().isListening).toBe(false);
    });

    it('P4: detachListeners is idempotent (calling when already detached is safe)', () => {
        expect(() => TemporaryChatDelete.detachListeners()).not.toThrow();
        expect(TemporaryChatDelete.__getState().isListening).toBe(false);
    });

    // ── Real init() behaviour ────────────────────────────────────────────────
    // Replaces the former P5/P6/P7, which re-implemented init()'s attach ordering
    // inline in the test body and therefore passed no matter what init() did.
    // These call the real init() and assert only what an outside observer can see.

    it('P5: init() seeds the enabled flag from the settings pipeline', async () => {
        settingsStore['dss-temporary-chat-enabled'] = true;
        TemporaryChatDelete.__setState({ enabledFlagCache: false });

        await TemporaryChatDelete.init();

        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('P6: after init() with the flag enabled, a real window message mutates state (listeners are live)', async () => {
        settingsStore['dss-temporary-chat-enabled'] = true;
        TemporaryChatDelete.__resetState();

        await TemporaryChatDelete.init();

        // Auth capture: dispatched on window, NOT handed to the handler directly.
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer post-init' },
            source: window,
        }));
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBe('Bearer post-init');

        // Creation detection through the same live listener.
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: window,
        }));
        expect(TemporaryChatDelete.__getState().createDetected).toBe(true);
    });

    it('P7: init() restores a tracked uuid from sessionStorage and goes live even while the flag is disabled', async () => {
        const uuid = 'eeee1111-2222-3333-4444-555555555555';
        sessionStorage.setItem('dss-temporary-chat-uuid', uuid);
        settingsStore['dss-temporary-chat-enabled'] = false;
        TemporaryChatDelete.__resetState();

        await TemporaryChatDelete.init();

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBe(uuid);
        // A tracked conversation must still be deletable, so the listeners must be live
        // even though the toggle is off: prove it through an observable state mutation.
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer tracked' },
            source: window,
        }));
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBe('Bearer tracked');

        sessionStorage.clear();
    });

    it('P8: with no tracked uuid and the flag disabled, init() leaves the listeners detached', async () => {
        sessionStorage.clear();
        settingsStore['dss-temporary-chat-enabled'] = false;
        TemporaryChatDelete.__resetState();

        await TemporaryChatDelete.init();

        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer should-be-ignored' },
            source: window,
        }));
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });
});

// ── Group R: handleNavigationEvent (same-conversation guard) ─────────────────

describe('R — handleNavigationEvent (same-conversation guard)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
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
        TemporaryChatDelete.__setState({
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
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBe(uuid);

        postMessageSpy.mockRestore();
    });

    it.each([
        ['R2: same uuid, destination differs only by query string', 'a1b2c3d4-2222-3333-4444-a1b2c3d4e5f6', '?model=v3'],
        ['R3: same uuid, destination differs only by hash fragment', 'a1b2c3d4-3333-4444-5555-a1b2c3d4e5f6', '#msg-42'],
        ['R4: same uuid, destination differs by BOTH query string and hash fragment', 'a1b2c3d4-4444-5555-6666-a1b2c3d4e5f6', '?model=v3#msg-42'],
    ])('%s → no delete, uuid stays tracked', (_label, uuid, suffix) => {
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
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
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBe(uuid);

        postMessageSpy.mockRestore();
    });

    it('R5: DIFFERENT uuid, destination has query/hash → deletion STILL fires (guard compares uuid, not full URL)', () => {
        const trackedUuid = 'a1b2c3d4-5555-6666-7777-a1b2c3d4e5f6';
        const destUuid = 'b2b2c3d4-6666-7777-8888-b2b2c3d4e5f6';
        setPathname(`/a/chat/s/${trackedUuid}`);
        TemporaryChatDelete.__setState({
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
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();

        postMessageSpy.mockRestore();
    });

    it('R6: no tracked uuid, destination has a uuid → isSameConversation false, deletion no-ops (no tracked uuid)', () => {
        const destUuid = 'c3c3d4e5-7777-8888-9999-c3c3d4e5f6a7';
        setPathname('/');
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: null,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${destUuid}?model=v3`,
            navigationType: 'push',
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it('R7: destination has NO uuid (homepage) while leaving tracked conversation → normal deletion-on-leave still fires', () => {
        const uuid = 'a1b2c3d4-6666-7777-8888-a1b2c3d4e5f6';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
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
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();

        postMessageSpy.mockRestore();
    });
});

// ── Group Q: handleHistoryNavMessage ─────────────────────────────────────────

describe('Q — handleHistoryNavMessage', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['Q1: ignores message when e.source !== window — no state side-effects', 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee', null, 'DSS_HISTORY_NAV'],
        ['Q2: ignores message when e.data.type !== DSS_HISTORY_NAV — no state side-effects', 'bbbb2222-cccc-dddd-eeee-ffffffffffff', window, 'SOME_OTHER_TYPE'],
    ])('%s', (_label, uuid, source, type) => {
        // Set up state that handleNavigationEvent would mutate if called
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        const event = new MessageEvent('message', {
            data: { type, url: `https://chat.deepseek.com/a/chat/s/${uuid}` },
            source,
        });
        TemporaryChatDelete.handleHistoryNavMessage(event);

        // isPendingCreate remains true because handleNavigationEvent was never invoked
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(true);
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it('Q3: delegates to handleNavigationEvent — verified via state: isPendingCreate chat URL marks trackedTemporaryUuid', () => {
        // handleHistoryNavMessage calls handleNavigationEvent internally (IIFE closure — spy cannot intercept).
        // Verify indirectly: set up state that handleNavigationEvent will act on, then confirm state change.
        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        const targetUrl = `https://chat.deepseek.com/a/chat/s/${uuid}`;
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        const event = new MessageEvent('message', {
            data: { type: 'DSS_HISTORY_NAV', url: targetUrl },
            source: window,
        });
        TemporaryChatDelete.handleHistoryNavMessage(event);

        // handleNavigationEvent should have run and marked the UUID
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBe(uuid);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);

        sessionStorage.clear();
    });

    it('Q4: handleWindowMessage dispatches to handleHistoryNavMessage — valid DSS_HISTORY_NAV from window causes handleNavigationEvent side-effects', () => {
        // handleWindowMessage is the unified dispatcher; it must route DSS_HISTORY_NAV to handleHistoryNavMessage,
        // which in turn calls handleNavigationEvent. Verify via state side-effects.
        const uuid = 'bbbb2222-cccc-dddd-eeee-ffffffffffff';
        const targetUrl = `https://chat.deepseek.com/a/chat/s/${uuid}`;
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        const event = new MessageEvent('message', {
            data: { type: 'DSS_HISTORY_NAV', url: targetUrl },
            source: window,
        });
        TemporaryChatDelete.handleWindowMessage(event);

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBe(uuid);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);

        sessionStorage.clear();
    });
});
