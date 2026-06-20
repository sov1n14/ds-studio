import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TemporaryChatDeleteApi from '../../content/temporary-chat-delete-api.js';

const DELETE_URL = 'https://chat.deepseek.com/api/v0/chat_session/delete';

// ── Group A: deleteChatSession ────────────────────────────────────────────────

describe('A — deleteChatSession', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('A1: returns false when authToken is null', async () => {
        const result = await TemporaryChatDeleteApi.deleteChatSession('some-uuid', null);
        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('A2: returns false when chatUuid is null', async () => {
        const result = await TemporaryChatDeleteApi.deleteChatSession(null, 'Bearer tok');
        expect(result).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('A3: calls fetch with correct URL', async () => {
        await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok');
        const [url] = global.fetch.mock.calls[0];
        expect(url).toBe(DELETE_URL);
    });

    it('A4: calls fetch with method POST', async () => {
        await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.method).toBe('POST');
    });

    it('A5: sends authorization header', async () => {
        const token = 'Bearer header-test';
        await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', token);
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['authorization']).toBe(token);
    });

    it('A6: sends content-type application/json header', async () => {
        await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.headers['content-type']).toBe('application/json');
    });

    it('A7: sends body with chat_session_id', async () => {
        const uuid = 'test-uuid-abcd';
        await TemporaryChatDeleteApi.deleteChatSession(uuid, 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.body).toBe(JSON.stringify({ chat_session_id: uuid }));
    });

    it('A8: returns true when response.ok is true', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
        const result = await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok');
        expect(result).toBe(true);
    });

    it('A9: returns false when response.ok is false', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });
        const result = await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok');
        expect(result).toBe(false);
    });

    it('A10: returns false when fetch throws', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
        const result = await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok');
        expect(result).toBe(false);
    });

    it('A11: keepalive defaults to false', async () => {
        await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok');
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(false);
    });

    it('A12: keepalive true is passed through', async () => {
        await TemporaryChatDeleteApi.deleteChatSession('uuid-1234', 'Bearer tok', { keepalive: true });
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.keepalive).toBe(true);
    });
});

// ── Group B: deleteChatSessionWithRetry ──────────────────────────────────────
// Note: deleteChatSessionWithRetry calls the internal deleteChatSession via closure.
// We control behavior through global.fetch (the actual dependency), not by spying on
// the exported reference.

describe('B — deleteChatSessionWithRetry', () => {
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

    it('B2: calls fetch up to 3 times on repeated failure', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });

        const promise = TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-2', 'Bearer tok');
        // Advance past 2 retry intervals (30000ms each)
        await vi.advanceTimersByTimeAsync(60001);
        await promise;

        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('B3: shows toast after 3 failures', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });

        const promise = TemporaryChatDeleteApi.deleteChatSessionWithRetry('uuid-3', 'Bearer tok');
        // Advance past the 2 retry intervals (30000ms each) but NOT past the 6000ms toast removal timer
        // Total: 30000 (wait before retry 2) + 30000 (wait before retry 3) = 60000ms is enough
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

// ── Group C: showDeleteFailedToast ────────────────────────────────────────────

describe('C — showDeleteFailedToast', () => {
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

    it('C3: toast contains the correct Chinese error text', () => {
        TemporaryChatDeleteApi.showDeleteFailedToast();
        const toast = document.getElementById('dss-delete-failed-toast');
        expect(toast.textContent).toBe('臨時對話刪除失敗，請確認網路連線。');
    });
});
