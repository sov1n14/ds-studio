import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';
import { unloadHandOffs, unloadHandOff } from '../helpers/tab-unload-handoff.js';
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
// 頁面無法分辨關閉分頁與工具列重新整理，所以 handleBeforeUnload 不自行刪除：追蹤中的 uuid 以
// DSS_TEMP_CHAT.DSS_MSG_TAB_UNLOADING 訊息交給 service worker（有無 token 皆同），追蹤保留。

describe('beforeunload handler (TemporaryChatDelete)', () => {
    beforeEach(() => {
        Object.assign(TemporaryChatDelete.state, {
            capturedAuthToken: null,
            trackedTemporaryUuid: null,
            createdSessionIds: new Set(),
            sentSessionIds: new Set(),
            enabledFirstSendIds: new Set(),
            pendingTemporaryUuid: null,
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

    it.each([
        ['a captured token', 'Bearer leave-token'],
        ['no captured token', null],
    ])('hands the tracked uuid to the service worker with one unload message, deletes nothing and keeps tracking, with %s', (_label, token) => {
        const uuid = 'ffffffff-0000-0000-0000-ffffffffffff';
        setPathname(`/a/chat/s/${uuid}`);
        sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, uuid);
        TemporaryChatDelete.state.capturedAuthToken = token;
        TemporaryChatDelete.state.trackedTemporaryUuid = uuid;
        TemporaryChatDelete.state.suppressNextUnloadDelete = false;
        TemporaryChatDelete.state.isKeyboardRefresh = false;

        TemporaryChatDelete.handleBeforeUnload();

        expect(unloadHandOffs(global.chrome.runtime.sendMessage), 'beforeunload must send exactly one unload message for the tracked uuid').toEqual([unloadHandOff(uuid)]);
        expect(global.TemporaryChatDeleteApi.deleteChatSession, 'the page must not delete on unload').not.toHaveBeenCalled();
        expect(global.TemporaryChatDeleteApi.deleteChatSessionWithRetry, 'the page must not delete on unload').not.toHaveBeenCalled();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DSS_SCHEDULE_DELETE_RETRY' }));
        expect(TemporaryChatDelete.state.trackedTemporaryUuid, 'tracking must survive the unload').toBe(uuid);
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY), 'sessionStorage tracking must survive the unload').toBe(uuid);
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
