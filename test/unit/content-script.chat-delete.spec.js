import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';

// ── chrome mocks ───────────────────────────────────────────────────────────────
// These are defined before TemporaryChatDelete is imported; the module checks for
// global.chrome at load-time.
if (!global.chrome) {
    global.chrome = {};
}
if (!global.chrome.storage) {
    global.chrome.storage = {};
}
if (!global.chrome.storage.session) {
    global.chrome.storage.session = {
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
    };
}
if (!global.chrome.storage.onChanged) {
    global.chrome.storage.onChanged = { addListener: () => {} };
}
if (!global.chrome.runtime) {
    global.chrome.runtime = { sendMessage: vi.fn() };
}

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

// ── Helper ────────────────────────────────────────────────────────────────────
function setPathname(path) {
    window.history.replaceState({}, '', path);
}

// ── deleteChatSession is now in TemporaryChatDeleteApi, not TemporaryChatDelete ─
// Those tests are covered in temporary-chat-delete-api.spec.js.

// ── beforeunload handler ──────────────────────────────────────────────────────
// handleBeforeUnload now routes via TemporaryChatDeleteApi.deleteChatSession(uuid, token,
// {keepalive:true}) directly (NOT chrome.runtime.sendMessage) on the tab-close path.

describe('beforeunload handler (TemporaryChatDelete)', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
        sessionStorage.clear();
        global.chrome.runtime.sendMessage.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('calls TemporaryChatDeleteApi.deleteChatSession(uuid, token, {keepalive:true}) not sendMessage when conditions are met', () => {
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

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, token, { keepalive: true });
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when suppressNextUnloadDelete is true', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: 'Bearer token',
            trackedTemporaryUuid: uuid,
            suppressNextUnloadDelete: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when isKeyboardRefresh is true', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: 'Bearer token',
            trackedTemporaryUuid: uuid,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: true,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when capturedAuthToken is null', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.__setState({
            capturedAuthToken: null,
            trackedTemporaryUuid: uuid,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when URL has no chat UUID', () => {
        setPathname('/');
        TemporaryChatDelete.__setState({
            capturedAuthToken: 'Bearer token',
            trackedTemporaryUuid: 'face0007-f00d-dead-beef-0123456789ab',
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
        });

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when current URL uuid does not match trackedTemporaryUuid', () => {
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

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });
});
