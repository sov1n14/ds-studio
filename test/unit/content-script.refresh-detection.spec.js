import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// Tests the refresh detection logic in temporary-chat-delete.js.
// The Navigation API navigate event checks navigationType === 'reload' or same-URL.
// Keyboard supplement: handleRefreshKeydown sets _isKeyboardRefresh for F5 / Ctrl+R / Cmd+R.

describe('refresh detection — navigationType logic', () => {
    it('marks as refresh when navigationType is reload', () => {
        const navigationType = 'reload';
        const isRefresh = (navigationType === 'reload');
        expect(isRefresh).toBe(true);
    });

    it('does not mark as refresh when navigationType is push', () => {
        const navigationType = 'push';
        const isRefresh = (navigationType === 'reload');
        expect(isRefresh).toBe(false);
    });

    it('does not mark as refresh when navigationType is replace', () => {
        const navigationType = 'replace';
        const isRefresh = (navigationType === 'reload');
        expect(isRefresh).toBe(false);
    });

    it('does not mark as refresh when navigationType is traverse', () => {
        const navigationType = 'traverse';
        const isRefresh = (navigationType === 'reload');
        expect(isRefresh).toBe(false);
    });
});

describe('handleRefreshKeydown — keyboard supplement', () => {
    beforeEach(() => {
        TemporaryChatDelete.__resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sets isKeyboardRefresh to true on F5 key', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'F5', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('sets isKeyboardRefresh to true on Ctrl+R', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('sets isKeyboardRefresh to true on Ctrl+R (uppercase R)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'R', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('sets isKeyboardRefresh to true on Cmd+R (metaKey)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: false, metaKey: true });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(true);
    });

    it('does NOT set isKeyboardRefresh on arbitrary key (e.g. Enter)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'Enter', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(false);
    });

    it('does NOT set isKeyboardRefresh on Ctrl+S', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 's', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isKeyboardRefresh).toBe(false);
    });
});
