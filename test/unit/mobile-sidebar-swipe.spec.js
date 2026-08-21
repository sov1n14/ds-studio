/**
 * content/mobile-sidebar-swipe.js — right-swipe gesture behavior.
 *
 * The module obtains its master-switch state through the shared toggle pipeline
 * (content/feature-toggle.js -> DSS_GET_SETTINGS / DSS_SETTINGS_CHANGED),
 * delegates mobile detection to content/mobile-device.js, and waits for the
 * sidebar toggle button through content/retry-until.js. This spec drives it
 * through those seams only: the stubbed GET_SETTINGS response, SETTINGS_CHANGED
 * broadcasts, and real touch events dispatched on document.
 *
 * The mobile-detection truth table lives in test/unit/mobile-device.spec.js;
 * the retry-loop bookkeeping lives in test/unit/retry-until.spec.js. Here only
 * their observable consequence is asserted: does a swipe click the button?
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/settings-message-constants.js';

const MASTER_KEY = 'isEnabled';
const UNRELATED_KEY = 'isHideThinkingEnabled';
/** content/mobile-sidebar-swipe.js polls for the toggle button every 500ms. */
const DOM_RETRY_INTERVAL_MS = 500;

/**
 * Fresh chrome.runtime.onMessage stub (same shape as the shared mock) plus a
 * listener count, so "the listener is gone after destroy" is checkable.
 */
function createOnMessageStub() {
    const listeners = new Set();
    return {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
        callListeners: (...args) => [...listeners].forEach((fn) => fn(...args)),
        listenerCount: () => listeners.size,
    };
}

let onMessage;
let sendMessage;
let MobileSidebarSwipe;

/** Queue the values every GET_SETTINGS round trip resolves with. */
function respondWith(values) {
    sendMessage.mockImplementation((_message, callback) => {
        const response = { ok: true, values };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

/** Let the pending sendMessage promise chains settle. */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Storage-change payload shape: { key: { oldValue, newValue } }. */
function change(key, newValue, oldValue) {
    return { [key]: { oldValue, newValue } };
}

/** Deliver a SETTINGS_CHANGED broadcast the way background/settings-routes.js does. */
function broadcast(changes, area = 'local') {
    onMessage.callListeners(
        { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes },
        { id: 'test-extension-id' },
        () => {},
    );
}

// ── Navigator helpers ───────────────────────────────────────────────────────

function stubMobileNavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 2, userAgent: 'Chrome Desktop' });
}

function stubDesktopNavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Chrome Desktop' });
}

// ── DOM / gesture helpers ───────────────────────────────────────────────────

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

/** Dispatch a real touch event on document with a single touch point. */
function dispatchTouch(type, x, y) {
    const event = new Event(type, { bubbles: true });
    event.touches = [{ clientX: x, clientY: y }];
    document.dispatchEvent(event);
}

/**
 * Dispatch a gesture that satisfies every swipe condition: 70px rightward,
 * dominantly horizontal, instantaneous, starting inside the centre 80% zone.
 */
function dispatchValidRightSwipe() {
    dispatchTouch('touchstart', 300, 400);
    dispatchTouch('touchmove', 370, 410);
    dispatchTouch('touchend', 370, 410);
}

/**
 * Set up the module for direct-handler swipe testing: mobile navigator,
 * enabled, and touch bound.
 */
function setupForSwipe() {
    stubMobileNavigator();
    MobileSidebarSwipe.enabled = true;
    MobileSidebarSwipe._bindTouchEvents();
}

/**
 * (Re)load the module under test against the currently stubbed navigator and
 * GET_SETTINGS response. The module auto-starts on load, so the arrangement
 * must be in place BEFORE calling this.
 */
async function load() {
    if (MobileSidebarSwipe) MobileSidebarSwipe.destroy();

    // Fresh feature-toggle instance per load: its shared onMessage listener and
    // its registry are module state, and must attach to this test own stub.
    vi.resetModules();
    await import('../../content/mobile-device.js');
    await import('../../content/retry-until.js');
    await import('../../content/feature-toggle.js');
    const mod = await import('../../content/mobile-sidebar-swipe.js');
    MobileSidebarSwipe = mod.default ?? mod;
    await flush();
    return MobileSidebarSwipe;
}

beforeEach(async () => {
    document.body.innerHTML = '';
    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;

    stubMobileNavigator();
    MobileSidebarSwipe = null;
    // Default arrangement: registered but dormant (master switch off).
    respondWith({ [MASTER_KEY]: false });
    await load();
});

afterEach(() => {
    if (MobileSidebarSwipe) {
        MobileSidebarSwipe.destroy();
        // Tests that bind handlers by hand (setupForSwipe) bypass enable(), so
        // disable()'s guard may have skipped the unbind.
        MobileSidebarSwipe._unbindTouchEvents();
        MobileSidebarSwipe = null;
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('module constants', () => {
    it('has TRIGGER_ZONE_MARGIN_RATIO defined as 0.10', () => {
        expect(MobileSidebarSwipe.TRIGGER_ZONE_MARGIN_RATIO).toBe(0.10);
        expect(MobileSidebarSwipe.SWIPE_THRESHOLD_PX).toBe(50);
        expect(MobileSidebarSwipe.SWIPE_MAX_DURATION_MS).toBe(500);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. Desktop guard
// ─────────────────────────────────────────────────────────────────────────────

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

    it('a master-on broadcast does not arm the gesture on a desktop device', async () => {
        stubDesktopNavigator();
        respondWith({ [MASTER_KEY]: false });
        await load();

        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        broadcast(change(MASTER_KEY, true));
        dispatchValidRightSwipe();

        expect(MobileSidebarSwipe.enabled).toBe(false);
        expect(clickSpy).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. Swipe gesture recognition
// ─────────────────────────────────────────────────────────────────────────────

describe('swipe gesture', () => {
    it('triggers button click on a valid right-swipe in the center 80% zone (deltaX=70 >= 50, dominant horizontal, within duration)', () => {
        setupForSwipe();
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
        MobileSidebarSwipe._onTouchEnd();

        expect(clickSpy).toHaveBeenCalledOnce();
    });

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

    it('does NOT trigger when vertical delta dominates (|deltaY| * 1.5 > deltaX)', () => {
        setupForSwipe();
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        // deltaX = 30, deltaY = -200 -> deltaX(30) <= |deltaY|*1.5(300) -> rejected
        MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 330, clientY: 200 }] });
        MobileSidebarSwipe._onTouchEnd();

        expect(clickSpy).not.toHaveBeenCalled();
    });

    it('does NOT trigger when elapsed time exceeds SWIPE_MAX_DURATION_MS', () => {
        vi.useFakeTimers();
        setupForSwipe();

        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
        // Date.now() is now under our control; advance past the 500ms limit
        vi.advanceTimersByTime(600);
        MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
        // duration = 600ms >= 500ms -> rejected
        MobileSidebarSwipe._onTouchEnd();

        expect(clickSpy).not.toHaveBeenCalled();
    });

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
//  4. DOM readiness polling (delegated to content/retry-until.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('DOM readiness polling', () => {
    it('binds touch events once the sidebar toggle button appears on a later poll', () => {
        vi.useFakeTimers();
        MobileSidebarSwipe.enable();

        // No button in the DOM yet: nothing is bound, so a swipe does nothing.
        expect(MobileSidebarSwipe._isTouchBound).toBe(false);

        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        dispatchValidRightSwipe();
        expect(clickSpy).not.toHaveBeenCalled();

        // One poll interval later the button is found and the gesture is armed.
        vi.advanceTimersByTime(DOM_RETRY_INTERVAL_MS);

        dispatchValidRightSwipe();
        expect(clickSpy).toHaveBeenCalledOnce();
    });

    it('after disable(), a button appearing later binds nothing', () => {
        vi.useFakeTimers();
        MobileSidebarSwipe.enable();
        MobileSidebarSwipe.disable();

        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        vi.advanceTimersByTime(DOM_RETRY_INTERVAL_MS);

        dispatchValidRightSwipe();

        expect(clickSpy).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. SETTINGS_CHANGED broadcasts
// ─────────────────────────────────────────────────────────────────────────────

describe('SETTINGS_CHANGED broadcasts', () => {
    it('master switch turning on arms the gesture: a valid swipe clicks the toggle button', () => {
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        dispatchValidRightSwipe();
        expect(clickSpy).not.toHaveBeenCalled(); // dormant before the broadcast

        broadcast(change(MASTER_KEY, true));
        dispatchValidRightSwipe();

        expect(clickSpy).toHaveBeenCalledOnce();
    });

    it('master switch turning off disarms the gesture: the same swipe no longer clicks', () => {
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        broadcast(change(MASTER_KEY, true));
        dispatchValidRightSwipe();
        expect(clickSpy).toHaveBeenCalledOnce();

        broadcast(change(MASTER_KEY, false));
        dispatchValidRightSwipe();

        expect(clickSpy).toHaveBeenCalledOnce(); // no second click
    });

    it('an unrelated key leaves the dormant feature dormant', () => {
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        broadcast(change(UNRELATED_KEY, true));
        dispatchValidRightSwipe();

        expect(clickSpy).not.toHaveBeenCalled();
    });

    it('a master-switch-off change reported for the sync area is ignored', () => {
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        broadcast(change(MASTER_KEY, true));
        broadcast(change(MASTER_KEY, false), 'sync');

        dispatchValidRightSwipe();

        expect(clickSpy).toHaveBeenCalledOnce();
    });

    it('after disable(), a 500ms advance binds no touch handlers', () => {
        broadcast(change(MASTER_KEY, true));
        const button = createSidebarButton();
        const clickSpy = vi.spyOn(button, 'click');

        vi.useFakeTimers();
        broadcast(change(MASTER_KEY, false));
        vi.advanceTimersByTime(DOM_RETRY_INTERVAL_MS);

        dispatchValidRightSwipe();

        expect(MobileSidebarSwipe._isTouchBound).toBe(false);
        expect(clickSpy).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  6. Trigger zone (center 80%) — vertical rejection
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
