/**
 * Regression tests for the fix landed in 93851ec (content/temporary-chat-delete.handlers.js): the marking branch of handleNavigationEvent passes destinationUrl straight to extractUuidFromUrl instead of wrapping it in `new URL()`.
 *
 * Pre-fix, `new URL(destinationUrl)` threw TypeError for relative paths such as `/a/chat/s/<uuid>` and for an empty or missing destination url. The marking branch runs only for the matched temporary session (created by this page load and first sent with the switch on), so every case first matches UUID on the homepage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';

global.TemporaryChatDeleteApi = {
    deleteChatSession: vi.fn().mockResolvedValue(true),
    deleteChatSessionWithRetry: vi.fn().mockResolvedValue(undefined),
    showDeleteFailedToast: vi.fn(),
};
global.TemporaryChatPendingStore = makePendingStoreMock();

import '../../utils/temporary-chat-constants.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

const UUID = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
const MSG = () => globalThis.DSS_SETTINGS_MSG;

let settingsStore = {};

function installSettingsRoute() {
    chrome.runtime.sendMessage = vi.fn(async (message) => {
        if (message?.type === MSG().GET_SETTINGS) {
            const values = {};
            (message.keys || []).forEach((key) => {
                if (key in settingsStore) values[key] = settingsStore[key];
            });
            return { ok: true, values };
        }
        if (message?.type === MSG().SET_SETTINGS) {
            Object.assign(settingsStore, message.values);
            return { ok: true };
        }
        return { ok: true, values: {} };
    });
}

function resetState() {
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
    globalThis.TemporaryChatEnabledFlag.__setCache(false);
}

function makeNavigateEvent({ destinationUrl, navigationType = 'push' }) {
    return { destination: { url: destinationUrl }, navigationType };
}

function createMessage(createdSessionId) {
    return new MessageEvent('message', { data: { type: 'DSS_CHAT_CREATE_DETECTED', createdSessionId }, source: window });
}

function completionMessage(chatSessionId) {
    return new MessageEvent('message', { data: { type: 'DSS_CHAT_COMPLETION_DETECTED', chatSessionId }, source: window });
}

/** On the homepage with the switch on: a create returns uuid, then the first message is sent in uuid. */
function matchOnHomepage(uuid) {
    globalThis.TemporaryChatEnabledFlag.__setCache(true);
    TemporaryChatDelete.handleCreateMessage(createMessage(uuid));
    TemporaryChatDelete.handleCompletionMessage(completionMessage(uuid));
}

describe('handleNavigationEvent: relative destination URL', () => {
    beforeEach(() => {
        resetState();
        settingsStore = {};
        installSettingsRoute();
        // Current page is NOT a tracked conversation, so the "leaving tracked" branch is skipped
        setPathname('/');
        // UUID is the matched temporary session, so the marking branch is reached
        matchOnHomepage(UUID);
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
    });

    it('should not throw when destination.url is a relative path with a valid chat UUID', () => {
        const event = makeNavigateEvent({ destinationUrl: '/a/chat/s/' + UUID });

        // Act & Assert: on the pre-93851ec code, new URL(relativeUrl) throws TypeError
        expect(() => TemporaryChatDelete.handleNavigationEvent(event)).not.toThrow();
    });

    it('should extract the matched UUID from a relative path and track it', () => {
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({ destinationUrl: '/a/chat/s/' + UUID }));

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID);
    });

    it('a relative path to a conversation other than the matched UUID tracks nothing', () => {
        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({ destinationUrl: '/a/chat/s/b2b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6' }));

        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });
});

describe('handleNavigationEvent: empty or missing destination URL', () => {
    beforeEach(() => {
        resetState();
        settingsStore = {};
        installSettingsRoute();
        // Current page is NOT a tracked conversation, so control reaches the marking branch
        setPathname('/');
        matchOnHomepage(UUID);
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
    });

    it.each([
        ['destination is {}', { destination: {}, navigationType: 'push' }],
        ['destination.url is an empty string', { destination: { url: '' }, navigationType: 'push' }],
    ])('does not throw and tracks no UUID when %s', (_label, event) => {
        expect(() => TemporaryChatDelete.handleNavigationEvent(event)).not.toThrow();
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBeNull();
    });
});
