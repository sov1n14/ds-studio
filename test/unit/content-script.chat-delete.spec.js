import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';
import contentScript from '../../content/content-script.js';

// ── Helper ────────────────────────────────────────────────────────────────────
function setPathname(path) {
    window.history.replaceState({}, '', path);
}

// ── deleteChatSession guard clauses & API shape ───────────────────────────────

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
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calls deleteChatSession with keepalive when enabled and leaving site', () => {
        const token = 'Bearer leave-token';
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ capturedAuthToken: token, isEnabled: true });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('https://chat.deepseek.com/api/v0/chat_session/delete');
        expect(options.keepalive).toBe(true);
    });

    it('does NOT call fetch when isPageRefresh is true', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: 'Bearer token',
            isEnabled: true,
            isPageRefresh: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does NOT call fetch when isEnabled is false', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer token', isEnabled: false });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does NOT call fetch when capturedAuthToken is null', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ isEnabled: true });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does NOT call fetch when URL has no chat UUID', () => {
        setPathname('/');
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer token', isEnabled: true });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ── handleChatChange dispatches 'dss-chat-left' event ────────────────────────

describe('handleChatChange — dispatches dss-chat-left event', () => {
    beforeEach(async () => {
        await new Promise(r => setTimeout(r, 0));
        contentScript.__resetState();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });

        await chrome.storage.local.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId', 'syncInitialized',
        ]);
        await chrome.storage.sync.remove([
            'chatPresetMap', 'dsPresetIndex', 'activePresetId', 'syncInitialized',
        ]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('dispatches dss-chat-left with the OLD uuid when navigating away from a known chat', async () => {
        const oldUuid = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
        const newUuid = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

        contentScript.__setState({ currentChatUuid: oldUuid });
        setPathname(`/a/chat/s/${newUuid}`);

        const events = [];
        window.addEventListener('dss-chat-left', (e) => events.push(e.detail));

        await contentScript.handleChatChange();

        window.removeEventListener('dss-chat-left', events);
        expect(events.length).toBe(1);
        expect(events[0].chatUuid).toBe(oldUuid);
    });

    it('does NOT dispatch dss-chat-left on first load when currentChatUuid is null', async () => {
        const newUuid = 'cccccccc-3333-3333-3333-cccccccccccc';

        contentScript.__setState({ currentChatUuid: null });
        setPathname(`/a/chat/s/${newUuid}`);

        const events = [];
        const handler = (e) => events.push(e.detail);
        window.addEventListener('dss-chat-left', handler);

        await contentScript.handleChatChange();

        window.removeEventListener('dss-chat-left', handler);
        expect(events.length).toBe(0);
    });

    it('does NOT dispatch dss-chat-left when navigating to the same UUID', async () => {
        const sameUuid = 'dddddddd-4444-4444-4444-dddddddddddd';

        contentScript.__setState({ currentChatUuid: sameUuid });
        setPathname(`/a/chat/s/${sameUuid}`);

        const events = [];
        const handler = (e) => events.push(e.detail);
        window.addEventListener('dss-chat-left', handler);

        await contentScript.handleChatChange();

        window.removeEventListener('dss-chat-left', handler);
        expect(events.length).toBe(0);
    });
});
