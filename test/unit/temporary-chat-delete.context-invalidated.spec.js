import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';

// ── Global stubs (must precede the module import) ─────────────────────────────
global.TemporaryChatDeleteApi = {
    deleteChatSession: vi.fn().mockResolvedValue(true),
    deleteChatSessionWithRetry: vi.fn().mockResolvedValue(undefined),
    showDeleteFailedToast: vi.fn(),
};
global.TemporaryChatPendingStore = makePendingStoreMock();

import '../../utils/temporary-chat-constants.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNavigateEvent({ destinationUrl, navigationType = 'push' }) {
    return {
        destination: { url: destinationUrl },
        navigationType,
    };
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('context-invalidated — sendMessage sync throw on orphaned content script', () => {
    beforeEach(() => {
        resetState();
        sessionStorage.clear();
        setPathname('/');
        chrome.runtime.sendMessage.mockReset();
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
        vi.restoreAllMocks();
        sessionStorage.clear();
        setPathname('/');
    });

    it('R1: handOffToServiceWorker does not throw when sendMessage throws synchronously (Extension context invalidated)', () => {
        const uuid = 'deadbeef-1111-2222-3333-444444444444';
        setPathname(`/a/chat/s/${uuid}`);
        sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, uuid);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: null, // no token → handOffToServiceWorker path
        });
        globalThis.TemporaryChatEnabledFlag.__setCache(true);

        // Simulate the orphaned content-script scenario: sendMessage throws synchronously
        chrome.runtime.sendMessage = vi.fn(() => {
            throw new Error('Extension context invalidated.');
        });

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Act: navigate away from the tracked conversation → triggers handOffToServiceWorker
        expect(() => {
            TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
                destinationUrl: 'https://chat.deepseek.com/a/chat/s/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                navigationType: 'push',
            }));
        }).not.toThrow();

        // The error should have been caught and logged, mentioning the coordinator
        const allLogArgs = [
            ...errorSpy.mock.calls.map(c => c[0]),
            ...warnSpy.mock.calls.map(c => c[0]),
        ];
        const mentionsCoordinator = allLogArgs.some(
            arg => typeof arg === 'string' && arg.includes('temporary-chat-delete.coordinator')
        );
        expect(mentionsCoordinator).toBe(true);

        // Local cleanup should still complete: tracked uuid cleared from sessionStorage
        expect(sessionStorage.getItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY)).toBeNull();
    });

    it('R2 (control): with a normally resolving sendMessage, the same navigation does not log any coordinator error', () => {
        const uuid = 'deadbeef-1111-2222-3333-444444444444';
        setPathname(`/a/chat/s/${uuid}`);
        sessionStorage.setItem(globalThis.DSS_TEMP_CHAT.DSS_TEMP_CHAT_UUID_KEY, uuid);
        Object.assign(TemporaryChatDelete.state, {
            trackedTemporaryUuid: uuid,
            capturedAuthToken: null,
        });
        globalThis.TemporaryChatEnabledFlag.__setCache(true);

        chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: true });

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        TemporaryChatDelete.handleNavigationEvent(makeNavigateEvent({
            destinationUrl: 'https://chat.deepseek.com/a/chat/s/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            navigationType: 'push',
        }));

        const allLogArgs = [
            ...errorSpy.mock.calls.map(c => c[0]),
            ...warnSpy.mock.calls.map(c => c[0]),
        ];
        const mentionsCoordinator = allLogArgs.some(
            arg => typeof arg === 'string' && arg.includes('temporary-chat-delete.coordinator')
        );
        expect(mentionsCoordinator).toBe(false);
    });
});
