import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
//  Hoisted: desktop navigator before module auto-start
//  The module calls MobileSidebarSwipe.start() at module level (line 344).
//  We must ensure navigator looks like a desktop device so that auto-start
//  is a no-op (returns early from _isMobileDevice() check).
//  vi.hoisted() runs before any import, guaranteeing the mock is in place
//  before the module evaluates its top-level code.
// ─────────────────────────────────────────────────────────────────────────────
vi.hoisted(() => {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Chrome Desktop' });
});

// Side-effect import: storage-manager sets window.StorageManager at line 1376
import '../../utils/storage-manager.js';
import MobileSidebarSwipe from '../../content/mobile-sidebar-swipe.js';
import StorageManager from '../../utils/storage-manager.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function stubMobileNavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 2, userAgent: 'Chrome Desktop' });
}

function stubDesktopNavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Chrome Desktop' });
}

function stubMobileUANavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)' });
}

/**
 * Create a sidebar toggle button matching the primary selector:
 *   div.ds-button--capsule.ds-button--iconLabelPrimary[role="button"]
 */
function createSidebarButton() {
    const btn = document.createElement('div');
    btn.className = 'ds-button--capsule ds-button--iconLabelPrimary';
    btn.setAttribute('role', 'button');
    document.body.appendChild(btn);
    return btn;
}

/**
 * Set up the module for swipe testing: mobile navigator, enabled, and touch bound.
 */
function setupForSwipe() {
    stubMobileNavigator();
    MobileSidebarSwipe.enabled = true;
    MobileSidebarSwipe._bindTouchEvents();
}

// ─────────────────────────────────────────────────────────────────────────────
//  beforeEach / afterEach
//  Resets every mutable property on the module to its default value so that
//  state from one test never leaks into the next. Uses the same approach as
//  go-top.spec.js (reset in beforeEach, restore timers in afterEach) but
//  also cleans up touch listeners and globals for the added complexity of
//  this module's touch event bindings and navigator mocking.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    // Clean up any registered event listeners before resetting state
    if (MobileSidebarSwipe._touchStartHandler) {
        document.removeEventListener('touchstart', MobileSidebarSwipe._touchStartHandler);
    }
    if (MobileSidebarSwipe._touchMoveHandler) {
        document.removeEventListener('touchmove', MobileSidebarSwipe._touchMoveHandler);
    }
    if (MobileSidebarSwipe._touchEndHandler) {
        document.removeEventListener('touchend', MobileSidebarSwipe._touchEndHandler);
    }
    if (MobileSidebarSwipe._domRetryTimer) {
        clearTimeout(MobileSidebarSwipe._domRetryTimer);
    }

    // Reset all mutable state to defaults
    MobileSidebarSwipe.enabled = false;
    MobileSidebarSwipe._masterEnabled = false;
    MobileSidebarSwipe._isTouchBound = false;
    MobileSidebarSwipe._startPoint = null;
    MobileSidebarSwipe._startTime = null;
    MobileSidebarSwipe._deltaX = 0;
    MobileSidebarSwipe._deltaY = 0;
    MobileSidebarSwipe._touchStartHandler = null;
    MobileSidebarSwipe._touchMoveHandler = null;
    MobileSidebarSwipe._touchEndHandler = null;
    MobileSidebarSwipe._domRetryTimer = null;
    MobileSidebarSwipe._domRetryCount = 0;

    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. DESKTOP GUARD
//     No Touch Points, Non-mobile UA — module should not enable.
// ─────────────────────────────────────────────────────────────────────────────

describe('module constants', () => {
    it('has TRIGGER_ZONE_MARGIN_RATIO defined as 0.10', () => {
        expect(MobileSidebarSwipe.TRIGGER_ZONE_MARGIN_RATIO).toBe(0.10);
        expect(MobileSidebarSwipe.SWIPE_THRESHOLD_PX).toBe(50);
        expect(MobileSidebarSwipe.SWIPE_MAX_DURATION_MS).toBe(500);
    });
});

describe('desktop guard', () => {
    it('does NOT enable on desktop devices (maxTouchPoints=0, non-mobile UA)', () => {
        stubDesktopNavigator();
        const addListenerSpy = vi.spyOn(document, 'addEventListener');

        MobileSidebarSwipe.start();

        expect(MobileSidebarSwipe.enabled).toBe(false);
        // No 'touchstart' listener should have been registered on document
        expect(addListenerSpy).not.toHaveBeenCalledWith(
            'touchstart',
            expect.any(Function),
            expect.objectContaining({ passive: false })
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2-3. MOBILE DETECTION
//     _isMobileDevice() should return true for touch devices OR mobile UA.
// ─────────────────────────────────────────────────────────────────────────────

describe('_isMobileDevice', () => {
    it('returns true when navigator.maxTouchPoints > 0 (touch-capable device)', () => {
        stubMobileNavigator();
        expect(MobileSidebarSwipe._isMobileDevice()).toBe(true);
    });

    it('returns true when userAgent matches a known mobile pattern', () => {
        stubMobileUANavigator();
        expect(MobileSidebarSwipe._isMobileDevice()).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4-10. SWIPE DETECTION
//     Gesture recognition: valid right-swipe triggers click; various
//     rejection scenarios must not trigger a click.
// ─────────────────────────────────────────────────────────────────────────────

describe('swipe gesture', () => {
    // ── 4. FULL VALID SWIPE ──────────────────────────────────────────────────

    it('triggers button click on a valid right-swipe in the center 80% zone (deltaX=70 >= 50, dominant horizontal, within duration)', () => {
        setupForSwipe();
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
        MobileSidebarSwipe._onTouchEnd();

        expect(clickSpy).toHaveBeenCalledOnce();
    });

    // ── 5. OUTSIDE CENTER 80% ZONE (HORIZONTAL) ──────────────────────────────

    it('does NOT trigger when touch starts outside the center 80% zone (clientX too far left, < 10% of viewport)', () => {
        setupForSwipe();
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        // With TRIGGER_ZONE_MARGIN_RATIO=0.10 and innerWidth=1024:
        // minX = 102.4, maxX = 921.6. clientX=50 is left of the 10% margin,
        // so _onTouchStart rejects it immediately (_startPoint stays null).
        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 50, clientY: 400 }] });

        expect(MobileSidebarSwipe._startPoint).toBeNull();
        expect(clickSpy).not.toHaveBeenCalled();
    });

    // ── 6. WRONG DIRECTION (leftward) ────────────────────────────────────────

    it('does NOT trigger when deltaX is negative (swiping left, not right)', () => {
        setupForSwipe();
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 295, clientY: 400 }] });
        // deltaX = -5; SWIPE_THRESHOLD_PX check fails (deltaX < 50)
        MobileSidebarSwipe._onTouchEnd();

        expect(clickSpy).not.toHaveBeenCalled();
    });

    // ── 7. TOO SHORT DISTANCE ────────────────────────────────────────────────

    it('does NOT trigger when deltaX is below SWIPE_THRESHOLD_PX (25 < 50)', () => {
        setupForSwipe();
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 325, clientY: 405 }] });
        // deltaX = 25 < 50 threshold
        MobileSidebarSwipe._onTouchEnd();

        expect(clickSpy).not.toHaveBeenCalled();
    });

    // ── 8. VERTICAL DOMINANT (scroll-like) ───────────────────────────────────

    it('does NOT trigger when vertical delta dominates (|deltaY| * 1.5 > deltaX)', () => {
        setupForSwipe();
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        // deltaX = 30, deltaY = -200 → deltaX(30) <= |deltaY|*1.5(300) → rejected
        MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 330, clientY: 200 }] });
        MobileSidebarSwipe._onTouchEnd();

        expect(clickSpy).not.toHaveBeenCalled();
    });

    // ── 9. TOO SLOW (duration >= 500ms) ──────────────────────────────────────

    it('does NOT trigger when elapsed time exceeds SWIPE_MAX_DURATION_MS', () => {
        vi.useFakeTimers();
        stubMobileNavigator();
        MobileSidebarSwipe.enabled = true;
        MobileSidebarSwipe._bindTouchEvents();

        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        // Date.now() is now under our control; advance past the 500ms limit
        vi.advanceTimersByTime(600);
        MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
        // duration = 600ms >= 500ms → rejected
        MobileSidebarSwipe._onTouchEnd();

        expect(clickSpy).not.toHaveBeenCalled();
    });

    // ── 10. BUTTON NOT FOUND — no error ──────────────────────────────────────

    it('does not throw when no toggle button is in the DOM', () => {
        setupForSwipe();
        // No button added to DOM — _findButton returns null, _onTouchEnd
        // should exit gracefully without calling .click() on anything

        expect(() => {
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
        }).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  11. DOM POLLING
//      _tryConnectDom should not bind until the target button appears.
// ─────────────────────────────────────────────────────────────────────────────

describe('DOM polling (_tryConnectDom)', () => {
    it('binds touch events when button appears after initial poll failure', () => {
        stubMobileNavigator();
        MobileSidebarSwipe.enabled = true;

        // No button in DOM yet → poll should fail, no touch binding
        MobileSidebarSwipe._tryConnectDom();
        expect(MobileSidebarSwipe._isTouchBound).toBe(false);

        // Inject the sidebar toggle button
        createSidebarButton();

        // Manual retry — now button is found
        MobileSidebarSwipe._tryConnectDom();
        expect(MobileSidebarSwipe._isTouchBound).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  12-13. STORAGE LISTENER
//      _setupStorageListener should enable/disable the module when the
//      master IS_ENABLED key changes in chrome.storage.local.
// ─────────────────────────────────────────────────────────────────────────────

describe('storage listener (_setupStorageListener)', () => {
    it('disables the module when master switch is turned off (IS_ENABLED → false)', async () => {
        MobileSidebarSwipe.enabled = true;
        MobileSidebarSwipe._masterEnabled = true;
        MobileSidebarSwipe._setupStorageListener();

        // Trigger storage change via the mock; the listener fires synchronously
        // during set(), then the promise resolves on the next tick.
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(MobileSidebarSwipe.enabled).toBe(false);
    });

    it('enables the module when master switch is turned on (IS_ENABLED → true, mobile device)', async () => {
        stubMobileNavigator();
        MobileSidebarSwipe.enabled = false;
        MobileSidebarSwipe._masterEnabled = false;
        MobileSidebarSwipe._setupStorageListener();

        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
        await new Promise((resolve) => setTimeout(resolve, 10));

        // enable() sets enabled=true; also called _tryConnectDom which is a
        // no-op if no button is in DOM (does not throw)
        expect(MobileSidebarSwipe.enabled).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  14-15. TRIGGER ZONE (center 80%)
//      Touches in the top status-bar zone or bottom navigation zone
//      must be rejected (_startPoint stays null). Also rejects touches
//      outside the center 80% horizontal zone (test 5 covers that case).
// ─────────────────────────────────────────────────────────────────────────────

describe('vertical zone rejection (_onTouchStart)', () => {
    beforeEach(() => {
        stubMobileNavigator();
        MobileSidebarSwipe.enabled = true;
        // Set explicit viewport height (800px) for deterministic margin calculation:
        //   TRIGGER_ZONE_MARGIN_RATIO = 0.10
        //   minY = 800 * 0.10 = 80
        //   maxY = 800 * (1 - 0.10) = 720
        //   innerWidth defaults to 1024 (happy-dom), so minX=102.4, maxX=921.6
        Object.defineProperty(window, 'innerHeight', {
            value: 800,
            configurable: true,
            writable: true,
        });
    });

    it('rejects touches near the top status-bar area (clientY=50 < minY=80)', () => {
        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 50 }] });
        expect(MobileSidebarSwipe._startPoint).toBeNull();
    });

    it('rejects touches near the bottom navigation area (clientY=750 > maxY=720)', () => {
        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 750 }] });
        expect(MobileSidebarSwipe._startPoint).toBeNull();
    });
});
