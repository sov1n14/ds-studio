/**
 * Mobile Sidebar Swipe - Mutant Killer Tests
 *
 * Targeted tests to kill surviving Stryker mutants across:
 *   bind.js, lifecycle.js, gesture.js, button.js, mobile-sidebar-swipe.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';

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

function respondWith(values) {
    sendMessage.mockImplementation((_message, callback) => {
        const response = { ok: true, values };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function stubMobileNavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 2, userAgent: 'Chrome Desktop' });
}

function stubDesktopNavigator() {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Chrome Desktop' });
}

async function load() {
    if (MobileSidebarSwipe) MobileSidebarSwipe.destroy();
    vi.resetModules();
    await import('../../content/mobile-device.js');
    await import('../../content/retry-until.js');
    await import('../../content/feature-toggle.js');
    await import('../../content/mobile-sidebar-swipe.button.js');
    await import('../../content/mobile-sidebar-swipe.gesture.js');
    await import('../../content/mobile-sidebar-swipe.bind.js');
    await import('../../content/mobile-sidebar-swipe.lifecycle.js');
    const mod = await import('../../content/mobile-sidebar-swipe.js');
    MobileSidebarSwipe = mod.default ?? mod;
    await flush();
    return MobileSidebarSwipe;
}

function createSidebarButton() {
    const btn = document.createElement('div');
    btn.className = 'ds-button--capsule ds-button--iconLabelPrimary';
    btn.setAttribute('role', 'button');
    document.body.appendChild(btn);
    return btn;
}

function createCloseButton() {
    const btn = document.createElement('div');
    btn.className = 'ds-button--capsule ds-button--iconLabelTertiary';
    btn.setAttribute('role', 'button');
    btn.innerHTML = '<svg><path fill-rule="evenodd"></path></svg>';
    document.body.appendChild(btn);
    return btn;
}

function setupForSwipe() {
    stubMobileNavigator();
    MobileSidebarSwipe.enabled = true;
    MobileSidebarSwipe._bindTouchEvents();
}

beforeEach(async () => {
    document.body.innerHTML = '';
    onMessage = createOnMessageStub();
    sendMessage = vi.fn();
    chrome.runtime.onMessage = onMessage;
    chrome.runtime.sendMessage = sendMessage;
    stubMobileNavigator();
    MobileSidebarSwipe = null;
    respondWith({ isEnabled: false });
    await load();
});

afterEach(() => {
    if (MobileSidebarSwipe) {
        MobileSidebarSwipe.destroy();
        MobileSidebarSwipe._unbindTouchEvents();
        MobileSidebarSwipe = null;
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

// bind.js mutant killers

describe('bind.js mutant killers', () => {
    describe('_bindTouchEvents idempotency guard', () => {
        it('calling twice does not double-register listeners', () => {
            const addSpy = vi.spyOn(document, 'addEventListener');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            const firstCallCount = addSpy.mock.calls.length;
            expect(firstCallCount).toBe(3);
            MobileSidebarSwipe._bindTouchEvents();
            expect(addSpy.mock.calls.length).toBe(firstCallCount);
        });

        it('sets _isTouchBound to true after binding', () => {
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            expect(MobileSidebarSwipe._isTouchBound).toBe(true);
        });
    });

    describe('_bindTouchEvents registers correct events', () => {
        it('registers touchstart with passive:false', () => {
            const addSpy = vi.spyOn(document, 'addEventListener');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            const call = addSpy.mock.calls.find(c => c[0] === 'touchstart');
            expect(call).toBeDefined();
            expect(call[2]).toEqual({ passive: false });
        });

        it('registers touchmove with passive:true', () => {
            const addSpy = vi.spyOn(document, 'addEventListener');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            const call = addSpy.mock.calls.find(c => c[0] === 'touchmove');
            expect(call).toBeDefined();
            expect(call[2]).toEqual({ passive: true });
        });

        it('registers touchend with passive:true', () => {
            const addSpy = vi.spyOn(document, 'addEventListener');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            const call = addSpy.mock.calls.find(c => c[0] === 'touchend');
            expect(call).toBeDefined();
            expect(call[2]).toEqual({ passive: true });
        });

        it('stores handler references for later removal', () => {
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._touchStartHandler = null;
            MobileSidebarSwipe._touchMoveHandler = null;
            MobileSidebarSwipe._touchEndHandler = null;
            MobileSidebarSwipe._bindTouchEvents();
            expect(typeof MobileSidebarSwipe._touchStartHandler).toBe('function');
            expect(typeof MobileSidebarSwipe._touchMoveHandler).toBe('function');
            expect(typeof MobileSidebarSwipe._touchEndHandler).toBe('function');
        });
    });

    describe('_unbindTouchEvents', () => {
        it('is a no-op when _isTouchBound is false', () => {
            const removeSpy = vi.spyOn(document, 'removeEventListener');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._unbindTouchEvents();
            expect(removeSpy).not.toHaveBeenCalled();
        });

        it('sets _isTouchBound to false after unbinding', () => {
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            expect(MobileSidebarSwipe._isTouchBound).toBe(true);
            MobileSidebarSwipe._unbindTouchEvents();
            expect(MobileSidebarSwipe._isTouchBound).toBe(false);
        });

        it('removes all three event listeners', () => {
            const removeSpy = vi.spyOn(document, 'removeEventListener');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            MobileSidebarSwipe._unbindTouchEvents();
            const removedTypes = removeSpy.mock.calls.map(c => c[0]);
            expect(removedTypes).toContain('touchstart');
            expect(removedTypes).toContain('touchmove');
            expect(removedTypes).toContain('touchend');
        });

        it('nulls all handler references after removal', () => {
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            MobileSidebarSwipe._unbindTouchEvents();
            expect(MobileSidebarSwipe._touchStartHandler).toBeNull();
            expect(MobileSidebarSwipe._touchMoveHandler).toBeNull();
            expect(MobileSidebarSwipe._touchEndHandler).toBeNull();
        });

        it('removes the exact handler refs that were bound', () => {
            const removeSpy = vi.spyOn(document, 'removeEventListener');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            const startRef = MobileSidebarSwipe._touchStartHandler;
            const moveRef = MobileSidebarSwipe._touchMoveHandler;
            const endRef = MobileSidebarSwipe._touchEndHandler;
            MobileSidebarSwipe._unbindTouchEvents();
            expect(removeSpy).toHaveBeenCalledWith('touchstart', startRef);
            expect(removeSpy).toHaveBeenCalledWith('touchmove', moveRef);
            expect(removeSpy).toHaveBeenCalledWith('touchend', endRef);
        });

        it('skips removeEventListener for handlers already null', () => {
            const removeSpy = vi.spyOn(document, 'removeEventListener');
            MobileSidebarSwipe._isTouchBound = true;
            MobileSidebarSwipe._touchStartHandler = null;
            MobileSidebarSwipe._touchMoveHandler = null;
            MobileSidebarSwipe._touchEndHandler = null;
            MobileSidebarSwipe._unbindTouchEvents();
            expect(removeSpy).not.toHaveBeenCalled();
            expect(MobileSidebarSwipe._isTouchBound).toBe(false);
        });
    });

    describe('bound handlers delegate correctly', () => {
        it('touchstart handler calls _onTouchStart with the event', () => {
            const spy = vi.spyOn(MobileSidebarSwipe, '_onTouchStart');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            const fakeEvent = { touches: [{ clientX: 100, clientY: 100 }] };
            MobileSidebarSwipe._touchStartHandler(fakeEvent);
            expect(spy).toHaveBeenCalledWith(fakeEvent);
        });

        it('touchmove handler calls _onTouchMove with the event', () => {
            const spy = vi.spyOn(MobileSidebarSwipe, '_onTouchMove');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            const fakeEvent = { touches: [{ clientX: 200, clientY: 200 }] };
            MobileSidebarSwipe._touchMoveHandler(fakeEvent);
            expect(spy).toHaveBeenCalledWith(fakeEvent);
        });

        it('touchend handler calls _onTouchEnd', () => {
            const spy = vi.spyOn(MobileSidebarSwipe, '_onTouchEnd');
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._bindTouchEvents();
            MobileSidebarSwipe._touchEndHandler();
            expect(spy).toHaveBeenCalledOnce();
        });
    });
});

// lifecycle.js mutant killers

describe('lifecycle.js mutant killers', () => {
    describe('enable()', () => {
        it('is a no-op on desktop - enabled stays false', () => {
            stubDesktopNavigator();
            MobileSidebarSwipe.enabled = false;
            MobileSidebarSwipe.enable();
            expect(MobileSidebarSwipe.enabled).toBe(false);
        });

        it('is a no-op when already enabled - does not call _tryConnectDom again', () => {
            stubMobileNavigator();
            const spy = vi.spyOn(MobileSidebarSwipe, '_tryConnectDom');
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe.enable();
            expect(spy).not.toHaveBeenCalled();
        });

        it('sets enabled=true on mobile when previously disabled', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = false;
            MobileSidebarSwipe.enable();
            expect(MobileSidebarSwipe.enabled).toBe(true);
        });

        it('calls _tryConnectDom on first enable', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = false;
            const spy = vi.spyOn(MobileSidebarSwipe, '_tryConnectDom');
            MobileSidebarSwipe.enable();
            expect(spy).toHaveBeenCalledOnce();
        });
    });

    describe('disable()', () => {
        it('is a no-op when already disabled', () => {
            MobileSidebarSwipe.enabled = false;
            const unbindSpy = vi.spyOn(MobileSidebarSwipe, '_unbindTouchEvents');
            const cancelSpy = vi.spyOn(MobileSidebarSwipe, '_cancelDomRetry');
            const resetSpy = vi.spyOn(MobileSidebarSwipe, '_resetSwipeState');
            MobileSidebarSwipe.disable();
            expect(unbindSpy).not.toHaveBeenCalled();
            expect(cancelSpy).not.toHaveBeenCalled();
            expect(resetSpy).not.toHaveBeenCalled();
        });

        it('sets enabled=false', () => {
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe.disable();
            expect(MobileSidebarSwipe.enabled).toBe(false);
        });

        it('calls _unbindTouchEvents', () => {
            MobileSidebarSwipe.enabled = true;
            const spy = vi.spyOn(MobileSidebarSwipe, '_unbindTouchEvents');
            MobileSidebarSwipe.disable();
            expect(spy).toHaveBeenCalledOnce();
        });

        it('calls _cancelDomRetry', () => {
            MobileSidebarSwipe.enabled = true;
            const spy = vi.spyOn(MobileSidebarSwipe, '_cancelDomRetry');
            MobileSidebarSwipe.disable();
            expect(spy).toHaveBeenCalledOnce();
        });

        it('calls _resetSwipeState', () => {
            MobileSidebarSwipe.enabled = true;
            const spy = vi.spyOn(MobileSidebarSwipe, '_resetSwipeState');
            MobileSidebarSwipe.disable();
            expect(spy).toHaveBeenCalledOnce();
        });
    });

    describe('destroy()', () => {
        it('calls disable()', () => {
            const spy = vi.spyOn(MobileSidebarSwipe, 'disable');
            MobileSidebarSwipe.destroy();
            expect(spy).toHaveBeenCalledOnce();
        });

        it('calls _unregisterToggle if it exists', () => {
            const unregister = vi.fn();
            MobileSidebarSwipe._unregisterToggle = unregister;
            MobileSidebarSwipe.destroy();
            expect(unregister).toHaveBeenCalledOnce();
        });

        it('nulls _unregisterToggle after calling it', () => {
            MobileSidebarSwipe._unregisterToggle = vi.fn();
            MobileSidebarSwipe.destroy();
            expect(MobileSidebarSwipe._unregisterToggle).toBeNull();
        });

        it('does not throw when _unregisterToggle is null', () => {
            MobileSidebarSwipe._unregisterToggle = null;
            expect(() => MobileSidebarSwipe.destroy()).not.toThrow();
        });
    });

    describe('start()', () => {
        it('is a no-op on desktop - _unregisterToggle stays null', () => {
            stubDesktopNavigator();
            MobileSidebarSwipe._unregisterToggle = null;
            MobileSidebarSwipe.start();
            expect(MobileSidebarSwipe._unregisterToggle).toBeNull();
        });

        it('sets _unregisterToggle to the returned function', () => {
            stubMobileNavigator();
            MobileSidebarSwipe._unregisterToggle = null;
            MobileSidebarSwipe.start();
            expect(typeof MobileSidebarSwipe._unregisterToggle).toBe('function');
        });
    });

    describe('_cancelDomRetry()', () => {
        it('is a no-op when _domRetryCancel is null', () => {
            MobileSidebarSwipe._domRetryCancel = null;
            expect(() => MobileSidebarSwipe._cancelDomRetry()).not.toThrow();
            expect(MobileSidebarSwipe._domRetryCancel).toBeNull();
        });

        it('calls the cancel function and nulls the reference', () => {
            const cancel = vi.fn();
            MobileSidebarSwipe._domRetryCancel = cancel;
            MobileSidebarSwipe._cancelDomRetry();
            expect(cancel).toHaveBeenCalledOnce();
            expect(MobileSidebarSwipe._domRetryCancel).toBeNull();
        });
    });

    describe('_resetSwipeState()', () => {
        it('resets _startPoint to null', () => {
            MobileSidebarSwipe._startPoint = { x: 100, y: 200 };
            MobileSidebarSwipe._resetSwipeState();
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });

        it('resets _startTime to null', () => {
            MobileSidebarSwipe._startTime = 12345;
            MobileSidebarSwipe._resetSwipeState();
            expect(MobileSidebarSwipe._startTime).toBeNull();
        });

        it('resets _deltaX to 0', () => {
            MobileSidebarSwipe._deltaX = 75;
            MobileSidebarSwipe._resetSwipeState();
            expect(MobileSidebarSwipe._deltaX).toBe(0);
        });

        it('resets _deltaY to 0', () => {
            MobileSidebarSwipe._deltaY = -50;
            MobileSidebarSwipe._resetSwipeState();
            expect(MobileSidebarSwipe._deltaY).toBe(0);
        });
    });
});

// gesture.js mutant killers

describe('gesture.js mutant killers', () => {
    describe('_onTouchStart guards', () => {
        it('no-op when enabled is false', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = false;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });

        it('no-op when not on mobile device', () => {
            stubDesktopNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });

        it('no-op when touches array is empty', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._onTouchStart({ touches: [] });
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });
    });

    describe('_onTouchStart zone boundary conditions', () => {
        beforeEach(() => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
        });

        it('accepts touch exactly at minX boundary', () => {
            const minX = window.innerWidth * 0.10;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: minX, clientY: 400 }] });
            expect(MobileSidebarSwipe._startPoint).not.toBeNull();
            expect(MobileSidebarSwipe._startPoint.x).toBe(minX);
        });

        it('rejects touch just below minX boundary', () => {
            const justBelow = window.innerWidth * 0.10 - 0.01;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: justBelow, clientY: 400 }] });
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });

        it('accepts touch exactly at maxX boundary', () => {
            const maxX = window.innerWidth * (1 - 0.10);
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: maxX, clientY: 400 }] });
            expect(MobileSidebarSwipe._startPoint).not.toBeNull();
        });

        it('rejects touch just above maxX boundary', () => {
            const justAbove = window.innerWidth * (1 - 0.10) + 0.01;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: justAbove, clientY: 400 }] });
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });

        it('accepts touch exactly at minY boundary', () => {
            const minY = window.innerHeight * 0.10;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: minY }] });
            expect(MobileSidebarSwipe._startPoint).not.toBeNull();
            expect(MobileSidebarSwipe._startPoint.y).toBe(minY);
        });

        it('rejects touch just below minY boundary', () => {
            const justBelow = window.innerHeight * 0.10 - 0.01;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: justBelow }] });
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });

        it('accepts touch exactly at maxY boundary', () => {
            const maxY = window.innerHeight * (1 - 0.10);
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: maxY }] });
            expect(MobileSidebarSwipe._startPoint).not.toBeNull();
        });

        it('rejects touch just above maxY boundary', () => {
            const justAbove = window.innerHeight * (1 - 0.10) + 0.01;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: justAbove }] });
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });
    });

    describe('_onTouchStart state initialization', () => {
        it('records startPoint with correct x and y', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            expect(MobileSidebarSwipe._startPoint).toEqual({ x: 300, y: 400 });
        });

        it('sets _startTime to Date.now()', () => {
            vi.useFakeTimers();
            const now = Date.now();
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            expect(MobileSidebarSwipe._startTime).toBe(now);
        });

        it('resets _deltaX and _deltaY to 0', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._deltaX = 99;
            MobileSidebarSwipe._deltaY = -77;
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            expect(MobileSidebarSwipe._deltaX).toBe(0);
            expect(MobileSidebarSwipe._deltaY).toBe(0);
        });
    });

    describe('_onTouchMove guards', () => {
        it('no-op when disabled', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = false;
            MobileSidebarSwipe._startPoint = { x: 300, y: 400 };
            MobileSidebarSwipe._deltaX = 0;
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            expect(MobileSidebarSwipe._deltaX).toBe(0);
        });

        it('no-op when not mobile', () => {
            stubDesktopNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._startPoint = { x: 300, y: 400 };
            MobileSidebarSwipe._deltaX = 0;
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            expect(MobileSidebarSwipe._deltaX).toBe(0);
        });

        it('no-op when _startPoint is null', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._startPoint = null;
            MobileSidebarSwipe._deltaX = 0;
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            expect(MobileSidebarSwipe._deltaX).toBe(0);
        });

        it('no-op when touches is empty', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._startPoint = { x: 300, y: 400 };
            MobileSidebarSwipe._deltaX = 0;
            MobileSidebarSwipe._onTouchMove({ touches: [] });
            expect(MobileSidebarSwipe._deltaX).toBe(0);
        });
    });

    describe('_onTouchMove delta calculation', () => {
        it('computes _deltaX as touch.clientX - startPoint.x', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._startPoint = { x: 300, y: 400 };
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 375, clientY: 410 }] });
            expect(MobileSidebarSwipe._deltaX).toBe(75);
        });

        it('computes _deltaY as touch.clientY - startPoint.y', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._startPoint = { x: 300, y: 400 };
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 375, clientY: 385 }] });
            expect(MobileSidebarSwipe._deltaY).toBe(-15);
        });

        it('computes negative _deltaX for leftward movement', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._startPoint = { x: 300, y: 400 };
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 230, clientY: 400 }] });
            expect(MobileSidebarSwipe._deltaX).toBe(-70);
        });
    });

    describe('_onTouchEnd guards', () => {
        it('no-op when disabled', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = false;
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            MobileSidebarSwipe._startPoint = { x: 300, y: 400 };
            MobileSidebarSwipe._deltaX = 70;
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).not.toHaveBeenCalled();
        });

        it('no-op when not mobile', () => {
            stubDesktopNavigator();
            MobileSidebarSwipe.enabled = true;
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            MobileSidebarSwipe._startPoint = { x: 300, y: 400 };
            MobileSidebarSwipe._deltaX = 70;
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).not.toHaveBeenCalled();
        });

        it('no-op when _startPoint is null', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            MobileSidebarSwipe._startPoint = null;
            MobileSidebarSwipe._deltaX = 70;
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).not.toHaveBeenCalled();
        });
    });

    describe('_onTouchEnd resets state after processing', () => {
        it('resets _startPoint to null even on successful swipe', () => {
            setupForSwipe();
            createSidebarButton();
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });

        it('resets _startTime to null after processing', () => {
            setupForSwipe();
            createSidebarButton();
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(MobileSidebarSwipe._startTime).toBeNull();
        });

        it('resets _deltaX to 0 after processing', () => {
            setupForSwipe();
            createSidebarButton();
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(MobileSidebarSwipe._deltaX).toBe(0);
        });

        it('resets _deltaY to 0 after processing', () => {
            setupForSwipe();
            createSidebarButton();
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(MobileSidebarSwipe._deltaY).toBe(0);
        });
    });

    describe('_onTouchEnd threshold boundary conditions', () => {
        it('does NOT trigger at exactly threshold-1 (49px)', () => {
            setupForSwipe();
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 349, clientY: 400 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).not.toHaveBeenCalled();
        });

        it('triggers at exactly threshold (50px)', () => {
            setupForSwipe();
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 350, clientY: 400 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).toHaveBeenCalledOnce();
        });
    });

    describe('_onTouchEnd horizontal dominance boundary', () => {
        it('rejects when |deltaX| exactly equals |deltaY|*1.5', () => {
            setupForSwipe();
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            // deltaX=60, deltaY=40: absDeltaX(60) <= abs(40)*1.5(60) -> rejected
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 360, clientY: 440 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).not.toHaveBeenCalled();
        });

        it('accepts when |deltaX| is just above |deltaY|*1.5', () => {
            setupForSwipe();
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            // deltaX=61, deltaY=40: absDeltaX(61) > abs(40)*1.5(60) -> accepted
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 361, clientY: 440 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).toHaveBeenCalledOnce();
        });
    });

    describe('_onTouchEnd duration boundary', () => {
        it('triggers at 499ms (just under max)', () => {
            vi.useFakeTimers();
            setupForSwipe();
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            vi.advanceTimersByTime(499);
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).toHaveBeenCalledOnce();
        });

        it('does NOT trigger at exactly 500ms (>= max)', () => {
            vi.useFakeTimers();
            setupForSwipe();
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            vi.advanceTimersByTime(500);
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).not.toHaveBeenCalled();
        });
    });

    describe('_onTouchEnd zone re-check', () => {
        it('rejects when startX is outside zone in touchend re-check', () => {
            setupForSwipe();
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            // Set state as if touchstart accepted at x=950 in a wider viewport
            MobileSidebarSwipe._startPoint = { x: 950, y: 400 };
            MobileSidebarSwipe._startTime = Date.now();
            MobileSidebarSwipe._deltaX = 70;
            MobileSidebarSwipe._deltaY = 5;
            // innerWidth=1024 -> maxX=921.6, x=950 is out of zone
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).not.toHaveBeenCalled();
        });

        it('rejects when startY is outside zone in touchend re-check', () => {
            setupForSwipe();
            const button = createSidebarButton();
            const clickSpy = vi.spyOn(button, 'click');
            Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
            // minY=80, maxY=720 -> y=750 is outside
            MobileSidebarSwipe._startPoint = { x: 300, y: 750 };
            MobileSidebarSwipe._startTime = Date.now();
            MobileSidebarSwipe._deltaX = 70;
            MobileSidebarSwipe._deltaY = 5;
            MobileSidebarSwipe._onTouchEnd();
            expect(clickSpy).not.toHaveBeenCalled();
        });
    });

    describe('_onTouchEnd direction routing', () => {
        it('deltaX > 0 calls _findButton (open sidebar)', () => {
            setupForSwipe();
            const findSpy = vi.spyOn(MobileSidebarSwipe, '_findButton').mockReturnValue(null);
            const findCloseSpy = vi.spyOn(MobileSidebarSwipe, '_findCloseButton');
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 370, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(findSpy).toHaveBeenCalledOnce();
            expect(findCloseSpy).not.toHaveBeenCalled();
        });

        it('deltaX < 0 calls _findCloseButton (close sidebar)', () => {
            setupForSwipe();
            const findSpy = vi.spyOn(MobileSidebarSwipe, '_findButton');
            const findCloseSpy = vi.spyOn(MobileSidebarSwipe, '_findCloseButton').mockReturnValue(null);
            MobileSidebarSwipe._onTouchStart({ touches: [{ clientX: 370, clientY: 400 }] });
            MobileSidebarSwipe._onTouchMove({ touches: [{ clientX: 300, clientY: 410 }] });
            MobileSidebarSwipe._onTouchEnd();
            expect(findCloseSpy).toHaveBeenCalledOnce();
            expect(findSpy).not.toHaveBeenCalled();
        });
    });
});

// button.js mutant killers

describe('button.js mutant killers', () => {
    describe('_findButton fallback cascade', () => {
        it('returns primary match (capsule + iconLabelPrimary + role=button) first', () => {
            setupForSwipe();
            const primary = createSidebarButton();
            const fallback = document.createElement('div');
            fallback.className = 'ds-button--capsule ds-button--icon';
            document.body.appendChild(fallback);
            expect(MobileSidebarSwipe._findButton()).toBe(primary);
        });

        it('falls back to capsule+iconLabelPrimary when role=button is absent', () => {
            setupForSwipe();
            const el = document.createElement('div');
            el.className = 'ds-button--capsule ds-button--iconLabelPrimary';
            document.body.appendChild(el);
            expect(MobileSidebarSwipe._findButton()).toBe(el);
        });

        it('falls back to capsule+ds-button--icon', () => {
            setupForSwipe();
            const el = document.createElement('div');
            el.className = 'ds-button--capsule ds-button--icon';
            document.body.appendChild(el);
            expect(MobileSidebarSwipe._findButton()).toBe(el);
        });

        it('falls back to iconLabelPrimary+ds-button--icon', () => {
            setupForSwipe();
            const el = document.createElement('div');
            el.className = 'ds-button--iconLabelPrimary ds-button--icon';
            document.body.appendChild(el);
            expect(MobileSidebarSwipe._findButton()).toBe(el);
        });

        it('falls back to capsule[role=button]', () => {
            setupForSwipe();
            const el = document.createElement('div');
            el.className = 'ds-button--capsule';
            el.setAttribute('role', 'button');
            document.body.appendChild(el);
            expect(MobileSidebarSwipe._findButton()).toBe(el);
        });

        it('falls back to ds-button--xl[role=button]', () => {
            setupForSwipe();
            const el = document.createElement('div');
            el.className = 'ds-button--xl';
            el.setAttribute('role', 'button');
            document.body.appendChild(el);
            expect(MobileSidebarSwipe._findButton()).toBe(el);
        });

        it('returns null when no selector matches', () => {
            setupForSwipe();
            expect(MobileSidebarSwipe._findButton()).toBeNull();
        });

        it('higher-priority fallback wins over lower', () => {
            setupForSwipe();
            const low = document.createElement('div');
            low.className = 'ds-button--xl';
            low.setAttribute('role', 'button');
            document.body.appendChild(low);
            const high = document.createElement('div');
            high.className = 'ds-button--capsule ds-button--iconLabelPrimary';
            document.body.appendChild(high);
            expect(MobileSidebarSwipe._findButton()).toBe(high);
        });
    });

    describe('_findCloseButton fallback 1 length guard', () => {
        it('returns last element when querySelectorAll length > 1', () => {
            setupForSwipe();
            const first = document.createElement('div');
            first.className = 'ds-button--capsule ds-button--iconLabelTertiary';
            first.setAttribute('role', 'button');
            document.body.appendChild(first);
            const second = document.createElement('div');
            second.className = 'ds-button--capsule ds-button--iconLabelTertiary';
            second.setAttribute('role', 'button');
            document.body.appendChild(second);
            const third = document.createElement('div');
            third.className = 'ds-button--capsule ds-button--iconLabelTertiary';
            third.setAttribute('role', 'button');
            document.body.appendChild(third);
            expect(MobileSidebarSwipe._findCloseButton()).toBe(third);
        });
    });

    describe('_tryConnectDom', () => {
        it('is a no-op when not enabled', () => {
            MobileSidebarSwipe.enabled = false;
            const cancelSpy = vi.spyOn(MobileSidebarSwipe, '_cancelDomRetry');
            MobileSidebarSwipe._tryConnectDom();
            expect(cancelSpy).not.toHaveBeenCalled();
        });

        it('cancels existing DOM retry before starting a new one', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            const cancelSpy = vi.spyOn(MobileSidebarSwipe, '_cancelDomRetry');
            MobileSidebarSwipe._tryConnectDom();
            expect(cancelSpy).toHaveBeenCalledOnce();
        });

        it('sets _domRetryCancel to a cancel function', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._domRetryCancel = null;
            MobileSidebarSwipe._tryConnectDom();
            expect(typeof MobileSidebarSwipe._domRetryCancel).toBe('function');
        });

        it('binds touch events when button is already in DOM', () => {
            vi.useFakeTimers();
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._isTouchBound = false;
            createSidebarButton();
            MobileSidebarSwipe._tryConnectDom();
            expect(MobileSidebarSwipe._isTouchBound).toBe(true);
        });

        it('does not bind touch events when button is missing from DOM', () => {
            stubMobileNavigator();
            MobileSidebarSwipe.enabled = true;
            MobileSidebarSwipe._isTouchBound = false;
            MobileSidebarSwipe._tryConnectDom();
            expect(MobileSidebarSwipe._isTouchBound).toBe(false);
        });
    });
});

// mobile-sidebar-swipe.js (entry) mutant killers

describe('mobile-sidebar-swipe.js entry mutant killers', () => {
    describe('constants', () => {
        it('DOM_RETRY_INTERVAL_MS is 500', () => {
            expect(MobileSidebarSwipe.DOM_RETRY_INTERVAL_MS).toBe(500);
        });

        it('DOM_MAX_RETRIES is 60', () => {
            expect(MobileSidebarSwipe.DOM_MAX_RETRIES).toBe(60);
        });

        it('SWIPE_THRESHOLD_PX is exactly 50', () => {
            expect(MobileSidebarSwipe.SWIPE_THRESHOLD_PX).toBe(50);
        });

        it('SWIPE_MAX_DURATION_MS is exactly 500', () => {
            expect(MobileSidebarSwipe.SWIPE_MAX_DURATION_MS).toBe(500);
        });

        it('TRIGGER_ZONE_MARGIN_RATIO is exactly 0.10', () => {
            expect(MobileSidebarSwipe.TRIGGER_ZONE_MARGIN_RATIO).toBe(0.10);
        });
    });

    describe('initial state', () => {
        it('enabled starts as false', async () => {
            respondWith({ isEnabled: false });
            const mod = await load();
            expect(mod.enabled).toBe(false);
        });

        it('_isTouchBound starts as false', () => {
            expect(MobileSidebarSwipe._isTouchBound).toBe(false);
        });

        it('_startPoint starts as null', () => {
            expect(MobileSidebarSwipe._startPoint).toBeNull();
        });
    });

    describe('sub-module integration', () => {
        it('has _findButton from button sub-module', () => {
            expect(typeof MobileSidebarSwipe._findButton).toBe('function');
        });

        it('has _onTouchStart from gesture sub-module', () => {
            expect(typeof MobileSidebarSwipe._onTouchStart).toBe('function');
        });

        it('has _bindTouchEvents from bind sub-module', () => {
            expect(typeof MobileSidebarSwipe._bindTouchEvents).toBe('function');
        });

        it('has enable from lifecycle sub-module', () => {
            expect(typeof MobileSidebarSwipe.enable).toBe('function');
        });

        it('has _mobileDevice reference', () => {
            expect(MobileSidebarSwipe._mobileDevice).toBeDefined();
            expect(typeof MobileSidebarSwipe._mobileDevice.isMobileDevice).toBe('function');
        });

        it('has _featureToggle reference', () => {
            expect(MobileSidebarSwipe._featureToggle).toBeDefined();
            expect(typeof MobileSidebarSwipe._featureToggle.registerFeatureToggle).toBe('function');
        });
    });

    describe('window exposure', () => {
        it('exposes MobileSidebarSwipe on window.DSstudio', () => {
            expect(window.DSstudio.MobileSidebarSwipe).toBe(MobileSidebarSwipe);
        });
    });
});
