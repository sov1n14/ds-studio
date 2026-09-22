/**
 * Red-phase test: handleNavigationEvent crashes on relative destination URLs.
 *
 * Bug: line 153 wraps destinationUrl in `new URL()` which throws TypeError
 * on relative paths like `/a/chat/s/<uuid>`. The extractUuidFromUrl helper
 * already handles relative paths via regex, so the `new URL()` is unnecessary.
 *
 * This test MUST FAIL against the current (buggy) code.
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

function makeNavigateEvent({ destinationUrl, navigationType = 'push' }) {
    return { destination: { url: destinationUrl }, navigationType };
}

describe('handleNavigationEvent: relative destination URL', () => {
    beforeEach(() => {
        resetState();
        settingsStore = {};
        installSettingsRoute();
        // Current page is NOT a tracked conversation, so the "leaving tracked" branch is skipped
        setPathname('/');
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
    });

    it('should not throw when destination.url is a relative path with a valid chat UUID', () => {
        // Arrange: enable the feature and set isPendingCreate so line 152 is reached
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        TemporaryChatDelete.state.isPendingCreate = true;

        const relativeUrl = '/a/chat/s/' + UUID;
        const event = makeNavigateEvent({ destinationUrl: relativeUrl });

        // Act & Assert: on buggy code, new URL(relativeUrl) throws TypeError
        expect(() => TemporaryChatDelete.handleNavigationEvent(event)).not.toThrow();
    });

    it('should extract UUID from relative path and call tracking.trackUuid', () => {
        // Arrange
        globalThis.TemporaryChatEnabledFlag.__setCache(true);
        TemporaryChatDelete.state.isPendingCreate = true;

        const relativeUrl = '/a/chat/s/' + UUID;
        const event = makeNavigateEvent({ destinationUrl: relativeUrl });

        // Act: should not throw, and should track the UUID
        TemporaryChatDelete.handleNavigationEvent(event);

        // Assert: the UUID was tracked (trackedTemporaryUuid is set by trackUuid)
        expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(UUID);
    });
});
