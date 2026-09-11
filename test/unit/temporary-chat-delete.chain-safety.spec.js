import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';
import { setPathname } from '../helpers/set-pathname.js';

// ── Global stubs (must precede the module import) ─────────────────────────────
global.TemporaryChatDeleteApi = {
    deleteChatSession: vi.fn().mockResolvedValue(true),
    deleteChatSessionWithRetry: vi.fn().mockResolvedValue(true),
    showDeleteFailedToast: vi.fn(),
};
global.TemporaryChatPendingStore = makePendingStoreMock();

import '../../utils/temporary-chat-constants.js';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEMP_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';
const CHAT_A   = 'bbbbbbbb-1111-2222-3333-444444444444';
const CHAT_B   = 'cccccccc-1111-2222-3333-444444444444';

function makeNavigateEvent(destinationUrl, navigationType = 'push') {
    return { destination: { url: destinationUrl }, navigationType };
}

function chatUrl(uuid) {
    return 'https://chat.deepseek.com/a/chat/s/' + uuid;
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

function simulateContextInvalidation() {
    chrome.runtime.sendMessage = vi.fn(() => {
        throw new Error('Extension context invalidated.');
    });
    chrome.runtime.id = undefined;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('chain-safety — context invalidation must not cause chain deletion', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetState();
        sessionStorage.clear();
        setPathname('/');
        chrome.runtime.sendMessage.mockReset();
        chrome.runtime.id = 'test-extension-id';
        TemporaryChatDeleteApi.deleteChatSession.mockClear();
        TemporaryChatDeleteApi.deleteChatSessionWithRetry.mockClear();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        TemporaryChatDelete.detachListeners();
        vi.restoreAllMocks();
        vi.useRealTimers();
        sessionStorage.clear();
        setPathname('/');
        chrome.runtime.id = 'test-extension-id';
        chrome.runtime.sendMessage = vi.fn();
    });

    // ── Group 1: Circuit breaker (context invalidated => handler does nothing) ──

    describe('circuit breaker — invalidated context', () => {
        it('trackedTemporaryUuid remains unchanged (handler bails before any processing)', () => {
            setPathname('/a/chat/s/' + TEMP_UUID);
            Object.assign(TemporaryChatDelete.state, {
                trackedTemporaryUuid: TEMP_UUID,
                capturedAuthToken: 'Bearer test-token',
                isPendingCreate: true,
            });
            globalThis.TemporaryChatEnabledFlag.__setCache(true);
            simulateContextInvalidation();

            TemporaryChatDelete.handleNavigationEvent(
                makeNavigateEvent(chatUrl(CHAT_A))
            );
            vi.advanceTimersByTime(3100);

            expect(TemporaryChatDelete.state.trackedTemporaryUuid).toBe(TEMP_UUID);
        });

        it('isPendingCreate remains unchanged (handler bails before any processing)', () => {
            setPathname('/a/chat/s/' + TEMP_UUID);
            Object.assign(TemporaryChatDelete.state, {
                trackedTemporaryUuid: TEMP_UUID,
                capturedAuthToken: 'Bearer test-token',
                isPendingCreate: true,
            });
            globalThis.TemporaryChatEnabledFlag.__setCache(true);
            simulateContextInvalidation();

            TemporaryChatDelete.handleNavigationEvent(
                makeNavigateEvent(chatUrl(CHAT_A))
            );

            expect(TemporaryChatDelete.state.isPendingCreate).toBe(true);
        });

        it('no deletion API calls when context is invalidated', () => {
            setPathname('/a/chat/s/' + CHAT_A);
            Object.assign(TemporaryChatDelete.state, {
                trackedTemporaryUuid: CHAT_A,
                capturedAuthToken: 'Bearer test-token',
                isPendingCreate: true,
            });
            globalThis.TemporaryChatEnabledFlag.__setCache(true);
            simulateContextInvalidation();

            TemporaryChatDelete.handleNavigationEvent(
                makeNavigateEvent(chatUrl(CHAT_B))
            );
            vi.advanceTimersByTime(3100);

            expect(TemporaryChatDeleteApi.deleteChatSessionWithRetry).not.toHaveBeenCalled();
            expect(TemporaryChatDeleteApi.deleteChatSession).not.toHaveBeenCalled();
        });
    });

    // ── Group 2: Defense-in-depth (context VALID) ──────────────────────────────

    describe('defense-in-depth — valid context, early returns and isPendingCreate fix', () => {
        it('after deleteTrackedAndClear, destination UUID must not be tracked', () => {
            setPathname('/a/chat/s/' + TEMP_UUID);
            Object.assign(TemporaryChatDelete.state, {
                trackedTemporaryUuid: TEMP_UUID,
                capturedAuthToken: 'Bearer test-token',
                isPendingCreate: true,
            });
            globalThis.TemporaryChatEnabledFlag.__setCache(true);
            // Keep runtime.id valid — only sendMessage throws
            chrome.runtime.sendMessage = vi.fn(() => {
                throw new Error('Extension context invalidated.');
            });

            try {
                TemporaryChatDelete.handleNavigationEvent(
                    makeNavigateEvent(chatUrl(CHAT_A))
                );
            } catch { /* sendMessage throw may propagate */ }
            vi.advanceTimersByTime(3100);

            // After deleting the tracked temp, the handler must return early
            // destination CHAT_A must NOT become the new trackedTemporaryUuid
            expect(TemporaryChatDelete.state.trackedTemporaryUuid).not.toBe(CHAT_A);
        });

        it('isPendingCreate must be reset even when sendMessage throws in trackUuid', () => {
            setPathname('/a/chat/s/' + CHAT_A);
            Object.assign(TemporaryChatDelete.state, {
                createDetected: true,
                isCompletionDetected: true,
                isPendingCreate: false,
            });
            globalThis.TemporaryChatEnabledFlag.__setCache(true);
            simulateContextInvalidation();

            try {
                TemporaryChatDelete.checkCoOccurrence();
            } catch { /* sendMessage throw */ }

            expect(TemporaryChatDelete.state.isPendingCreate).toBe(false);
        });
    });
});
