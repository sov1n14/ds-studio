import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';

// The constants module publishes its API on globalThis and via CommonJS module.exports.
// Import the CommonJS export object directly to assert requirement 1.
import DSS_TEMP_CHAT_CONSTANTS from '../../utils/temporary-chat-constants.js';

// chrome.* comes from the shared setup mock; the temporary-chat-delete.* parts and
// collaborators are preloaded there. See sibling temporary-chat-delete.spec.js header.

// deleteChatSessionWithRetry is the API fallback the coordinator awaits after a fiber
// delete fails. Its real contract resolves false once every retry attempt is
// exhausted, true on success. Each test arms the return value it needs.
global.TemporaryChatDeleteApi = {
    deleteChatSession: vi.fn().mockResolvedValue(true),
    deleteChatSessionWithRetry: vi.fn().mockResolvedValue(false),
    showDeleteFailedToast: vi.fn(),
};

global.TemporaryChatPendingStore = makePendingStoreMock();

import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

const RELEASE_LEASE = 'DSS_RELEASE_LEASE';
const SCHEDULE_DELETE_RETRY = 'DSS_SCHEDULE_DELETE_RETRY';
const REMOVE_PENDING_DELETE = 'DSS_REMOVE_PENDING_DELETE';
const FIBER_DELETE_RESULT = 'DSS_FIBER_DELETE_RESULT';

async function flushMicrotasks(times = 8) {
    for (let i = 0; i < times; i++) await Promise.resolve();
}

function dispatchFiberResult(uuid, success) {
    window.dispatchEvent(new MessageEvent('message', {
        data: { type: FIBER_DELETE_RESULT, sessionId: uuid, success },
        source: window,
    }));
}

function messagesOfType(type) {
    return chrome.runtime.sendMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message && message.type === type);
}


/** Reset all state fields to initial values (replaces __resetState). */
function resetState() {
    Object.assign(TemporaryChatDelete.state, {
        capturedAuthToken: null,
        trackedTemporaryUuid: null,
        createDetected: false,
        isCompletionDetected: false,
        isPendingCreate: false,
        coOccurrenceTimer: null,
        suppressNextUnloadDelete: false,
        isKeyboardRefresh: false,
        isListening: false,
    });
    globalThis.TemporaryChatEnabledFlag.__setCache(false);
}

describe('release-lease constant', () => {
    it('L0: DSS_MSG_RELEASE_LEASE is exported from the constants module and equals DSS_RELEASE_LEASE', () => {
        expect(DSS_TEMP_CHAT_CONSTANTS).toHaveProperty('DSS_MSG_RELEASE_LEASE');
        expect(DSS_TEMP_CHAT_CONSTANTS.DSS_MSG_RELEASE_LEASE).toBe(RELEASE_LEASE);
    });
});

describe('deleteTrackedAndClear — release lease on failed immediate delete', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        setPathname('/');
        // Fake ONLY setTimeout/clearTimeout so the coordinator fiber-result fallback
        // timer is controllable. Full vi.useFakeTimers() deadlocks these specs because
        // the in-memory storage mock resolves via a real setTimeout.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSession.mockResolvedValue(true);
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockResolvedValue(false);
        chrome.runtime.sendMessage.mockReset();
        chrome.runtime.sendMessage.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('L1: fiber delete fails AND API fallback exhausts retries → sends exactly one release-lease message with the tracked uuid, alongside the retry-alarm schedule, and does NOT remove the pending entry', async () => {
        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0001';
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockResolvedValue(false);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        dispatchFiberResult(uuid, false);
        await flushMicrotasks();

        // Existing behaviour on the exhausted-fallback path: ask the SW to schedule a
        // retry alarm. Should already pass pre-implementation.
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: SCHEDULE_DELETE_RETRY }));

        // NEW behaviour: exactly one release-lease message carrying the tracked uuid.
        const releaseMessages = messagesOfType(RELEASE_LEASE);
        expect(releaseMessages).toEqual([{ type: RELEASE_LEASE, uuid }]);

        // Conversation stays in the pending queue so another device can take it.
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: REMOVE_PENDING_DELETE }));
    });

    it('L2: fiber delete SUCCEEDS → sends NO release-lease message and removes the pending entry instead', async () => {
        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0002';
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        dispatchFiberResult(uuid, true);
        await flushMicrotasks();

        expect(messagesOfType(RELEASE_LEASE)).toEqual([]);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: REMOVE_PENDING_DELETE, uuid }));
    });

    it('L3: fiber delete fails but the API fallback SUCCEEDS → sends NO release-lease message', async () => {
        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0003';
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockResolvedValue(true);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });
        dispatchFiberResult(uuid, false);
        await flushMicrotasks();

        expect(messagesOfType(RELEASE_LEASE)).toEqual([]);
    });

    it('L4: the release-lease message carries the uuid tracked when the leave flow began, even though deleteTrackedAndClear clears its tracked state immediately', async () => {
        const uuid = 'aaaa1111-bbbb-cccc-dddd-eeeeeeee0004';
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockResolvedValue(false);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: 'Bearer tok',
        });

        TemporaryChatDelete.deleteTrackedAndClear({ keepalive: false });

        // Tracked state is cleared synchronously at the start of the leave flow...
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();

        dispatchFiberResult(uuid, false);
        await flushMicrotasks();

        // ...yet the release-lease message still carries the originally-tracked uuid.
        const releaseMessages = messagesOfType(RELEASE_LEASE);
        expect(releaseMessages).toEqual([{ type: RELEASE_LEASE, uuid }]);
    });
});
