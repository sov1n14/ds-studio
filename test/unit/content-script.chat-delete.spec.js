import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

const s = () => contentScript.__getState();

describe('deleteChatSession', () => {
    beforeEach(() => {
        contentScript.__resetState();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns early without calling fetch when capturedAuthToken is null', async () => {
        contentScript.__setState({ capturedAuthToken: null });
        await contentScript.deleteChatSession('some-uuid');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns early without calling fetch when chatUuid is null', async () => {
        contentScript.__setState({ capturedAuthToken: 'Bearer token123' });
        await contentScript.deleteChatSession(null);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns early without calling fetch when chatUuid is an empty string', async () => {
        contentScript.__setState({ capturedAuthToken: 'Bearer token123' });
        await contentScript.deleteChatSession('');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('calls fetch with correct URL, method, headers, and body when token and uuid are present', async () => {
        const token = 'Bearer test-auth-token';
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        contentScript.__setState({ capturedAuthToken: token });

        await contentScript.deleteChatSession(uuid);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('https://chat.deepseek.com/api/v0/chat_session/delete');
        expect(options.method).toBe('POST');
        expect(options.headers['authorization']).toBe(token);
        expect(options.headers['content-type']).toBe('application/json');
        expect(options.body).toBe(JSON.stringify({ chat_session_id: uuid }));
    });

    it('swallows fetch errors silently without throwing', async () => {
        contentScript.__setState({ capturedAuthToken: 'Bearer token123' });
        global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

        await expect(contentScript.deleteChatSession('some-uuid')).resolves.toBeUndefined();
    });
});

describe('handleChatChange — deleteChatSession integration', () => {
    function setPathname(path) {
        window.history.replaceState({}, '', path);
    }

    beforeEach(async () => {
        await new Promise(r => setTimeout(r, 0));
        contentScript.__resetState();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });

        // Clear storage keys used by handleChatChange
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

    it('calls deleteChatSession with the OLD uuid when navigating away from a known chat', async () => {
        const oldUuid = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
        const newUuid = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';
        const token = 'Bearer nav-token';

        contentScript.__setState({ currentChatUuid: oldUuid, capturedAuthToken: token });
        setPathname(`/a/chat/s/${newUuid}`);

        await contentScript.handleChatChange();

        // fetch should have been called for the delete of oldUuid
        expect(global.fetch).toHaveBeenCalledWith(
            'https://chat.deepseek.com/api/v0/chat_session/delete',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ chat_session_id: oldUuid }),
            })
        );
    });

    it('does NOT call deleteChatSession on first load when currentChatUuid is null', async () => {
        const newUuid = 'cccccccc-3333-3333-3333-cccccccccccc';

        contentScript.__setState({ currentChatUuid: null, capturedAuthToken: 'Bearer token' });
        setPathname(`/a/chat/s/${newUuid}`);

        await contentScript.handleChatChange();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does NOT call deleteChatSession when navigating to the same UUID (URL unchanged)', async () => {
        const sameUuid = 'dddddddd-4444-4444-4444-dddddddddddd';

        contentScript.__setState({ currentChatUuid: sameUuid, capturedAuthToken: 'Bearer token' });
        setPathname(`/a/chat/s/${sameUuid}`);

        await contentScript.handleChatChange();

        expect(global.fetch).not.toHaveBeenCalled();
    });
});
