import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// Tests the keyboard refresh-detection supplement in temporary-chat-delete.js:
// handleRefreshKeydown sets isKeyboardRefresh for F5 / Ctrl+R / Cmd+R.
// The Navigation API `navigationType === 'reload'` branch is covered by
// temporary-chat-delete.spec.js group K (it exercises handleNavigationEvent).

describe('handleRefreshKeydown — keyboard supplement', () => {
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
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sets isKeyboardRefresh to true on F5 key', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'F5', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(true);
    });

    it('sets isKeyboardRefresh to true on Ctrl+R', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(true);
    });

    it('sets isKeyboardRefresh to true on Ctrl+R (uppercase R)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'R', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(true);
    });

    it('sets isKeyboardRefresh to true on Cmd+R (metaKey)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: false, metaKey: true });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(true);
    });

    it('does NOT set isKeyboardRefresh on arbitrary key (e.g. Enter)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'Enter', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(false);
    });

    it('does NOT set isKeyboardRefresh on Ctrl+S', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 's', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.state.isKeyboardRefresh).toBe(false);
    });
});
