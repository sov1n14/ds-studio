import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';
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
global.TemporaryChatPendingStore = makePendingStoreMock();

import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// ── deleteChatSession is now in TemporaryChatDeleteApi, not TemporaryChatDelete ─
// Those tests are covered in temporary-chat-delete-api.spec.js.

// ── beforeunload handler ──────────────────────────────────────────────────────
// handleBeforeUnload now routes via TemporaryChatDeleteApi.deleteChatSession(uuid, token,
// {keepalive:true}) directly (NOT chrome.runtime.sendMessage) on the tab-close path.

describe('beforeunload handler (TemporaryChatDelete)', () => {
    beforeEach(() => {
        Object.assign(TemporaryChatDelete.state, {
            capturedAuthToken: null,
            trackedTemporaryUuid: null,
            createDetected: false,
            completionDetected: false,
            isPendingCreate: false,
            coOccurrenceTimer: null,
            suppressNextUnloadDelete: false,
            isKeyboardRefresh: false,
            isListening: false,
        });
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

    it('calls TemporaryChatDeleteApi.deleteChatSession(uuid, token, {keepalive:true}) and asks background for no delete retry when conditions are met', () => {
        const token = 'Bearer leave-token';
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.state.capturedAuthToken = token;
        TemporaryChatDelete.state.trackedTemporaryUuid = uuid;
        TemporaryChatDelete.state.suppressNextUnloadDelete = false;
        TemporaryChatDelete.state.isKeyboardRefresh = false;

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.TemporaryChatDeleteApi.deleteChatSession).toHaveBeenCalledWith(uuid, token, { keepalive: true });
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DSS_SCHEDULE_DELETE_RETRY' }));
    });

    it('does NOT call sendMessage when suppressNextUnloadDelete is true', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.state.capturedAuthToken = 'Bearer token';
        TemporaryChatDelete.state.trackedTemporaryUuid = uuid;
        TemporaryChatDelete.state.suppressNextUnloadDelete = true;

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when isKeyboardRefresh is true', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.state.capturedAuthToken = 'Bearer token';
        TemporaryChatDelete.state.trackedTemporaryUuid = uuid;
        TemporaryChatDelete.state.suppressNextUnloadDelete = false;
        TemporaryChatDelete.state.isKeyboardRefresh = true;

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when capturedAuthToken is null', () => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        TemporaryChatDelete.state.capturedAuthToken = null;
        TemporaryChatDelete.state.trackedTemporaryUuid = uuid;
        TemporaryChatDelete.state.suppressNextUnloadDelete = false;
        TemporaryChatDelete.state.isKeyboardRefresh = false;

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when URL has no chat UUID', () => {
        setPathname('/');
        TemporaryChatDelete.state.capturedAuthToken = 'Bearer token';
        TemporaryChatDelete.state.trackedTemporaryUuid = 'face0007-f00d-dead-beef-0123456789ab';
        TemporaryChatDelete.state.suppressNextUnloadDelete = false;
        TemporaryChatDelete.state.isKeyboardRefresh = false;

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });

    it('does NOT call sendMessage when current URL uuid does not match trackedTemporaryUuid', () => {
        const trackedUuid = 'tracked-aaaa';
        const currentUuid = 'current-bbbb';
        setPathname(`/a/chat/s/${currentUuid}`);
        TemporaryChatDelete.state.capturedAuthToken = 'Bearer token';
        TemporaryChatDelete.state.trackedTemporaryUuid = trackedUuid;
        TemporaryChatDelete.state.suppressNextUnloadDelete = false;
        TemporaryChatDelete.state.isKeyboardRefresh = false;

        TemporaryChatDelete.handleBeforeUnload();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
    });
});
