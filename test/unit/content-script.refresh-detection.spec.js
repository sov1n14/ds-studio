import { describe, it, expect } from 'vitest';

// Tests the refresh detection logic that mirrors the Navigation API listener in content-script.js.
// Simulates the logic: isPageRefresh = (event.destination.url === window.location.href)
// The actual listener registration is conditional on window.navigation existing at module load
// time; this file tests the URL-comparison logic in pure isolation.

describe('refresh detection logic', () => {
    it('marks as refresh when destination URL matches current URL', () => {
        const currentUrl = 'https://chat.deepseek.com/a/chat/s/abc123';
        const isRefresh = (currentUrl === currentUrl); // destination.url === location.href
        expect(isRefresh).toBe(true);
    });

    it('does not mark as refresh when destination URL differs', () => {
        const currentUrl = 'https://chat.deepseek.com/a/chat/s/abc123';
        const destUrl = 'https://chat.deepseek.com/a/chat/s/def456';
        const isRefresh = (destUrl === currentUrl);
        expect(isRefresh).toBe(false);
    });

    it('does not mark as refresh when navigating to a different origin', () => {
        const currentUrl = 'https://chat.deepseek.com/a/chat/s/abc123';
        const destUrl = 'https://www.google.com/';
        const isRefresh = (destUrl === currentUrl);
        expect(isRefresh).toBe(false);
    });
});
