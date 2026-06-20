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
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
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

    it('H3: when both are true → sets _isPendingCreate = true, clears both flags', () => {
        TemporaryChatDelete.__setState({ createDetected: true, completionDetected: true });
        TemporaryChatDelete.checkCoOccurrence();
        const state = TemporaryChatDelete.__getState();
        expect(state.isPendingCreate).toBe(true);
        expect(state.createDetected).toBe(false);
        expect(state.completionDetected).toBe(false);
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

    it('J1: calls TemporaryChatDeleteApi.deleteChatSessionWithRetry (keepalive: false) when leaving tracked conversation', () => {
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

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).toHaveBeenCalledWith(uuid, 'Bearer tok');
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

    it('K2: same destination URL as current href → no deletion, suppressNextUnloadDelete set', () => {
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
        expect(TemporaryChatDelete.__getState().suppressNextUnloadDelete).toBe(true);
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
        global.chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('M1: calls chrome.runtime.sendMessage with DSS_DELETE_TEMP_CHAT on tab close', () => {
        const uuid = 'face0000-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const msg = global.chrome.runtime.sendMessage.mock.calls[0][0];
        expect(msg.type).toBe('DSS_DELETE_TEMP_CHAT');
        expect(msg.chatUuid).toBe(uuid);
        expect(msg.authToken).toBe('Bearer tok');
    });

    it('M2: does NOT call TemporaryChatDeleteApi.deleteChatSessionWithRetry (keepalive path)', () => {
        const uuid = 'face0000-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

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
    });
});

// ── Group N: deleteTrackedAndClear ─────────────────────────────────────────────

describe('N — deleteTrackedAndClear', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.chrome.runtime.sendMessage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
    });

    it('N1: navigation (keepalive: false) — calls TemporaryChatDeleteApi.deleteChatSessionWithRetry with uuid and token', () => {
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).toHaveBeenCalledWith(uuid, 'Bearer tok');
    });

    it('N2: navigation (keepalive: false) — does NOT call chrome.runtime.sendMessage', () => {
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('N3: tab close (keepalive: true) — calls chrome.runtime.sendMessage with correct payload', () => {
        const uuid = 'dede0002-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const msg = global.chrome.runtime.sendMessage.mock.calls[0][0];
        expect(msg.type).toBe('DSS_DELETE_TEMP_CHAT');
        expect(msg.chatUuid).toBe(uuid);
        expect(msg.authToken).toBe('Bearer close');
    });

    it('N4: tab close (keepalive: true) — does NOT call TemporaryChatDeleteApi.deleteChatSessionWithRetry', () => {
        const uuid = 'dede0002-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer close',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: true });

        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
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

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const msg = global.chrome.runtime.sendMessage.mock.calls[0][0];
        expect(msg.chatUuid).toBe(uuid);
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
});
