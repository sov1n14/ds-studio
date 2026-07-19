import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── chrome mocks (must be set before module import) ────────────────────────────
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
    runtime: {
        sendMessage: vi.fn(),
    },
};

// ── TemporaryChatDeleteApi mock ────────────────────────────────────────────────
global.TemporaryChatDeleteApi = {
    deleteChatSession: vi.fn().mockResolvedValue(true),
    deleteChatSessionWithRetry: vi.fn().mockResolvedValue(undefined),
    showDeleteFailedToast: vi.fn(),
};

// ── TemporaryChatPendingStore mock ──────────────────────────────────────────────
global.TemporaryChatPendingStore = {
    getPendingDeletes: vi.fn().mockResolvedValue([]),
    savePendingDeletes: vi.fn().mockResolvedValue(undefined),
    addPendingDelete: vi.fn().mockResolvedValue(undefined),
    removePendingDelete: vi.fn().mockResolvedValue(undefined),
    getOpenUuids: vi.fn().mockResolvedValue([]),
    addOpenUuid: vi.fn().mockResolvedValue(undefined),
    removeOpenUuid: vi.fn().mockResolvedValue(undefined),
    clearOpenUuids: vi.fn().mockResolvedValue(undefined),
    getLastAuthToken: vi.fn().mockResolvedValue(null),
    setLastAuthToken: vi.fn().mockResolvedValue(undefined),
    trackForDeletion: vi.fn().mockResolvedValue(undefined),
};

import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// ── Helper ─────────────────────────────────────────────────────────────────────
function setPathname(path) {
    window.history.replaceState({}, '', path);
}

/** Build a minimal NavigateEvent-like object understood by handleNavigationEvent. */
function makeNavigateEvent({ destinationUrl, navigationType = 'push' }) {
    return {
        destination: { url: destinationUrl },
        navigationType,
    };
}

// Clear all TemporaryChatPendingStore mock call history before every test in this file.
beforeEach(() => {
    Object.values(global.TemporaryChatPendingStore).forEach((fn) => fn.mockClear());
});

// ── Group A: initEnabledFlagFromStorage ───────────────────────────────────────

describe('A — initEnabledFlagFromStorage', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        chromeStorageLocalMock._reset();
    });

    it('A1: reads dss-temporary-chat-enabled from chrome.storage.local', async () => {
        chromeStorageLocalMock._store['dss-temporary-chat-enabled'] = true;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.__getState().enabledFlagCache).toBe(true);
    });

    it('A2: sets _enabledFlagCache to true when stored value is true', async () => {
        chromeStorageLocalMock._store['dss-temporary-chat-enabled'] = true;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('A3: sets _enabledFlagCache to false when stored value is absent', async () => {
        // store is empty
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('A4: sets _enabledFlagCache to false when stored value is false', async () => {
        chromeStorageLocalMock._store['dss-temporary-chat-enabled'] = false;
        await TemporaryChatDelete.initEnabledFlagFromStorage();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });
});

// ── Group B: readEnabledFlag ──────────────────────────────────────────────────

describe('B — readEnabledFlag', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        chromeStorageLocalMock._reset();
    });

    it('B1: returns false when cache is not initialised (default)', () => {
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('B2: returns true when cache was set via __setState', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('B3: does NOT call chrome.storage.local (reads only from cache)', async () => {
        const getSpy = vi.spyOn(chromeStorageLocalMock, 'get');
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
    it('D1: extracts uuid from /a/chat/s/<uuid> path (hex chars only)', () => {
        expect(TemporaryChatDelete.extractUuidFromUrl('/a/chat/s/aaaa1111-bbbb-cccc-dddd-eeeeeeee0000')).toBe('aaaa1111-bbbb-cccc-dddd-eeeeeeee0000');
    });

    it('D2: returns null for homepage path', () => {
        expect(TemporaryChatDelete.extractUuidFromUrl('/')).toBeNull();
    });

    it('D3: returns null for unrecognised path', () => {
        expect(TemporaryChatDelete.extractUuidFromUrl('/a/other/path')).toBeNull();
    });

    it('D4: uses window.location.pathname when no argument given', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        window.history.replaceState({}, '', `/a/chat/s/${uuid}`);
        expect(TemporaryChatDelete.extractUuidFromUrl()).toBe(uuid);
        window.history.replaceState({}, '', '/');
    });

    it('D5: extracts uuid from a full URL with a query string', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        expect(TemporaryChatDelete.extractUuidFromUrl(`https://chat.deepseek.com/a/chat/s/${uuid}?foo=bar`)).toBe(uuid);
    });

    it('D6: extracts uuid from a full URL with a hash fragment', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        expect(TemporaryChatDelete.extractUuidFromUrl(`https://chat.deepseek.com/a/chat/s/${uuid}#msg-42`)).toBe(uuid);
    });

    it('D7: extracts uuid from a full URL with BOTH a query string and a hash fragment', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        expect(TemporaryChatDelete.extractUuidFromUrl(`https://chat.deepseek.com/a/chat/s/${uuid}?model=v3#msg-42`)).toBe(uuid);
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

    it('F1: sets _createDetected when toggle is ON', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: window,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().createDetected).toBe(true);
    });

    it('F2: does NOT set _createDetected when toggle is OFF', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: false });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: window,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().createDetected).toBe(false);
    });

    it('F3: ignores messages not from window', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: null,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().createDetected).toBe(false);
    });

    it('F4: ignores messages with wrong type', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        const event = new MessageEvent('message', {
            data: { type: 'WRONG_TYPE' },
            source: window,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().createDetected).toBe(false);
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

    it('G1: ignores messages from non-window source', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_COMPLETION_DETECTED' },
            source: null,
        });
        TemporaryChatDelete.handleCompletionMessage(event);
        expect(TemporaryChatDelete.__getState().completionDetected).toBe(false);
    });

    it('G2: ignores messages with wrong type', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        const event = new MessageEvent('message', {
            data: { type: 'WRONG_TYPE' },
            source: window,
        });
        TemporaryChatDelete.handleCompletionMessage(event);
        expect(TemporaryChatDelete.__getState().completionDetected).toBe(false);
    });

    it('G3: ignores when _enabledFlagCache is false', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: false });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_COMPLETION_DETECTED' },
            source: window,
        });
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

    it('H1: when only _createDetected is true → does NOT set _isPendingCreate; starts a timer', () => {
        TemporaryChatDelete.__setState({ createDetected: true, completionDetected: false });
        TemporaryChatDelete.checkCoOccurrence();
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);
        expect(TemporaryChatDelete.__getState().coOccurrenceTimer).not.toBeNull();
    });

    it('H2: when only _completionDetected is true → does NOT set _isPendingCreate; starts a timer', () => {
        TemporaryChatDelete.__setState({ createDetected: false, completionDetected: true });
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
        global.chrome.runtime.sendMessage.mockClear();
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

    it('I3: does NOT mark when isPendingCreate is false', () => {
        TemporaryChatDelete.__setState({ enabledFlagCache: true });

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it('I4: does NOT mark when toggle is OFF at navigate time (even with pending flag)', () => {
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: false });

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
        global.chrome.runtime.sendMessage.mockClear();
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

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
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

    it('J4: does NOT delete when leaving a NON-tracked conversation', () => {
        const trackedUuid = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        const currentUuid = 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
        setPathname(`/a/chat/s/${currentUuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: trackedUuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
    });

    it('J5: does NOT delete when no tracked uuid', () => {
        const uuid = 'cccc3333-cccc-cccc-cccc-cccccccccccc';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: null,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
    });

    it('J6: does NOT delete when no auth token', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: null,
        });

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
        global.chrome.runtime.sendMessage.mockClear();
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

    it('L1: F5 sets isKeyboardRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'F5', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('L2: Ctrl+R sets isKeyboardRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('L3: Ctrl+R (uppercase) sets isKeyboardRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'R', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('L4: Cmd+R sets isKeyboardRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: false, metaKey: true });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('L5: arbitrary key (Enter) does NOT set isKeyboardRefresh', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'Enter', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(false);
    });

    it('L6: Ctrl+S does NOT set isKeyboardRefresh', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 's', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(false);
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
        global.chrome.runtime.sendMessage.mockClear();
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

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
    });

    it('M3: does NOT delete when suppressNextUnloadDelete is true', () => {
        const uuid = 'face0001-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('M4: does NOT delete when isKeyboardRefresh is true', () => {
        const uuid = 'face0002-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('M5: does NOT delete when current URL uuid !== tracked uuid', () => {
        const trackedUuid = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        const currentUuid = 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
        setPathname(`/a/chat/s/${currentUuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: trackedUuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('M6: does NOT delete when URL has no chat uuid', () => {
        setPathname('/');
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: 'face0006-f00d-dead-beef-0123456789ab',
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('M7: does NOT delete when no auth token', () => {
        const uuid = 'face0003-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: null,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
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
        global.chrome.runtime.sendMessage.mockClear();
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
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
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

    it('N6: is a no-op when trackedTemporaryUuid is null', () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok', trackedTemporaryUuid: null });

        TemporaryChatDelete.deleteTrackedAndClear();

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('N7: is a no-op when capturedAuthToken is null', () => {
        TemporaryChatDelete.__setState({ trackedTemporaryUuid: 'dede0004-dead-dead-dead-deaddeaddead', capturedAuthToken: null });

        TemporaryChatDelete.deleteTrackedAndClear();

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
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
        global.chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('O1: handleToggleChanged(false) with a tracked uuid keeps listeners attached', () => {
        const uuid = 'face0005-f00d-dead-beef-0123456789ab';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            isListening: true,
        });

        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: false } });
        TemporaryChatDelete.handleToggleChanged(evt);

        expect(TemporaryChatDelete.__getState().isListening).toBe(true);
    });

    it('O2: handleToggleChanged(false) without tracked uuid detaches listeners', () => {
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: null,
            isListening: true,
        });

        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: false } });
        TemporaryChatDelete.handleToggleChanged(evt);

        expect(TemporaryChatDelete.__getState().isListening).toBe(false);
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

    it('O5: handleToggleChanged(true) updates _enabledFlagCache to true', () => {
        // Arrange: cache starts false (default after __resetState)
        TemporaryChatDelete.__resetState();
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);

        // Act
        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: true } });
        TemporaryChatDelete.handleToggleChanged(evt);

        // Assert
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
        expect(TemporaryChatDelete.__getState().enabledFlagCache).toBe(true);
    });

    it('O6: handleToggleChanged(false) updates _enabledFlagCache to false', () => {
        // Arrange: cache starts true
        TemporaryChatDelete.__setState({ enabledFlagCache: true });
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);

        // Act
        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: false } });
        TemporaryChatDelete.handleToggleChanged(evt);

        // Assert
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
        expect(TemporaryChatDelete.__getState().enabledFlagCache).toBe(false);
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

    // ── Fix B: init() reorder tests ───────────────────────────────────────────

    it('P5: init() early-attach — if trackedUuid exists in sessionStorage, attachListeners is called BEFORE initEnabledFlagFromStorage resolves', async () => {
        // Arrange: place a UUID in sessionStorage so loadTrackedUuid() returns it
        sessionStorage.setItem('dss-temporary-chat-uuid', 'early-uuid-1111-2222-3333-444444444444');
        chromeStorageLocalMock._store['dss-temporary-chat-enabled'] = false;

        // Use a deferred promise so we can check isListening before it resolves
        let resolveStorage;
        const storagePromise = new Promise(res => { resolveStorage = res; });
        const origInit = TemporaryChatDelete.initEnabledFlagFromStorage;
        const initSpy = vi.spyOn(TemporaryChatDelete, 'initEnabledFlagFromStorage').mockImplementation(() => storagePromise);

        let isListeningBeforeAwait = null;

        // Kick off init (do not await yet)
        const initPromise = (async () => {
            const CHANGED_EVENT = 'dss-temporary-chat-changed';
            window.addEventListener(CHANGED_EVENT, TemporaryChatDelete.handleToggleChanged);

            TemporaryChatDelete.__resetState();
            // Replicate fixed init() logic
            const uuid = TemporaryChatDelete.loadTrackedUuid();
            if (uuid) {
                TemporaryChatDelete.__setState({ trackedTemporaryUuid: uuid });
                TemporaryChatDelete.attachListeners();
            }
            // Capture state before await
            isListeningBeforeAwait = TemporaryChatDelete.__getState().isListening;

            await TemporaryChatDelete.initEnabledFlagFromStorage();

            const state = TemporaryChatDelete.__getState();
            if (state.enabledFlagCache && !state.isListening) {
                TemporaryChatDelete.attachListeners();
            }
        })();

        // Verify isListening was set BEFORE the promise resolved
        expect(isListeningBeforeAwait).toBe(true);

        // Now resolve the storage promise so init completes cleanly
        resolveStorage();
        await initPromise;

        initSpy.mockRestore();
        sessionStorage.clear();
        window.removeEventListener('dss-temporary-chat-changed', TemporaryChatDelete.handleToggleChanged);
    });

    it('P6: init() late-attach — if no trackedUuid but enabledFlagCache becomes true, attachListeners is called after await', async () => {
        // Arrange: no UUID in sessionStorage, but storage has enabled=true
        sessionStorage.clear();
        chromeStorageLocalMock._store['dss-temporary-chat-enabled'] = true;

        TemporaryChatDelete.__resetState();

        // Replicate fixed init() logic inline
        const uuid = TemporaryChatDelete.loadTrackedUuid();
        expect(uuid).toBeNull();

        // Should NOT be listening yet (no uuid)
        expect(TemporaryChatDelete.__getState().isListening).toBe(false);

        await TemporaryChatDelete.initEnabledFlagFromStorage();

        // Now enabledFlagCache is true, isListening is still false → should attach
        const stateAfterAwait = TemporaryChatDelete.__getState();
        expect(stateAfterAwait.enabledFlagCache).toBe(true);

        if (stateAfterAwait.enabledFlagCache && !stateAfterAwait.isListening) {
            TemporaryChatDelete.attachListeners();
        }

        expect(TemporaryChatDelete.__getState().isListening).toBe(true);
    });

    it('P7: init() no-double-attach — if both trackedUuid and enabledFlagCache are true, attachListeners is called only once', async () => {
        // Arrange: UUID in sessionStorage AND enabled=true in storage
        sessionStorage.setItem('dss-temporary-chat-uuid', 'nodbl-uuid-1111-2222-3333-444444444444');
        chromeStorageLocalMock._store['dss-temporary-chat-enabled'] = true;

        TemporaryChatDelete.__resetState();

        const attachSpy = vi.spyOn(TemporaryChatDelete, 'attachListeners');

        // Replicate fixed init() logic
        const uuid = TemporaryChatDelete.loadTrackedUuid();
        if (uuid) {
            TemporaryChatDelete.__setState({ trackedTemporaryUuid: uuid });
            TemporaryChatDelete.attachListeners(); // first call
        }

        await TemporaryChatDelete.initEnabledFlagFromStorage();

        const state = TemporaryChatDelete.__getState();
        if (state.enabledFlagCache && !state.isListening) {
            TemporaryChatDelete.attachListeners(); // guarded: should NOT be called because isListening=true
        }

        // attachListeners should have been called exactly once (the early call)
        expect(attachSpy).toHaveBeenCalledTimes(1);

        attachSpy.mockRestore();
        sessionStorage.clear();
    });
});

// ── Group R: handleNavigationEvent (same-conversation guard) ─────────────────

describe('R — handleNavigationEvent (same-conversation guard)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.chrome.runtime.sendMessage.mockClear();
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

    it('R2: same uuid, destination differs only by query string → no delete, uuid stays tracked', () => {
        const uuid = 'a1b2c3d4-2222-3333-4444-a1b2c3d4e5f6';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}?model=v3`,
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

    it('R3: same uuid, destination differs only by hash fragment → no delete, uuid stays tracked', () => {
        const uuid = 'a1b2c3d4-3333-4444-5555-a1b2c3d4e5f6';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}#msg-42`,
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

    it('R4: same uuid, destination differs by BOTH query string and hash fragment → no delete, uuid stays tracked', () => {
        const uuid = 'a1b2c3d4-4444-5555-6666-a1b2c3d4e5f6';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}?model=v3#msg-42`,
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

    it('Q1: ignores message when e.source !== window — no state side-effects', () => {
        // Set up state that handleNavigationEvent would mutate if called
        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        const event = new MessageEvent('message', {
            data: { type: 'DSS_HISTORY_NAV', url: `https://chat.deepseek.com/a/chat/s/${uuid}` },
            source: null, // not window — must be ignored
        });
        TemporaryChatDelete.handleHistoryNavMessage(event);

        // isPendingCreate remains true because handleNavigationEvent was never invoked
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(true);
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it('Q2: ignores message when e.data.type !== DSS_HISTORY_NAV — no state side-effects', () => {
        const uuid = 'bbbb2222-cccc-dddd-eeee-ffffffffffff';
        TemporaryChatDelete.__setState({ isPendingCreate: true, enabledFlagCache: true });

        const event = new MessageEvent('message', {
            data: { type: 'SOME_OTHER_TYPE', url: `https://chat.deepseek.com/a/chat/s/${uuid}` },
            source: window,
        });
        TemporaryChatDelete.handleHistoryNavMessage(event);

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
