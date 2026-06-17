import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// ── Group A: deleteChatSession guard clauses ──────────────────────────────────

describe('A — deleteChatSession guard clauses', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('A1: no fetch when capturedAuthToken is null', async () => {
        await TemporaryChatDelete.deleteChatSession('some-uuid');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('A2: no fetch when chatUuid is null', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession(null);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('A3: no fetch when chatUuid is empty string', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession('');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('A4: calls fetch with correct URL', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession('uuid-1234');
        const [url] = global.fetch.mock.calls[0];
        expect(url).toBe('https://chat.deepseek.com/api/v0/chat_session/delete');
    });

    it('A5: calls fetch with method POST', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession('uuid-1234');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.method).toBe('POST');
    });

    it('A6: sends authorization header', async () => {
        const token = 'Bearer header-test';
        TemporaryChatDelete.__setState({ capturedAuthToken: token });
        await TemporaryChatDelete.deleteChatSession('uuid-1234');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['authorization']).toBe(token);
    });

    it('A7: sends content-type application/json header', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession('uuid-1234');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['content-type']).toBe('application/json');
    });

    it('A8: sends body with chat_session_id', async () => {
        const uuid = 'test-uuid-abcd';
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession(uuid);
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.body).toBe(JSON.stringify({ chat_session_id: uuid }));
    });

    it('A9: keepalive defaults to false', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession('uuid-1234');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(false);
    });

    it('A10: keepalive true is passed through', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession('uuid-1234', { keepalive: true });
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(true);
    });

    it('A11: swallows network errors silently', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
        await expect(TemporaryChatDelete.deleteChatSession('uuid-1234')).resolves.toBeUndefined();
    });

    it('A12: sends x-app-version header', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession('uuid-1234');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['x-app-version']).toBe('2.0.0');
    });

    it('A13: sends x-client-platform header as web', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok' });
        await TemporaryChatDelete.deleteChatSession('uuid-1234');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['x-client-platform']).toBe('web');
    });
});

// ── Group B: sessionStorage helpers ──────────────────────────────────────────

describe('B — sessionStorage helpers', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
    });

    it('B1: readEnabledFlag returns false when sessionStorage key is absent', () => {
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('B2: readEnabledFlag returns false when sessionStorage key is "false"', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'false');
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(false);
    });

    it('B3: readEnabledFlag returns true only when sessionStorage key is "true"', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'true');
        expect(TemporaryChatDelete.readEnabledFlag()).toBe(true);
    });

    it('B4: loadTrackedUuid returns null when sessionStorage key is absent', () => {
        expect(TemporaryChatDelete.loadTrackedUuid()).toBeNull();
    });

    it('B5: saveTrackedUuid persists a uuid and loadTrackedUuid retrieves it', () => {
        TemporaryChatDelete.saveTrackedUuid('aaaa-bbbb');
        expect(TemporaryChatDelete.loadTrackedUuid()).toBe('aaaa-bbbb');
    });

    it('B6: saveTrackedUuid with null removes the key', () => {
        TemporaryChatDelete.saveTrackedUuid('some-uuid');
        TemporaryChatDelete.saveTrackedUuid(null);
        expect(TemporaryChatDelete.loadTrackedUuid()).toBeNull();
    });
});

// ── Group C: extractUuidFromUrl ───────────────────────────────────────────────

describe('C — extractUuidFromUrl', () => {
    it('C1: extracts uuid from /a/chat/s/<uuid> path (hex chars only)', () => {
        expect(TemporaryChatDelete.extractUuidFromUrl('/a/chat/s/aaaa1111-bbbb-cccc-dddd-eeeeeeee0000')).toBe('aaaa1111-bbbb-cccc-dddd-eeeeeeee0000');
    });

    it('C2: returns null for homepage path', () => {
        expect(TemporaryChatDelete.extractUuidFromUrl('/')).toBeNull();
    });

    it('C3: returns null for unrecognised path', () => {
        expect(TemporaryChatDelete.extractUuidFromUrl('/a/other/path')).toBeNull();
    });

    it('C4: uses window.location.pathname when no argument given (via setPathname)', () => {
        const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
        window.history.replaceState({}, '', `/a/chat/s/${uuid}`);
        expect(TemporaryChatDelete.extractUuidFromUrl()).toBe(uuid);
        window.history.replaceState({}, '', '/');
    });
});

// ── Group D: handleAuthMessage ────────────────────────────────────────────────

describe('D — handleAuthMessage', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('D1: captures token from DSS_AUTH_CAPTURED message', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer abc' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBe('Bearer abc');
    });

    it('D2: ignores messages not from window (source !== window)', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer foreign' },
            source: null,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });

    it('D3: ignores messages with wrong type', () => {
        const event = new MessageEvent('message', {
            data: { type: 'SOME_OTHER_TYPE', authorization: 'Bearer wrong' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });

    it('D4: captures token regardless of toggle state (token always saved)', () => {
        // Token capture is unconditional — toggle off should not block it
        sessionStorage.setItem('dss-temporary-chat-enabled', 'false');
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer unconditional' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBe('Bearer unconditional');
        sessionStorage.clear();
    });
});

// ── Group E: handleCreateMessage — creation detection → pending flag ──────────

describe('E — handleCreateMessage (creation detection)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
    });

    it('E1: sets isPendingCreate when toggle is ON', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'true');
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: window,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(true);
    });

    it('E2: does NOT set isPendingCreate when toggle is OFF', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'false');
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: window,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);
    });

    it('E3: ignores messages not from window', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'true');
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: null,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);
    });

    it('E4: ignores messages with wrong type', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'true');
        const event = new MessageEvent('message', {
            data: { type: 'WRONG_TYPE' },
            source: window,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);
    });
});

// ── Group F: handleNavigationEvent — marking new temporary conversations ──────

describe('F — handleNavigationEvent (marking)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
        setPathname('/');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('F1: marks trackedTemporaryUuid when isPendingCreate is true and destination is a chat URL', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'true');
        TemporaryChatDelete.__setState({ isPendingCreate: true });

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBe(uuid);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);
    });

    it('F2: persists trackedTemporaryUuid to sessionStorage after marking', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'true');
        TemporaryChatDelete.__setState({ isPendingCreate: true });

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(sessionStorage.getItem('dss-temporary-chat-uuid')).toBe(uuid);
    });

    it('F3: does NOT mark when isPendingCreate is false (historical conversation)', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'true');
        // isPendingCreate remains false (default)

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it('F4: does NOT mark when toggle is OFF at navigate time (even with pending flag)', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'false');
        TemporaryChatDelete.__setState({ isPendingCreate: true });

        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: `https://chat.deepseek.com/a/chat/s/${uuid}`,
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it('F5: does NOT mark when destination URL has no chat UUID', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'true');
        TemporaryChatDelete.__setState({ isPendingCreate: true });

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/',
            navigationType: 'push',
        }));

        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
        // isPendingCreate not cleared when destination has no UUID
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(true);
    });
});

// ── Group G: handleNavigationEvent — deletion on leave ───────────────────────

describe('G — handleNavigationEvent (deletion on leave)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('G1: deletes tracked uuid when leaving to a different URL', () => {
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

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.body).toBe(JSON.stringify({ chat_session_id: uuid }));
        expect(opts.keepalive).toBe(true);
    });

    it('G2: clears trackedTemporaryUuid after deletion', () => {
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

    it('G3: does NOT delete when leaving a NON-tracked conversation', () => {
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

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('G4: does NOT delete when no tracked uuid', () => {
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

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('G5: does NOT delete when no auth token', () => {
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

        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ── Group H: same-URL and reload suppression ──────────────────────────────────

describe('H — same-URL / reload must NOT delete', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('H1: navigationType reload → no deletion, suppressNextUnloadDelete set', () => {
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

        expect(global.fetch).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.__getState().suppressNextUnloadDelete).toBe(true);
    });

    it('H2: same destination URL as current href → no deletion, suppressNextUnloadDelete set', () => {
        const uuid = 'a1b2c3d4-2222-2222-2222-aabbccddee00';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        // destination === window.location.href
        const currentHref = window.location.href;
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: currentHref,
            navigationType: 'push',
        }));

        expect(global.fetch).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.__getState().suppressNextUnloadDelete).toBe(true);
    });

    it('H3: tracked uuid persists after reload navigation (not cleared)', () => {
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

    it('H4: isKeyboardRefresh true at navigate time → no deletion, suppress set', () => {
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

        expect(global.fetch).not.toHaveBeenCalled();
        expect(TemporaryChatDelete.__getState().suppressNextUnloadDelete).toBe(true);
    });

    it('H5: isKeyboardRefresh is reset to false after handleNavigationEvent', () => {
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

// ── Group I: handleRefreshKeydown ─────────────────────────────────────────────

describe('I — handleRefreshKeydown', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('I1: F5 sets isKeyboardRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'F5', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('I2: Ctrl+R sets isKeyboardRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('I3: Ctrl+R (uppercase) sets isKeyboardRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'R', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('I4: Cmd+R sets isKeyboardRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: false, metaKey: true });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('I5: arbitrary key (Enter) does NOT set isKeyboardRefresh', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'Enter', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(false);
    });

    it('I6: Ctrl+S does NOT set isKeyboardRefresh', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 's', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(false);
    });
});

// ── Group J: handleBeforeUnload (tab close) ───────────────────────────────────

describe('J — handleBeforeUnload (tab close)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('J1: deletes tracked conversation with keepalive=true on tab close', () => {
        const uuid = 'face0000-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(true);
    });

    it('J2: does NOT delete when suppressNextUnloadDelete is true', () => {
        const uuid = 'face0001-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('J3: does NOT delete when isKeyboardRefresh is true', () => {
        const uuid = 'face0002-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('J4: does NOT delete when current URL uuid !== tracked uuid', () => {
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

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('J5: does NOT delete when URL has no chat uuid', () => {
        setPathname('/');
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: 'face0006-f00d-dead-beef-0123456789ab',
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('J6: does NOT delete when no auth token', () => {
        const uuid = 'face0003-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: null,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ── Group K: toggle-off with active tracked conversation ─────────────────────

describe('K — toggle-off still deletes tracked conversation', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('K1: handleToggleChanged(false) with a tracked uuid keeps listeners attached (_isListening true)', () => {
        const uuid = 'face0005-f00d-dead-beef-0123456789ab';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            isListening: true,
        });

        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: false } });
        TemporaryChatDelete.handleToggleChanged(evt);

        // Listeners stay attached because there is still a tracked uuid to delete
        expect(TemporaryChatDelete.__getState().isListening).toBe(true);
    });

    it('K2: handleToggleChanged(false) without tracked uuid detaches listeners', () => {
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: null,
            isListening: true,
        });

        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: false } });
        TemporaryChatDelete.handleToggleChanged(evt);

        expect(TemporaryChatDelete.__getState().isListening).toBe(false);
    });

    it('K3: after toggle off, leaving tracked conversation still calls deleteChatSession', () => {
        const uuid = 'face0004-f00d-dead-beef-0123456789ab';
        setPathname(`/a/chat/s/${uuid}`);
        sessionStorage.setItem('dss-temporary-chat-enabled', 'false');
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        // Simulate tab close on a tracked conversation even though toggle is off
        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.body).toBe(JSON.stringify({ chat_session_id: uuid }));
    });

    it('K4: toggle-off does NOT set isPendingCreate when create message arrives', () => {
        sessionStorage.setItem('dss-temporary-chat-enabled', 'false');
        const event = new MessageEvent('message', {
            data: { type: 'DSS_CHAT_CREATE_DETECTED' },
            source: window,
        });
        TemporaryChatDelete.handleCreateMessage(event);
        expect(TemporaryChatDelete.__getState().isPendingCreate).toBe(false);
    });
});

// ── Group L: listener lifecycle (attachListeners / detachListeners) ───────────

describe('L — listener lifecycle', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        // Ensure listeners are detached after each test
        TemporaryChatDelete.detachListeners();
        vi.restoreAllMocks();
    });

    it('L1: attachListeners sets isListening to true', () => {
        TemporaryChatDelete.attachListeners();
        expect(TemporaryChatDelete.__getState().isListening).toBe(true);
    });

    it('L2: attachListeners is idempotent (calling twice does not double-register)', () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.attachListeners();
        expect(TemporaryChatDelete.__getState().isListening).toBe(true);
    });

    it('L3: detachListeners sets isListening to false', () => {
        TemporaryChatDelete.attachListeners();
        TemporaryChatDelete.detachListeners();
        expect(TemporaryChatDelete.__getState().isListening).toBe(false);
    });

    it('L4: detachListeners is idempotent (calling when already detached is safe)', () => {
        expect(() => TemporaryChatDelete.detachListeners()).not.toThrow();
        expect(TemporaryChatDelete.__getState().isListening).toBe(false);
    });
});

// ── Group M: deleteTrackedAndClear ────────────────────────────────────────────

describe('M — deleteTrackedAndClear', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
    });

    it('M1: calls fetch and clears trackedTemporaryUuid', () => {
        const uuid = 'dede0001-dead-dead-dead-deaddeaddead';
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(TemporaryChatDelete.__getState().trackedTemporaryUuid).toBeNull();
    });

    it('M2: removes tracked uuid from sessionStorage', () => {
        const uuid = 'dede0002-dead-dead-dead-deaddeaddead';
        sessionStorage.setItem('dss-temporary-chat-uuid', uuid);
        TemporaryChatDelete.__setState({
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear();

        expect(sessionStorage.getItem('dss-temporary-chat-uuid')).toBeNull();
    });

    it('M3: is a no-op when trackedTemporaryUuid is null', () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok', trackedTemporaryUuid: null });

        TemporaryChatDelete.deleteTrackedAndClear();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('M4: is a no-op when capturedAuthToken is null', () => {
        TemporaryChatDelete.__setState({ trackedTemporaryUuid: 'dede0003-dead-dead-dead-deaddeaddead', capturedAuthToken: null });

        TemporaryChatDelete.deleteTrackedAndClear();

        expect(global.fetch).not.toHaveBeenCalled();
    });
});
