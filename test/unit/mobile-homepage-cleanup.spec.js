import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
//  Hoisted: stub a desktop navigator before the module is imported.
//  mobile-homepage-cleanup.js does not call start() at the top level, so this
//  is only needed to keep _isMobileDevice() returning a predictable value
//  during the module evaluation phase.
// ─────────────────────────────────────────────────────────────────────────────
vi.hoisted(() => {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Chrome Desktop' });
});

// Side-effect import: sets window.StorageManager before module is evaluated
import '../../utils/storage-manager.js';
import MobileHomepageCleanup from '../../content/mobile-homepage-cleanup.js';
import StorageManager from '../../utils/storage-manager.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Navigator helpers
// ─────────────────────────────────────────────────────────────────────────────

function stubMobileTouch() {
    vi.stubGlobal('navigator', { maxTouchPoints: 2, userAgent: 'Chrome Desktop' });
}

function stubMobileUA(ua = 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36') {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: ua });
}

function stubDesktop() {
    vi.stubGlobal('navigator', { maxTouchPoints: 0, userAgent: 'Mozilla/5.0 Chrome Desktop' });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Location helpers
// ─────────────────────────────────────────────────────────────────────────────

function stubHomepage() {
    vi.stubGlobal('location', { pathname: '/' });
}

function stubNonHomepage(path = '/a/chat/s/some-uuid') {
    vi.stubGlobal('location', { pathname: path });
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOM helper: add elements with the target class
// ─────────────────────────────────────────────────────────────────────────────

function addTargetElements(count = 1) {
    const els = [];
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = '_9579690';
        document.body.appendChild(el);
        els.push(el);
    }
    return els;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reset module state
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    // Forcibly disable without going through the enable/disable guards
    if (MobileHomepageCleanup._observer) {
        MobileHomepageCleanup._observer.disconnect();
        MobileHomepageCleanup._observer = null;
    }
    MobileHomepageCleanup.enabled = false;
    MobileHomepageCleanup._masterEnabled = false;
    document.body.innerHTML = '';
    stubDesktop();
    stubHomepage();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    if (MobileHomepageCleanup._observer) {
        MobileHomepageCleanup._observer.disconnect();
        MobileHomepageCleanup._observer = null;
    }
    MobileHomepageCleanup.enabled = false;
    MobileHomepageCleanup._masterEnabled = false;
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. _isMobileDevice()
// ─────────────────────────────────────────────────────────────────────────────

describe('_isMobileDevice()', () => {
    it('returns true when navigator.maxTouchPoints > 0', () => {
        stubMobileTouch();
        expect(MobileHomepageCleanup._isMobileDevice()).toBe(true);
    });

    it('returns true when UA contains "Mobi"', () => {
        stubMobileUA('Mozilla/5.0 (Linux; Android 10; Mobi) AppleWebKit');
        expect(MobileHomepageCleanup._isMobileDevice()).toBe(true);
    });

    it('returns true when UA contains "Android"', () => {
        stubMobileUA('Mozilla/5.0 (Linux; Android 12; Pixel 6)');
        expect(MobileHomepageCleanup._isMobileDevice()).toBe(true);
    });

    it('returns true when UA contains "iPhone"', () => {
        stubMobileUA('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)');
        expect(MobileHomepageCleanup._isMobileDevice()).toBe(true);
    });

    it('returns true when UA contains "iPad"', () => {
        stubMobileUA('Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)');
        expect(MobileHomepageCleanup._isMobileDevice()).toBe(true);
    });

    it('returns false when maxTouchPoints is 0 and UA has no mobile keyword', () => {
        stubDesktop();
        expect(MobileHomepageCleanup._isMobileDevice()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. _isHomepage()
// ─────────────────────────────────────────────────────────────────────────────

describe('_isHomepage()', () => {
    it('returns true when pathname is "/"', () => {
        stubHomepage();
        expect(MobileHomepageCleanup._isHomepage()).toBe(true);
    });

    it('returns false for a chat pathname', () => {
        stubNonHomepage('/a/chat/s/some-uuid');
        expect(MobileHomepageCleanup._isHomepage()).toBe(false);
    });

    it('returns false for any non-root pathname', () => {
        stubNonHomepage('/settings');
        expect(MobileHomepageCleanup._isHomepage()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. _removeTargetElements()
// ─────────────────────────────────────────────────────────────────────────────

describe('_removeTargetElements()', () => {
    it('removes all elements with class _9579690 from the DOM', () => {
        addTargetElements(3);
        expect(document.querySelectorAll('._9579690').length).toBe(3);
        MobileHomepageCleanup._removeTargetElements();
        expect(document.querySelectorAll('._9579690').length).toBe(0);
    });

    it('does nothing if no target elements exist', () => {
        expect(() => MobileHomepageCleanup._removeTargetElements()).not.toThrow();
        expect(document.querySelectorAll('._9579690').length).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. enable()
// ─────────────────────────────────────────────────────────────────────────────

describe('enable()', () => {
    it('does nothing if not a mobile device', () => {
        stubDesktop();
        MobileHomepageCleanup.enable();
        expect(MobileHomepageCleanup.enabled).toBe(false);
        expect(MobileHomepageCleanup._observer).toBeNull();
    });

    it('is idempotent — does nothing if already enabled', () => {
        stubMobileTouch();
        MobileHomepageCleanup.enable(); // first call
        const observer = MobileHomepageCleanup._observer;
        const removeSpy = vi.spyOn(MobileHomepageCleanup, '_removeTargetElements');
        MobileHomepageCleanup.enable(); // second call — should be a no-op
        expect(removeSpy).not.toHaveBeenCalled();
        expect(MobileHomepageCleanup._observer).toBe(observer);
    });

    it('sets enabled = true', () => {
        stubMobileTouch();
        MobileHomepageCleanup.enable();
        expect(MobileHomepageCleanup.enabled).toBe(true);
    });

    it('calls _removeTargetElements() when on the homepage', () => {
        stubMobileTouch();
        stubHomepage();
        const removeSpy = vi.spyOn(MobileHomepageCleanup, '_removeTargetElements');
        MobileHomepageCleanup.enable();
        expect(removeSpy).toHaveBeenCalledOnce();
    });

    it('does NOT call _removeTargetElements() when not on the homepage', () => {
        stubMobileTouch();
        stubNonHomepage();
        const removeSpy = vi.spyOn(MobileHomepageCleanup, '_removeTargetElements');
        MobileHomepageCleanup.enable();
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('calls _startObserver()', () => {
        stubMobileTouch();
        const startSpy = vi.spyOn(MobileHomepageCleanup, '_startObserver');
        MobileHomepageCleanup.enable();
        expect(startSpy).toHaveBeenCalledOnce();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. disable()
// ─────────────────────────────────────────────────────────────────────────────

describe('disable()', () => {
    it('is idempotent — does nothing if not enabled', () => {
        const stopSpy = vi.spyOn(MobileHomepageCleanup, '_stopObserver');
        MobileHomepageCleanup.disable();
        expect(stopSpy).not.toHaveBeenCalled();
        expect(MobileHomepageCleanup.enabled).toBe(false);
    });

    it('sets enabled = false', () => {
        stubMobileTouch();
        MobileHomepageCleanup.enable();
        expect(MobileHomepageCleanup.enabled).toBe(true);
        MobileHomepageCleanup.disable();
        expect(MobileHomepageCleanup.enabled).toBe(false);
    });

    it('calls _stopObserver()', () => {
        stubMobileTouch();
        MobileHomepageCleanup.enable();
        const stopSpy = vi.spyOn(MobileHomepageCleanup, '_stopObserver');
        MobileHomepageCleanup.disable();
        expect(stopSpy).toHaveBeenCalledOnce();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  6. destroy()
// ─────────────────────────────────────────────────────────────────────────────

describe('destroy()', () => {
    it('calls disable()', () => {
        stubMobileTouch();
        MobileHomepageCleanup.enable();
        const disableSpy = vi.spyOn(MobileHomepageCleanup, 'disable');
        MobileHomepageCleanup.destroy();
        expect(disableSpy).toHaveBeenCalledOnce();
    });

    it('leaves the module disabled after destroy()', () => {
        stubMobileTouch();
        MobileHomepageCleanup.enable();
        MobileHomepageCleanup.destroy();
        expect(MobileHomepageCleanup.enabled).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  7. _startObserver()
// ─────────────────────────────────────────────────────────────────────────────

describe('_startObserver()', () => {
    it('creates a MutationObserver when none exists', () => {
        MobileHomepageCleanup._startObserver();
        expect(MobileHomepageCleanup._observer).not.toBeNull();
    });

    it('is idempotent — does not replace an existing observer on second call', () => {
        MobileHomepageCleanup._startObserver();
        const first = MobileHomepageCleanup._observer;
        MobileHomepageCleanup._startObserver();
        expect(MobileHomepageCleanup._observer).toBe(first);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  8. _stopObserver()
// ─────────────────────────────────────────────────────────────────────────────

describe('_stopObserver()', () => {
    it('disconnects and nullifies the observer', () => {
        MobileHomepageCleanup._startObserver();
        const obs = MobileHomepageCleanup._observer;
        const disconnectSpy = vi.spyOn(obs, 'disconnect');
        MobileHomepageCleanup._stopObserver();
        expect(disconnectSpy).toHaveBeenCalledOnce();
        expect(MobileHomepageCleanup._observer).toBeNull();
    });

    it('is idempotent — safe to call when no observer exists', () => {
        expect(MobileHomepageCleanup._observer).toBeNull();
        expect(() => MobileHomepageCleanup._stopObserver()).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  9. start()
// ─────────────────────────────────────────────────────────────────────────────

describe('start()', () => {
    it('returns early without touching storage if not a mobile device', async () => {
        stubDesktop();
        const getSpy = vi.spyOn(chrome.storage.local, 'get');
        await MobileHomepageCleanup.start();
        expect(getSpy).not.toHaveBeenCalled();
        expect(MobileHomepageCleanup.enabled).toBe(false);
    });

    it('reads StorageManager.KEYS.IS_ENABLED from chrome.storage.local', async () => {
        stubMobileTouch();
        const getSpy = vi.spyOn(chrome.storage.local, 'get');
        await MobileHomepageCleanup.start();
        expect(getSpy).toHaveBeenCalledWith(
            [StorageManager.KEYS.IS_ENABLED],
            expect.any(Function)
        );
    });

    it('sets _masterEnabled = true when storage returns true', async () => {
        stubMobileTouch();
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
        await MobileHomepageCleanup.start();
        expect(MobileHomepageCleanup._masterEnabled).toBe(true);
    });

    it('sets _masterEnabled = false when storage returns false', async () => {
        stubMobileTouch();
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
        await MobileHomepageCleanup.start();
        expect(MobileHomepageCleanup._masterEnabled).toBe(false);
    });

    it('defaults _masterEnabled to false when key is absent', async () => {
        stubMobileTouch();
        // storage is cleared in beforeEach — key is absent
        await MobileHomepageCleanup.start();
        expect(MobileHomepageCleanup._masterEnabled).toBe(false);
    });

    it('calls _setupStorageListener()', async () => {
        stubMobileTouch();
        const listenerSpy = vi.spyOn(MobileHomepageCleanup, '_setupStorageListener');
        await MobileHomepageCleanup.start();
        expect(listenerSpy).toHaveBeenCalledOnce();
    });

    it('calls enable() when _masterEnabled is true', async () => {
        stubMobileTouch();
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
        const enableSpy = vi.spyOn(MobileHomepageCleanup, 'enable');
        await MobileHomepageCleanup.start();
        expect(enableSpy).toHaveBeenCalledOnce();
    });

    it('does NOT call enable() when _masterEnabled is false', async () => {
        stubMobileTouch();
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
        const enableSpy = vi.spyOn(MobileHomepageCleanup, 'enable');
        await MobileHomepageCleanup.start();
        expect(enableSpy).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  10. _setupStorageListener() — storage change simulation
// ─────────────────────────────────────────────────────────────────────────────

describe('_setupStorageListener()', () => {
    beforeEach(() => {
        // Register the listener fresh for each test in this group
        MobileHomepageCleanup._setupStorageListener();
    });

    it('calls enable() when IS_ENABLED changes to true', async () => {
        stubMobileTouch();
        const enableSpy = vi.spyOn(MobileHomepageCleanup, 'enable');
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(enableSpy).toHaveBeenCalled();
    });

    it('calls disable() when IS_ENABLED changes to false', async () => {
        stubMobileTouch();
        // Pre-enable so disable() actually executes
        MobileHomepageCleanup.enable();
        const disableSpy = vi.spyOn(MobileHomepageCleanup, 'disable');
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(disableSpy).toHaveBeenCalled();
    });

    it('ignores changes to other keys', async () => {
        stubMobileTouch();
        const enableSpy = vi.spyOn(MobileHomepageCleanup, 'enable');
        const disableSpy = vi.spyOn(MobileHomepageCleanup, 'disable');
        // Write a key that is not IS_ENABLED
        await chrome.storage.local.set({ someOtherKey: true });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(enableSpy).not.toHaveBeenCalled();
        expect(disableSpy).not.toHaveBeenCalled();
    });

    it('ignores changes in non-local namespaces', async () => {
        stubMobileTouch();
        const enableSpy = vi.spyOn(MobileHomepageCleanup, 'enable');
        const disableSpy = vi.spyOn(MobileHomepageCleanup, 'disable');
        // Retrieve registered listeners from the InMemoryStorageMock instance and
        // invoke the most recently added one with the 'sync' namespace directly.
        // chrome.storage.local IS the InMemoryStorageMock instance, so _listeners
        // is accessible as chrome.storage.local._listeners.
        const storedListeners = chrome.storage.local._listeners ?? [];
        const lastListener = [...storedListeners].pop();
        if (lastListener) {
            lastListener({ [StorageManager.KEYS.IS_ENABLED]: { newValue: true } }, 'sync');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(enableSpy).not.toHaveBeenCalled();
        expect(disableSpy).not.toHaveBeenCalled();
    });
});
