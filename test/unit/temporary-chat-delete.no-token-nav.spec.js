/**
 * Red-phase tests for the no-token navigation bug.
 * R1-R4 MUST FAIL against current code. R5 (control) MUST PASS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';

global.TemporaryChatDeleteApi = {
    deleteChatSession: vi.fn().mockResolvedValue(true),
    deleteChatSessionWithRetry: vi.fn().mockResolvedValue(false),
    showDeleteFailedToast: vi.fn(),
};
global.TemporaryChatPendingStore = makePendingStoreMock();

import '../../utils/temporary-chat-constants.js';
import '../../content/temporary-chat-heartbeat.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

const HEARTBEAT_TYPE = globalThis.DSS_TEMP_CHAT.DSS_MSG_HEARTBEAT;
const RELEASE_LEASE = globalThis.DSS_TEMP_CHAT.DSS_MSG_RELEASE_LEASE;
const SCHEDULE_DELETE_RETRY = globalThis.DSS_TEMP_CHAT.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE;
const UUID_KEY = globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY;
const HEARTBEAT_INTERVAL = globalThis.DSS_TEMP_CHAT.HEARTBEAT_INTERVAL_MS;

const UUID = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
const OTHER_UUID = 'ffff0000-1111-2222-3333-444444444444';

function makeNavigateEvent({ destinationUrl, navigationType = 'push' }) {
    return { destination: { url: destinationUrl }, navigationType };
}

function messagesOfType(type) {
    return chrome.runtime.sendMessage.mock.calls
        .map(([msg]) => msg)
        .filter((msg) => msg && msg.type === type);
}

function heartbeatMessagesForUuid(uuid) {
    return chrome.runtime.sendMessage.mock.calls
        .map(([msg]) => msg)
        .filter((msg) => msg && msg.type === HEARTBEAT_TYPE && msg.uuid === uuid);
}

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

describe('no-token navigation: restored tab leaves tracked conversation', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        chrome.runtime.sendMessage.mockReset();
        chrome.runtime.sendMessage.mockResolvedValue({ ok: true });
        global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();

        setPathname('/a/chat/s/' + UUID);
        sessionStorage.setItem(UUID_KEY, UUID);
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID;
        globalThis.TemporaryChatHeartbeat.start(UUID);
        // Clear initial heartbeat message so counts start clean.
        chrome.runtime.sendMessage.mockClear();
        TemporaryChatDelete.state.capturedAuthToken = null;
        TemporaryChatDelete.state.isListening = true;
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
    });

    afterEach(() => {
        globalThis.TemporaryChatHeartbeat.stop();
        TemporaryChatDelete.detachListeners();
        vi.useRealTimers();
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('R1: after navigating away, advancing timers produces zero additional heartbeat messages for UUID', () => {
        // Sanity: heartbeat IS running - advance one interval and verify it fires.
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL);
        expect(heartbeatMessagesForUuid(UUID).length).toBeGreaterThan(0);
        chrome.runtime.sendMessage.mockClear();

        // Navigate away (no token - current code does nothing).
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/a/chat/s/' + OTHER_UUID,
            navigationType: 'push',
        }));

        chrome.runtime.sendMessage.mockClear();
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL * 2);

        const newHeartbeats = heartbeatMessagesForUuid(UUID).length;
        expect(newHeartbeats).toBe(0);
    });

    it('R2: sends DSS_MSG_RELEASE_LEASE with the tracked UUID after navigation', () => {
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/a/chat/s/' + OTHER_UUID,
            navigationType: 'push',
        }));

        const releaseMessages = messagesOfType(RELEASE_LEASE);
        expect(releaseMessages).toEqual([{ type: RELEASE_LEASE, uuid: UUID }]);
    });

    it('R3: sends DSS_SCHEDULE_DELETE_RETRY with chatUuid after navigation', () => {
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/a/chat/s/' + OTHER_UUID,
            navigationType: 'push',
        }));

        const retryMessages = messagesOfType(SCHEDULE_DELETE_RETRY);
        expect(retryMessages).toEqual([{ type: SCHEDULE_DELETE_RETRY, chatUuid: UUID }]);
    });

    it('R4: sessionStorage UUID is cleared after navigation', () => {
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/a/chat/s/' + OTHER_UUID,
            navigationType: 'push',
        }));

        expect(sessionStorage.getItem(UUID_KEY)).toBeNull();
    });
});

describe('token-present navigation: existing delete path is unchanged (control)', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        chrome.runtime.sendMessage.mockReset();
        chrome.runtime.sendMessage.mockResolvedValue({ ok: true });
        global.TemporaryChatDeleteApi.deleteChatSession.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        global.TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockResolvedValue(false);

        setPathname('/a/chat/s/' + UUID);
        sessionStorage.setItem(UUID_KEY, UUID);
        TemporaryChatDelete.state.trackedTemporaryUuid = UUID;
        TemporaryChatDelete.state.capturedAuthToken = 'Bearer test-token';
        TemporaryChatDelete.state.isListening = true;
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
    });

    afterEach(() => {
        globalThis.TemporaryChatHeartbeat.stop();
        TemporaryChatDelete.detachListeners();
        vi.useRealTimers();
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('R5: with token present, navigating away posts DSS_FIBER_DELETE_SESSION and does NOT send release-lease', () => {
        const postMessageSpy = vi.spyOn(window, 'postMessage');

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/a/chat/s/' + OTHER_UUID,
            navigationType: 'push',
        }));

        expect(postMessageSpy).toHaveBeenCalledWith(
            { type: globalThis.DSS_TEMP_CHAT.DSS_FIBER_DELETE_MESSAGE_TYPE, sessionId: UUID },
            '*'
        );

        const releaseMessages = messagesOfType(RELEASE_LEASE);
        expect(releaseMessages).toEqual([]);

        postMessageSpy.mockRestore();
    });
});
