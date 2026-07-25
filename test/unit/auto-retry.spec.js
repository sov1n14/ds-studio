import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Side-effect import: sets window.StorageManager before module is evaluated
import '../../utils/storage-manager.js';
import AutoRetry from '../../content/auto-retry.js';
import StorageManager from '../../utils/storage-manager.js';

// ─────────────────────────────────────────────────────────────────────────────
//  DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

const RETRY_MARKUP =
    '<div role="button" class="ds-button ds-button--warning ds-button--filled ds-button--circle ds-button--xs ds-button--icon-relative-m a3b9bd76 _76a2310" tabindex="0"></div>';

function addRetryButton() {
    document.body.innerHTML = RETRY_MARKUP;
    return document.body.firstElementChild;
}

function addFallbackOnlyButton() {
    // Only the hashed classes are present — the primary semantic selector
    // (.ds-button--warning.ds-button--circle.ds-button--xs) must not match.
    const el = document.createElement('div');
    el.className = 'a3b9bd76 _76a2310';
    document.body.appendChild(el);
    return el;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reset module state
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    if (AutoRetry._timer) {
        clearInterval(AutoRetry._timer);
        AutoRetry._timer = null;
    }
    AutoRetry.enabled = false;
    AutoRetry._masterEnabled = false;
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    if (AutoRetry._timer) {
        clearInterval(AutoRetry._timer);
        AutoRetry._timer = null;
    }
    AutoRetry.enabled = false;
    AutoRetry._masterEnabled = false;
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. _findRetryButton()
// ─────────────────────────────────────────────────────────────────────────────

describe('_findRetryButton()', () => {
    it('finds the button via the primary semantic selector', () => {
        const el = addRetryButton();
        expect(AutoRetry._findRetryButton()).toBe(el);
    });

    it('falls back to the hashed selector when only hashed classes are present', () => {
        const el = addFallbackOnlyButton();
        expect(AutoRetry._findRetryButton()).toBe(el);
    });

    it('returns null when no retry button is present', () => {
        expect(AutoRetry._findRetryButton()).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. _tick()
// ─────────────────────────────────────────────────────────────────────────────

describe('_tick()', () => {
    it('clicks the retry button when enabled', () => {
        const el = addRetryButton();
        const clickSpy = vi.fn();
        el.addEventListener('click', clickSpy);
        AutoRetry.enabled = true;
        AutoRetry._tick();
        expect(clickSpy).toHaveBeenCalledOnce();
    });

    it('does not click when enabled is false', () => {
        const el = addRetryButton();
        const clickSpy = vi.fn();
        el.addEventListener('click', clickSpy);
        AutoRetry.enabled = false;
        AutoRetry._tick();
        expect(clickSpy).not.toHaveBeenCalled();
    });

    it('does not throw when no retry button is present', () => {
        AutoRetry.enabled = true;
        expect(() => AutoRetry._tick()).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. enable() / disable()
// ─────────────────────────────────────────────────────────────────────────────

describe('enable()', () => {
    it('sets enabled = true', () => {
        AutoRetry.enable();
        expect(AutoRetry.enabled).toBe(true);
    });

    it('creates a timer', () => {
        AutoRetry.enable();
        expect(AutoRetry._timer).not.toBeNull();
    });

    it('is idempotent — does not replace an existing timer on second call', () => {
        AutoRetry.enable();
        const timer = AutoRetry._timer;
        AutoRetry.enable();
        expect(AutoRetry._timer).toBe(timer);
    });
});

describe('disable()', () => {
    it('is idempotent — does nothing if not enabled', () => {
        expect(() => AutoRetry.disable()).not.toThrow();
        expect(AutoRetry.enabled).toBe(false);
    });

    it('sets enabled = false', () => {
        AutoRetry.enable();
        AutoRetry.disable();
        expect(AutoRetry.enabled).toBe(false);
    });

    it('clears and nulls the timer', () => {
        AutoRetry.enable();
        AutoRetry.disable();
        expect(AutoRetry._timer).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. Timer behaviour (fake timers)
// ─────────────────────────────────────────────────────────────────────────────

describe('timer behaviour', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clicks a persistent button once per second while enabled', () => {
        const el = addRetryButton();
        const clickSpy = vi.fn();
        el.addEventListener('click', clickSpy);

        AutoRetry.enable();
        vi.advanceTimersByTime(3000);

        expect(clickSpy).toHaveBeenCalledTimes(3);
    });

    it('stops clicking after disable()', () => {
        const el = addRetryButton();
        const clickSpy = vi.fn();
        el.addEventListener('click', clickSpy);

        AutoRetry.enable();
        vi.advanceTimersByTime(3000);
        expect(clickSpy).toHaveBeenCalledTimes(3);

        AutoRetry.disable();
        vi.advanceTimersByTime(3000);
        expect(clickSpy).toHaveBeenCalledTimes(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. start() — master-switch integration
// ─────────────────────────────────────────────────────────────────────────────

describe('start()', () => {
    it('reads StorageManager.KEYS.IS_ENABLED from chrome.storage.local', async () => {
        const getSpy = vi.spyOn(chrome.storage.local, 'get');
        await AutoRetry.start();
        expect(getSpy).toHaveBeenCalledWith(
            [StorageManager.KEYS.IS_ENABLED],
            expect.any(Function)
        );
    });

    it('enables when storage returns isEnabled: true', async () => {
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
        await AutoRetry.start();
        expect(AutoRetry._masterEnabled).toBe(true);
        expect(AutoRetry.enabled).toBe(true);
    });

    it('stays disabled when storage returns isEnabled: false', async () => {
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
        await AutoRetry.start();
        expect(AutoRetry._masterEnabled).toBe(false);
        expect(AutoRetry.enabled).toBe(false);
    });

    it('calls _setupStorageListener()', async () => {
        const listenerSpy = vi.spyOn(AutoRetry, '_setupStorageListener');
        await AutoRetry.start();
        expect(listenerSpy).toHaveBeenCalledOnce();
    });
});

describe('_setupStorageListener() — storage change simulation', () => {
    beforeEach(() => {
        AutoRetry._setupStorageListener();
    });

    it('enables when IS_ENABLED changes to true', async () => {
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(AutoRetry.enabled).toBe(true);
    });

    it('disables when IS_ENABLED changes to false', async () => {
        AutoRetry.enable();
        await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(AutoRetry.enabled).toBe(false);
    });

    it('ignores changes to other keys', async () => {
        const enableSpy = vi.spyOn(AutoRetry, 'enable');
        const disableSpy = vi.spyOn(AutoRetry, 'disable');
        await chrome.storage.local.set({ someOtherKey: true });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(enableSpy).not.toHaveBeenCalled();
        expect(disableSpy).not.toHaveBeenCalled();
    });
});
