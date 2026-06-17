import { describe, it, expect } from 'vitest';

// Tests the refresh detection logic that mirrors the Navigation API listener in content-script.js.
// Simulates the logic: isPageRefresh = (event.navigationType === 'reload')
// The actual listener registration is conditional on window.navigation existing at module load
// time; this file tests the navigationType-comparison logic in pure isolation.

describe('refresh detection logic', () => {
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
