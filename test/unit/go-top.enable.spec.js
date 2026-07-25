/**
 * GoToTop — enable/disable and storage-listener unit tests.
 * Shared fixtures: test/helpers/go-top-fixtures.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState } from '../helpers/go-top-fixtures.js';

describe('GoToTop', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { vi.useRealTimers(); });

    // ─────────────────────────────────────
    //  enable / disable
    // ─────────────────────────────────────

    describe('enable / disable', () => {
        beforeEach(() => {
            // Setup minimal scroll container so _startScrollListener doesn't fail
            const container = document.createElement('div');
            container.style.overflowY = 'auto';
            Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
            container.addEventListener = vi.fn();
            container.removeEventListener = vi.fn();
            document.body.appendChild(container);

            // Add .aaff8b8f wrapper so _tryConnectDom sees the DOM as ready
            // (Change A: gating now requires INJECT_PARENT_SELECTOR or native button)
            const outerWrapper = document.createElement('div');
            outerWrapper.className = '_871cbca';
            const injectParent = document.createElement('div');
            injectParent.className = 'aaff8b8f';
            outerWrapper.appendChild(injectParent);
            document.body.appendChild(outerWrapper);

            // Mock _findScrollContainer to return a cached container
            vi.spyOn(GoToTop, '_findScrollContainer').mockImplementation(function() {
                this._scrollContainer = container;
                return container;
            });

            // Mock _getAnchor so _tryConnectDom proceeds immediately (not polling)
            const anchor = document.createElement('div');
            anchor.className = '_9663006 _2c189bc';
            document.body.appendChild(anchor);
            vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(anchor);
        });

        it('enable creates button and starts observer', () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();

            expect(GoToTop.enabled).toBe(true);
            expect(GoToTop._button).not.toBeNull();
            expect(document.body.contains(GoToTop._button)).toBe(true);
            expect(GoToTop._observer).not.toBeNull();
            expect(GoToTop._routeObserver).not.toBeNull();
        });

        it('enable is idempotent when called twice', () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();
            const btn = GoToTop._button;
            const observer = GoToTop._observer;

            GoToTop.enable();
            expect(GoToTop._button).toBe(btn);
            expect(GoToTop._observer).toBe(observer);
        });

        it('disable removes button and stops observer', () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();
            expect(GoToTop.enabled).toBe(true);

            GoToTop.disable();

            expect(GoToTop.enabled).toBe(false);
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._observer).toBeNull();
            expect(GoToTop._scrollContainer).toBeNull();
            expect(GoToTop._injectionMode).toBeNull();
            expect(GoToTop._hasSeenDom).toBe(false);
        });

        it('disable is idempotent when called twice', () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();

            GoToTop.disable();
            expect(() => GoToTop.disable()).not.toThrow();
            expect(GoToTop.enabled).toBe(false);
        });

        it('disable cleans up scroll listener', () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();

            GoToTop.disable();

            expect(GoToTop._scrollListener).toBeNull();
        });

        it('disable cleans up route observer', () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();

            GoToTop.disable();
            expect(GoToTop._routeObserver).toBeNull();
            expect(GoToTop._popstateHandler).toBeNull();
        });

        it('disable cleans up wrapper observer', () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();

            GoToTop.disable();
            expect(GoToTop._wrapperObserver).toBeNull();
            expect(GoToTop._wrapperObserverTimer).toBeNull();
        });
    });

    // ─────────────────────────────────────
    //  setupStorageListener
    // ─────────────────────────────────────

    // NOTE: this hook is intentionally NOT merged with `enable / disable`'s
    // hook above. It omits the `_getAnchor` mock and anchor element on
    // purpose — these three tests exercise the storage-listener path with
    // the REAL `_getAnchor`, so hoisting a shared hook would silently change
    // what `enable()` does inside these tests.
    describe('setupStorageListener', () => {
        beforeEach(() => {
            // Setup minimal scroll container so _startScrollListener doesn't fail
            const container = document.createElement('div');
            container.style.overflowY = 'auto';
            Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
            container.addEventListener = vi.fn();
            container.removeEventListener = vi.fn();
            document.body.appendChild(container);

            // Add .aaff8b8f wrapper so _tryConnectDom gates injection correctly (Change A)
            const outerWrapper = document.createElement('div');
            outerWrapper.className = '_871cbca';
            const injectParent = document.createElement('div');
            injectParent.className = 'aaff8b8f';
            outerWrapper.appendChild(injectParent);
            document.body.appendChild(outerWrapper);

            // Mock _findScrollContainer to return a cached container
            vi.spyOn(GoToTop, '_findScrollContainer').mockImplementation(function() {
                this._scrollContainer = container;
                return container;
            });
        });

        it('enables/disables based ONLY on master IS_ENABLED switch', async () => {
            GoToTop._masterEnabled = false;
            GoToTop.enabled = false;

            await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: true });
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(GoToTop.enabled).toBe(true);

            await chrome.storage.local.set({ [StorageManager.KEYS.IS_ENABLED]: false });
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(GoToTop.enabled).toBe(false);
        });

        it('ignores any other storage keys (e.g., dsGoTop)', async () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();

            const listeners = chrome.storage.local._listeners;
            listeners.forEach((l) => {
                l({ dsGoTop: { newValue: false } }, 'local');
            });
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(GoToTop.enabled).toBe(true);
        });

        it('only responds to local namespace, not sync', async () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();

            const listeners = chrome.storage.local._listeners;
            listeners.forEach((l) => {
                l({ [StorageManager.KEYS.IS_ENABLED]: { newValue: false } }, 'sync');
            });
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(GoToTop.enabled).toBe(true);
        });
    });
});
