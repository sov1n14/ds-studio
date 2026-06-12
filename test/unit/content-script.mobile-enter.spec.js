/**
 * Unit tests for the isMobileDevice Enter key guard in content-script.js.
 *
 * Feature: When isMobileDevice() returns true, the keydown handler returns
 * early — no prefix injection and no preventDefault(). This preserves the
 * browser's default new-line behavior on mobile devices.
 *
 * Detection logic (content-script.js ~line 432):
 *   navigator.maxTouchPoints > 0 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MOBILE_UA =
    'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Override navigator.maxTouchPoints and navigator.userAgent for the duration
 * of a test. Returns a restore function.
 */
function mockNavigator({ maxTouchPoints, userAgent }) {
    const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(Navigator.prototype, 'maxTouchPoints');
    const originalUserAgent = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');

    Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        get: () => maxTouchPoints,
    });

    Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => userAgent,
    });

    return function restore() {
        if (originalMaxTouchPoints) {
            Object.defineProperty(Navigator.prototype, 'maxTouchPoints', originalMaxTouchPoints);
        }
        if (originalUserAgent) {
            Object.defineProperty(Navigator.prototype, 'userAgent', originalUserAgent);
        }
    };
}

/**
 * Dispatch a keydown event with the given options from the given target.
 * Returns the event so callers can inspect it (e.g. defaultPrevented).
 */
function dispatchKeydown(target, options = {}) {
    const ev = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        ...options,
    });
    target.dispatchEvent(ev);
    return ev;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isMobileDevice Enter key guard', () => {
    let textarea;
    let restoreNavigator;
    let preventDefaultSpy;

    beforeEach(() => {
        contentScript.__resetState();
        contentScript.__setState({ isEnabled: true, globalDefaultPrompt: 'sys' });

        // Create and focus a textarea so document.activeElement is set
        textarea = document.createElement('textarea');
        textarea.value = 'hello world';
        document.body.appendChild(textarea);
        textarea.focus();

        // Spy on Event.prototype.preventDefault to detect calls
        preventDefaultSpy = vi.spyOn(Event.prototype, 'preventDefault');
    });

    afterEach(() => {
        if (restoreNavigator) {
            restoreNavigator();
            restoreNavigator = null;
        }

        preventDefaultSpy.mockRestore();

        if (textarea && textarea.parentNode) {
            textarea.parentNode.removeChild(textarea);
        }
        textarea = null;
    });

    // -----------------------------------------------------------------------
    // TC-1: Desktop — Enter triggers injection (preventDefault is called)
    // -----------------------------------------------------------------------
    it('TC-1 DESKTOP: Enter triggers injection when maxTouchPoints=0 and desktop UA', () => {
        restoreNavigator = mockNavigator({
            maxTouchPoints: 0,
            userAgent: DESKTOP_UA,
        });

        dispatchKeydown(textarea);

        expect(preventDefaultSpy).toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // TC-2: Mobile — maxTouchPoints > 0 — Enter does NOT trigger injection
    // -----------------------------------------------------------------------
    it('TC-2 MOBILE (touch): Enter is NOT intercepted when maxTouchPoints=5', () => {
        restoreNavigator = mockNavigator({
            maxTouchPoints: 5,
            userAgent: DESKTOP_UA,
        });

        dispatchKeydown(textarea);

        expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // TC-3: Mobile — mobile UA string — Enter does NOT trigger injection
    // -----------------------------------------------------------------------
    it('TC-3 MOBILE (UA): Enter is NOT intercepted when mobile UA string is present', () => {
        restoreNavigator = mockNavigator({
            maxTouchPoints: 0,
            userAgent: MOBILE_UA,
        });

        dispatchKeydown(textarea);

        expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // TC-4: Mobile — Shift+Enter — guard is irrelevant (already excluded earlier)
    // -----------------------------------------------------------------------
    it('TC-4 SHIFT+ENTER: Shift+Enter is NOT intercepted regardless of mobile guard', () => {
        restoreNavigator = mockNavigator({
            maxTouchPoints: 5,
            userAgent: DESKTOP_UA,
        });

        dispatchKeydown(textarea, { shiftKey: true });

        expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
});
