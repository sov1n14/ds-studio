import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// ── Helper ────────────────────────────────────────────────────────────────────
function setPathname(path) {
    window.history.replaceState({}, '', path);
}

// ── deleteChatSession guard clauses & API shape ───────────────────────────────
// These tests verify the delete API contract (POST shape, headers, guard clauses).
// The dss-chat-left dispatch was REMOVED from content-script.js in this version.
// Tests that relied on that dispatch are removed here to reflect current behavior.

describe('deleteChatSession', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns early without calling fetch when capturedAuthToken is null', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: null });
        await TemporaryChatDelete.deleteChatSession('some-uuid');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns early without calling fetch when chatUuid is null', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer token123' });
        await TemporaryChatDelete.deleteChatSession(null);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns early without calling fetch when chatUuid is an empty string', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer token123' });
        await TemporaryChatDelete.deleteChatSession('');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('calls fetch with correct URL, method, headers, and body when token and uuid are present', async () => {
        const token = 'Bearer test-auth-token';
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.__setState({ capturedAuthToken: token });

        await TemporaryChatDelete.deleteChatSession(uuid);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('https://chat.deepseek.com/api/v0/chat_session/delete');
        expect(options.method).toBe('POST');
        expect(options.headers['authorization']).toBe(token);
        expect(options.headers['content-type']).toBe('application/json');
        expect(options.body).toBe(JSON.stringify({ chat_session_id: uuid }));
    });

    it('passes keepalive: true when requested', async () => {
        const token = 'Bearer keepalive-token';
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.__setState({ capturedAuthToken: token });

        await TemporaryChatDelete.deleteChatSession(uuid, { keepalive: true });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, options] = global.fetch.mock.calls[0];
        expect(options.keepalive).toBe(true);
    });

    it('passes keepalive: false by default', async () => {
        const token = 'Bearer default-token';
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        TemporaryChatDelete.__setState({ capturedAuthToken: token });

        await TemporaryChatDelete.deleteChatSession(uuid);

        const [, options] = global.fetch.mock.calls[0];
        expect(options.keepalive).toBe(false);
    });

    it('swallows fetch errors silently without throwing', async () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer token123' });
        global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

        await expect(TemporaryChatDelete.deleteChatSession('some-uuid')).resolves.toBeUndefined();
    });
});

// ── beforeunload handler ──────────────────────────────────────────────────────

describe('beforeunload handler (TemporaryChatDelete)', () => {
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

    it('calls deleteChatSession with keepalive when conditions are met (tracked uuid, token, on chat page)', () => {
        const token = 'Bearer leave-token';
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: token,
            trackedTemporaryUuid: uuid,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('https://chat.deepseek.com/api/v0/chat_session/delete');
        expect(options.keepalive).toBe(true);
    });

    it('does NOT call fetch when suppressNextUnloadDelete is true', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: 'Bearer token',
            trackedTemporaryUuid: uuid,
            suppressNextUnloadDelete: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does NOT call fetch when isKeyboardRefresh is true', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: 'Bearer token',
            trackedTemporaryUuid: uuid,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does NOT call fetch when capturedAuthToken is null', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: null,
            trackedTemporaryUuid: uuid,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does NOT call fetch when URL has no chat UUID', () => {
        setPathname('/');
        TemporaryChatDelete.__setState({
            capturedAuthToken: 'Bearer token',
            trackedTemporaryUuid: 'face0007-f00d-dead-beef-0123456789ab',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does NOT call fetch when current URL uuid does not match trackedTemporaryUuid', () => {
        const trackedUuid = 'tracked-aaaa';
        const currentUuid = 'current-bbbb';
        setPathname(`/a/chat/s/${currentUuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: 'Bearer token',
            trackedTemporaryUuid: trackedUuid,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });
});
