import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Importing deepseek-api.js publishes globalThis.DSSDeepSeekApi (the real merged
// fetch), which the content delegate + retry logic read as a bare global.
import DSSDeepSeekApi from '../../utils/deepseek-api.js';
import TemporaryChatDeleteApi from '../../content/temporary-chat-delete-api.js';

const DELETE_URL = 'https://chat.deepseek.com/api/v0/chat_session/delete';

// Group A: performDeleteFetch (utils/deepseek-api.js)
// The merged delete fetch now lives here. Assertions target the observable HTTP
// call it makes and the boolean it returns, not internal call sequences.
describe('A - performDeleteFetch', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('A1: returns false when authToken is null', async () => {
        const result = await DSSDeepSeekApi.performDeleteFetch('some-uuid', null);
        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('A2: returns false when chatUuid is null', async () => {
        const result = await DSSDeepSeekApi.performDeleteFetch(null, 'Bearer tok');
        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('A3: calls fetch with correct URL', async () => {
        await DSSDeepSeekApi.performDeleteFetch('uuid-1234', 'Bearer tok');
        const [url] = global.fetch.mock.calls[0];
        expect(url).toBe(DELETE_URL);
    });

    it('A4: calls fetch with method POST', async () => {
        await DSSDeepSeekApi.performDeleteFetch('uuid-1234', 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.method).toBe('POST');
    });

    it('A5: sends authorization header', async () => {
        const token = 'Bearer header-test';
        await DSSDeepSeekApi.performDeleteFetch('uuid-1234', token);
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['authorization']).toBe(token);
    });

    it('A6: sends content-type application/json header', async () => {
        await DSSDeepSeekApi.performDeleteFetch('uuid-1234', 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['content-type']).toBe('application/json');
    });

    it('A7: sends body with chat_session_id', async () => {
        const uuid = 'test-uuid-abcd';
        await DSSDeepSeekApi.performDeleteFetch(uuid, 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.body).toBe(JSON.stringify({ chat_session_id: uuid }));
    });

    it('A8: returns true when response.ok is true', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
        const result = await DSSDeepSeekApi.performDeleteFetch('uuid-1234', 'Bearer tok');
        expect(result).toBe(true);
    });

    it('A9: returns false when response.ok is false', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });
        const result = await DSSDeepSeekApi.performDeleteFetch('uuid-1234', 'Bearer tok');
        expect(result).toBe(false);
    });

    it('A10: returns false when fetch throws', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
        const result = await DSSDeepSeekApi.performDeleteFetch('uuid-1234', 'Bearer tok');
        expect(result).toBe(false);
    });

    it('A11: keepalive defaults to true', async () => {
        await DSSDeepSeekApi.performDeleteFetch('uuid-1234', 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(true);
    });

    it('A12: keepalive false is passed through', async () => {
        await DSSDeepSeekApi.performDeleteFetch('uuid-1234', 'Bearer tok', { keepalive: false });
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(false);
    });
});

// Group AD: deleteChatSession delegates to performDeleteFetch.
// The content wrapper is a one-line delegate. We prove delegation by its
// OBSERVABLE effect: same inputs produce the same underlying fetch, and the
// wrapper keepalive default (false, the navigation case) reaches fetch.
describe('AD - deleteChatSession delegation', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('AD1: delegates producing the same fetch (URL, body, authorization)', async () => {
        const uuid = 'deleg-uuid';
        const token = 'Bearer deleg';
        const result = await TemporaryChatDeleteApi.deleteChatSession(uuid, token);
        expect(result).toBe(true);
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe(DELETE_URL);
        expect(opts.method).toBe('POST');
        expect(opts.headers['authorization']).toBe(token);
        expect(opts.body).toBe(JSON.stringify({ chat_session_id: uuid }));
    });

    it('AD2: wrapper keepalive default is false (navigation case)', async () => {
        await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(false);
    });

    it('AD3: wrapper passes keepalive true through to fetch', async () => {
        await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok', { keepalive: true });
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(true);
    });

    it('AD4: wrapper returns false on guard (missing token), no fetch', async () => {
        const result = await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', null);
        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// Group B: deleteChatSessionWithRetry
// Retry logic still lives in the content module and delegates each attempt
// through globalThis.DSSDeepSeekApi (published by the deepseek-api.js import
// above). We control behavior through global.fetch, the true dependency.
describe('B - deleteChatSessionWithRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('B1: calls fetch once and returns if first attempt succeeds', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });

        await TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-1', 'Bearer tok');

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('B1b: returns true when first attempt succeeds', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });

        const result = await TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-1', 'Bearer tok');

        expect(result).toBe(true);
    });

    it('B2b: returns false after all retry attempts fail', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });

        const promise = TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-2', 'Bearer tok');
        await vi.advanceTimersByTimeAsync(60001);
        const result = await promise;

        expect(result).toBe(false);
    });

    it('B2: calls fetch up to 3 times on repeated failure', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });

        const promise = TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-2', 'Bearer tok');
        await vi.advanceTimersByTimeAsync(60001);
        await promise;

        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('B3: shows toast after 3 failures', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });

        const promise = TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-3', 'Bearer tok');
        await vi.advanceTimersByTimeAsync(60001);
        await promise;

        const toast = document.getElementById('dss-delete-failed-toast');
        expect(toast).not.toBeNull();
    });

    it('B4: does NOT show toast when first attempt succeeds', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });

        await TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-4', 'Bearer tok');

        const toast = document.getElementById('dss-delete-failed-toast');
        expect(toast).toBeNull();
    });

    it('B5: succeeds on second attempt and does NOT show toast', async () => {
        let callCount = 0;
        global.fetch = vi.fn().mockImplementation(async () => {
            callCount++;
            return { ok: callCount >= 2 };
        });

        const promise = TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-5', 'Bearer tok');
        await vi.advanceTimersByTimeAsync(30001);
        await promise;

        const toast = document.getElementById('dss-delete-failed-toast');
        expect(toast).toBeNull();
    });
});

// Group C: showDeleteFailedToast
describe('C - showDeleteFailedToast', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('C1: creates a div with id dss-delete-failed-toast and appends to body', () => {
        TemporaryChatDeleteApi.showDeleteFailedToast();
        const toast = document.getElementById('dss-delete-failed-toast');
        expect(toast).not.toBeNull();
        expect(document.body.contains(toast)).toBe(true);
    });

    it('C2: does not create a second toast if one already exists', () => {
        TemporaryChatDeleteApi.showDeleteFailedToast();
        TemporaryChatDeleteApi.showDeleteFailedToast();
        const toasts = document.querySelectorAll('#dss-delete-failed-toast');
        expect(toasts).toHaveLength(1);
    });

    it('C3: toast shows the zh_TW copy for the tempChatDeleteFailedToast key', () => {
        TemporaryChatDeleteApi.showDeleteFailedToast();
        const toast = document.getElementById('dss-delete-failed-toast');
        expect(toast.textContent).toBe('臨時對話刪除失敗，請確認網路連線。');
    });

    it('C4: toast carries the stylesheet hook class', () => {
        TemporaryChatDeleteApi.showDeleteFailedToast();
        const toast = document.getElementById('dss-delete-failed-toast');
        expect(toast.classList.contains('dss-temp-chat-delete-failed-toast')).toBe(true);
    });

    it('C5: toast carries no inline styles', () => {
        TemporaryChatDeleteApi.showDeleteFailedToast();
        const toast = document.getElementById('dss-delete-failed-toast');
        expect(toast.style.length).toBe(0);
    });
});
