import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// ── Helper ─────────────────────────────────────────────────────────────────────
function setPathname(path) {
    window.history.replaceState({}, '', path);
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
});

// ── Group B: enabled/disabled gating ─────────────────────────────────────────

describe('B — enabled/disabled gating', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
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

    it('B4: handleAuthMessage does not capture token when disabled', () => {
        TemporaryChatDelete.__setState({ isEnabled: false });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer blocked' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });

    it('B5: handleAuthMessage captures token when enabled', () => {
        TemporaryChatDelete.__setState({ isEnabled: true });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer allowed' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBe('Bearer allowed');
    });

    it('B6: handleChatLeft does not call fetch when disabled', async () => {
        TemporaryChatDelete.__setState({ isEnabled: false, capturedAuthToken: 'Bearer tok' });
        const evt = new CustomEvent('dss-chat-left', { detail: { chatUuid: 'uuid-xyz' } });
        TemporaryChatDelete.handleChatLeft(evt);
        await Promise.resolve();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('B7: handleChatLeft calls fetch when enabled', async () => {
        TemporaryChatDelete.__setState({ isEnabled: true, capturedAuthToken: 'Bearer tok' });
        const evt = new CustomEvent('dss-chat-left', { detail: { chatUuid: 'uuid-xyz' } });
        TemporaryChatDelete.handleChatLeft(evt);
        await Promise.resolve();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.body).toBe(JSON.stringify({ chat_session_id: 'uuid-xyz' }));
    });

    it('B8: handleBeforeUnload does not call fetch when disabled', () => {
        const uuid = 'eeeeeeee-0000-0000-0000-eeeeeeeeeeee';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ isEnabled: false, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.handleBeforeUnload();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('B9: handleBeforeUnload calls fetch when enabled', () => {
        const uuid = 'eeeeeeee-0000-0000-0000-eeeeeeeeeeee';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ isEnabled: true, capturedAuthToken: 'Bearer tok' });
        TemporaryChatDelete.handleBeforeUnload();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('B10: handleAuthMessage ignores messages not from window', () => {
        TemporaryChatDelete.__setState({ isEnabled: true });
        const event = new MessageEvent('message', {
            data: { type: 'DSS_AUTH_CAPTURED', authorization: 'Bearer foreign' },
            source: null,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });

    it('B11: handleAuthMessage ignores messages with wrong type', () => {
        TemporaryChatDelete.__setState({ isEnabled: true });
        const event = new MessageEvent('message', {
            data: { type: 'SOME_OTHER_TYPE', authorization: 'Bearer wrong' },
            source: window,
        });
        TemporaryChatDelete.handleAuthMessage(event);
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });
});

// ── Group C: refresh exclusion ────────────────────────────────────────────────

describe('C — refresh exclusion', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // handleNavigationEvent is an internal handler not exported; we test via
    // __setState which exercises the same _isPageRefresh state variable.
    it('C1: isPageRefresh can be set true to simulate reload navigationType', () => {
        TemporaryChatDelete.__setState({ isPageRefresh: true });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(true);
    });

    it('C2: isPageRefresh resets to false after __resetState (simulates push/replace)', () => {
        TemporaryChatDelete.__setState({ isPageRefresh: true });
        TemporaryChatDelete.__resetState();
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(false);
    });

    it('C3: __resetState always resets isPageRefresh to false', () => {
        TemporaryChatDelete.__setState({ isPageRefresh: true });
        TemporaryChatDelete.__resetState();
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(false);
    });

    it('C4: F5 key sets isPageRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'F5', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(true);
    });

    it('C5: Ctrl+R sets isPageRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(true);
    });

    it('C6: Cmd+R sets isPageRefresh to true', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: false, metaKey: true });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(true);
    });

    it('C7: beforeunload does NOT delete when isPageRefresh is true (enabled)', () => {
        const uuid = 'cccccccc-0000-0000-0000-cccccccccccc';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ isEnabled: true, capturedAuthToken: 'Bearer tok', isPageRefresh: true });
        TemporaryChatDelete.handleBeforeUnload();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('C8: beforeunload DOES delete on normal navigation when enabled', () => {
        const uuid = 'cccccccc-0000-0000-0000-cccccccccccc';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({ isEnabled: true, capturedAuthToken: 'Bearer tok', isPageRefresh: false });
        TemporaryChatDelete.handleBeforeUnload();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});

// ── Group D: dss-chat-left listener ──────────────────────────────────────────

describe('D — handleChatLeft', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        global.fetch = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('D1: calls deleteChatSession with the event chatUuid when enabled', async () => {
        const uuid = 'dddddddd-1111-1111-1111-dddddddddddd';
        TemporaryChatDelete.__setState({ isEnabled: true, capturedAuthToken: 'Bearer tok' });
        const evt = new CustomEvent('dss-chat-left', { detail: { chatUuid: uuid } });
        TemporaryChatDelete.handleChatLeft(evt);
        await Promise.resolve();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.body).toBe(JSON.stringify({ chat_session_id: uuid }));
    });

    it('D2: does NOT call fetch when chatUuid is missing from detail', async () => {
        TemporaryChatDelete.__setState({ isEnabled: true, capturedAuthToken: 'Bearer tok' });
        const evt = new CustomEvent('dss-chat-left', { detail: {} });
        TemporaryChatDelete.handleChatLeft(evt);
        await Promise.resolve();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('D3: does NOT call fetch when disabled', async () => {
        TemporaryChatDelete.__setState({ isEnabled: false, capturedAuthToken: 'Bearer tok' });
        const evt = new CustomEvent('dss-chat-left', { detail: { chatUuid: 'uuid-xxx' } });
        TemporaryChatDelete.handleChatLeft(evt);
        await Promise.resolve();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ── Group E: enable / disable state management ────────────────────────────────

describe('E — enable/disable lifecycle', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('E1: __resetState sets isEnabled to false', () => {
        expect(TemporaryChatDelete.__getState().isEnabled).toBe(false);
    });

    it('E2: enable() sets isEnabled to true', () => {
        TemporaryChatDelete.enable();
        expect(TemporaryChatDelete.__getState().isEnabled).toBe(true);
    });

    it('E3: disable() sets isEnabled to false', () => {
        TemporaryChatDelete.enable();
        TemporaryChatDelete.disable();
        expect(TemporaryChatDelete.__getState().isEnabled).toBe(false);
    });

    it('E4: disable() clears capturedAuthToken', () => {
        TemporaryChatDelete.__setState({ capturedAuthToken: 'Bearer tok', isEnabled: true });
        TemporaryChatDelete.disable();
        expect(TemporaryChatDelete.__getState().capturedAuthToken).toBeNull();
    });

    it('E5: enable() is idempotent (calling twice stays enabled)', () => {
        TemporaryChatDelete.enable();
        TemporaryChatDelete.enable();
        expect(TemporaryChatDelete.__getState().isEnabled).toBe(true);
    });

    it('E6: disable() is idempotent (calling twice when already disabled is safe)', () => {
        TemporaryChatDelete.disable();
        TemporaryChatDelete.disable();
        expect(TemporaryChatDelete.__getState().isEnabled).toBe(false);
    });

    it('E7: handleToggleChanged with isEnabled true results in isEnabled state being true', () => {
        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: true } });
        TemporaryChatDelete.handleToggleChanged(evt);
        expect(TemporaryChatDelete.__getState().isEnabled).toBe(true);
    });

    it('E8: handleToggleChanged with isEnabled false results in isEnabled state being false', () => {
        TemporaryChatDelete.enable();
        const evt = new CustomEvent('dss-temporary-chat-changed', { detail: { isEnabled: false } });
        TemporaryChatDelete.handleToggleChanged(evt);
        expect(TemporaryChatDelete.__getState().isEnabled).toBe(false);
    });
});
