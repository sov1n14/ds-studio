/**
 * Unit tests for the isMobileDevice Enter key guard in content-script.js.
 *
 * Feature: When isMobileDevice() returns true, the keydown handler returns
 * early — no prefix injection and no preventDefault(). This preserves the
 * browser's default new-line behavior on mobile devices.
 *
 * Mobile is the form factor from the user agent (Android / iPhone / iPad / Mobi), not reported touch points: a Windows desktop that reports touch points is a desktop and its Enter MUST be intercepted and prefixed.
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

// Exact UA from the bug-report runtime log: a Windows desktop with no touch hardware that reports maxTouchPoints 10.
const WINDOWS_TOUCH_EDGE_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';

const MOBILE_UA =
    'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Override navigator.maxTouchPoints, navigator.userAgent and navigator.platform for the duration of a test. Returns a restore function.
 */
function mockNavigator({ maxTouchPoints, userAgent, platform = '' }) {
    const fields = { maxTouchPoints, userAgent, platform };
    for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(navigator, key, { configurable: true, get: () => value });
    }

    // The overrides are own properties of the navigator instance; deleting them re-exposes the prototype getters.
    return function restore() {
        for (const key of Object.keys(fields)) delete navigator[key];
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
        Object.assign(contentScript.state, { isEnabled: false, promptPrefix: "", globalDefaultPrompt: "", isGlobalPromptEnabled: true, isShowSystemTime: false, isInjecting: false, currentChatUuid: null, chatPresetMap: {}, pendingPresetId: null, awaitingNewChatUuid: false, awaitingNewChatUuidTimer: null });
        contentScript.state.isEnabled = true;
        contentScript.state.globalDefaultPrompt = 'sys';

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
    // TC-2: Windows desktop reporting touch points — touch points are not mobile — Enter IS intercepted and prefixed
    // -----------------------------------------------------------------------
    it('TC-2 DESKTOP WITH TOUCH POINTS: Enter is intercepted and the prefix injected on a Windows desktop reporting maxTouchPoints=10', () => {
        restoreNavigator = mockNavigator({
            maxTouchPoints: 10,
            userAgent: WINDOWS_TOUCH_EDGE_UA,
            platform: 'Win32',
        });

        const ev = dispatchKeydown(textarea);

        expect(ev.defaultPrevented, 'the native send must be swallowed so the prefixed text is sent instead').toBe(true);
        expect(textarea.value, 'the global default prompt must be injected in front of the user text').toMatch(/sys[\s\S]*hello world/);
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
