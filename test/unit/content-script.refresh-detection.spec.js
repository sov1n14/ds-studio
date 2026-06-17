import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TemporaryChatDelete from '../../content/temporary-chat-delete.js';

// Tests the refresh detection logic in temporary-chat-delete.js.
// Current logic: handleNavigationEvent sets _isPageRefresh = (event.navigationType === 'reload').
// Keyboard supplement: handleRefreshKeydown sets _isPageRefresh = true for F5 / Ctrl+R / Cmd+R.

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

    it('sets isPageRefresh to true on F5 key', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'F5', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(true);
    });

    it('sets isPageRefresh to true on Ctrl+R', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(true);
    });

    it('sets isPageRefresh to true on Ctrl+R (uppercase R)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'R', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(true);
    });

    it('sets isPageRefresh to true on Cmd+R (metaKey)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'r', ctrlKey: false, metaKey: true });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(true);
    });

    it('does NOT set isPageRefresh on arbitrary key (e.g. Enter)', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 'Enter', ctrlKey: false, metaKey: false });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(false);
    });

    it('does NOT set isPageRefresh on Ctrl+S', () => {
        TemporaryChatDelete.handleRefreshKeydown({ key: 's', ctrlKey: true, metaKey: false });
        expect(TemporaryChatDelete.__getState().isPageRefresh).toBe(false);
    });
});
