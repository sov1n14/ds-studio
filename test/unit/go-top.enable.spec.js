/**
 * GoToTop — enable/disable and storage-listener unit tests.
 * Shared fixtures: test/helpers/go-top-fixtures.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState, createWrapperWithoutNativeButton } from '../helpers/go-top-fixtures.js';

// ── Settings-message harness ────────────────────────────────────────────────
// content/go-top.js gets its master-switch state from the shared toggle
// pipeline (content/feature-toggle.js -> DSS_GET_SETTINGS /
// DSS_SETTINGS_CHANGED). These helpers stand in for background/settings-routes.js.

/** Queue the values every GET_SETTINGS round trip resolves with. */
function respondWith(values) {
    chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
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
    chrome.runtime.onMessage.callListeners(
        { type: globalThis.DSS_SETTINGS_MSG.SETTINGS_CHANGED, area, changes },
        { id: 'test-extension-id' },
        () => {},
    );
}

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

        // Route detection has no observer field to inspect: it lives in the
        // debounced body-mutation callback plus a popstate listener. These
        // three specs therefore assert the observable consequence of a route
        // change — the old button is torn down and a new one injected —
        // through each of the two trigger paths, and its absence after
        // disable().
        it('a popstate route change after enable re-injects the button', () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();
            const firstBtn = GoToTop._button;
            expect(firstBtn).not.toBeNull();

            vi.useFakeTimers();
            window.history.pushState({}, '', '/a/chat/route-popstate');
            window.dispatchEvent(new PopStateEvent('popstate'));

            // The route change tears the old button down synchronously.
            expect(document.body.contains(firstBtn)).toBe(false);
            expect(GoToTop._button).toBeNull();

            // A new button is injected after the 100ms route-change debounce.
            vi.advanceTimersByTime(100);
            expect(GoToTop._button).not.toBeNull();
            expect(GoToTop._button).not.toBe(firstBtn);
            expect(document.body.contains(GoToTop._button)).toBe(true);
        });

        it('a pathname change seen through a body mutation re-injects the button', async () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();
            const firstBtn = GoToTop._button;
            expect(firstBtn).not.toBeNull();

            window.history.pushState({}, '', '/a/chat/route-mutation');
            document.body.appendChild(document.createElement('span'));

            // Real timers on purpose: happy-dom delivers MutationObserver
            // records on the microtask queue, which fake timers do not flush.
            // 50ms observer debounce detects the new pathname, then the 100ms
            // route-change debounce re-injects.
            await new Promise((resolve) => setTimeout(
                resolve, GoToTop.OBSERVER_DEBOUNCE + 100 + 60));

            expect(document.body.contains(firstBtn)).toBe(false);
            expect(GoToTop._button).not.toBeNull();
            expect(GoToTop._button).not.toBe(firstBtn);
            expect(document.body.contains(GoToTop._button)).toBe(true);
        });

        it('after disable, neither popstate nor a body mutation re-injects a button', async () => {
            GoToTop._masterEnabled = true;
            GoToTop.enable();
            expect(GoToTop._button).not.toBeNull();

            GoToTop.disable();
            expect(GoToTop._popstateHandler).toBeNull();

            window.history.pushState({}, '', '/a/chat/route-after-disable');
            window.dispatchEvent(new PopStateEvent('popstate'));
            document.body.appendChild(document.createElement('span'));
            await new Promise((resolve) => setTimeout(
                resolve, GoToTop.OBSERVER_DEBOUNCE + 100 + 60));

            expect(GoToTop._button).toBeNull();
            expect(document.querySelector('.dsw-gotop')).toBeNull();
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
    //  Master-switch broadcasts
    // ─────────────────────────────────────

    // NOTE: this hook is intentionally NOT merged with `enable / disable`'s
    // hook above. It omits the `_getAnchor` mock and anchor element on
    // purpose — these tests exercise the master-switch path with the REAL
    // `_getAnchor`, so hoisting a shared hook would silently change what
    // enable() does inside these tests.
    describe('master-switch broadcasts', () => {
        beforeEach(async () => {
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

            // Re-register the toggle so this test starts from a known dormant
            // state (the load-time registration may have been left switched on
            // by an earlier test in this file).
            respondWith({ isEnabled: false });
            GoToTop.destroy();
            await GoToTop.init();
            await flush();
        });

        it('injects the button when the master switch broadcast turns on, and removes it when it turns off', () => {
            expect(GoToTop.enabled).toBe(false);
            expect(document.querySelector('.dsw-gotop')).toBeNull();

            broadcast(change('isEnabled', true));

            expect(GoToTop.enabled).toBe(true);
            expect(document.querySelector('.dsw-gotop')).not.toBeNull();

            broadcast(change('isEnabled', false));

            expect(GoToTop.enabled).toBe(false);
            expect(document.querySelector('.dsw-gotop')).toBeNull();
        });

        it('ignores a broadcast that carries only an unrelated key (e.g. dsGoTop)', () => {
            broadcast(change('isEnabled', true));
            const button = GoToTop._button;
            expect(button).not.toBeNull();

            broadcast(change('dsGoTop', false));

            expect(GoToTop.enabled).toBe(true);
            expect(GoToTop._button).toBe(button);
            expect(document.querySelector('.dsw-gotop')).not.toBeNull();
        });

        it('only responds to the local area, not sync', () => {
            broadcast(change('isEnabled', true));
            expect(GoToTop.enabled).toBe(true);

            broadcast(change('isEnabled', false), 'sync');

            expect(GoToTop.enabled).toBe(true);
            expect(document.querySelector('.dsw-gotop')).not.toBeNull();
        });
    });

    // ─────────────────────────────────────
    //  disable() teardown correctness (regression)
    // ─────────────────────────────────────

    // Own local setup on purpose (does NOT reuse the "enable / disable" hook above):
    // that hook mocks `container.addEventListener = vi.fn()`, which makes it
    // impossible to observe whether a real 'scroll' listener still fires after
    // disable(). These tests need a REAL DOM container so dispatching a real
    // event actually exercises whatever listener the feature attached.
    describe('disable — teardown correctness (regression)', () => {
        function createRealScrollContainer() {
            const container = document.createElement('div');
            container.style.overflowY = 'auto';
            Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
            let scrollTopValue = 0;
            let scrollTopSetCount = 0;
            // Real get/set backing for scrollTop (matches the pattern established
            // in go-top.scroll-engine.spec.js), plus scrollBy routed through the
            // same setter — so poll activity is counted whether the loop moves
            // the container via stepped scrollBy calls or a single scrollTop
            // write.
            Object.defineProperty(container, 'scrollTop', {
                get: () => scrollTopValue,
                set: (v) => { scrollTopValue = v; scrollTopSetCount++; },
                configurable: true,
            });
            Object.defineProperty(container, 'scrollTopSetCount', {
                get: () => scrollTopSetCount,
                configurable: true,
            });
            container.scrollBy = vi.fn((x, y) => { container.scrollTop = scrollTopValue + y; });
            document.body.appendChild(container);
            return container;
        }

        it('an SPA route change immediately before disable must not resurrect the button', async () => {
            const container = createRealScrollContainer();
            const { outerWrapper } = createWrapperWithoutNativeButton();
            const anchor = document.createElement('div');
            anchor.className = '_9663006 _2c189bc';
            document.body.appendChild(anchor);

            vi.spyOn(GoToTop, '_findScrollContainer').mockImplementation(function () {
                this._scrollContainer = container;
                return container;
            });
            vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(anchor);

            GoToTop._masterEnabled = true;
            GoToTop.enable();
            expect(GoToTop.enabled).toBe(true);
            expect(document.body.contains(GoToTop._button)).toBe(true);

            vi.useFakeTimers();
            try {
                // An SPA route change occurs (same trigger as the existing
                // _onRouteChange specs in go-top.reconnect.spec.js).
                GoToTop._onRouteChange();

                // Disable within the settling window that follows a route
                // change (well under the 100ms debounce).
                vi.advanceTimersByTime(50);
                GoToTop.disable();

                // Advance well past the settling window.
                vi.advanceTimersByTime(300);
            } finally {
                vi.useRealTimers();
            }

            // No go-top button exists anywhere in the document.
            expect(document.querySelector('.dsw-gotop')).toBeNull();
            expect(GoToTop._button).toBeNull();

            // No scroll listener remains attached to the scroll container:
            // dispatch a real scroll event and confirm the feature does not react.
            const evaluateSpy = vi.spyOn(GoToTop, '_evaluateVisibility');
            container.dispatchEvent(new Event('scroll'));

            // No MutationObserver belonging to the feature is still active on
            // the wrapper: mutating it must not cause a button to reappear.
            outerWrapper.appendChild(document.createElement('span'));
            await new Promise((resolve) => setTimeout(resolve, GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 40));

            expect(evaluateSpy).not.toHaveBeenCalled();
            expect(document.querySelector('.dsw-gotop')).toBeNull();
        });

        it('disable aborts an in-flight scrollToTopAndWait before it reaches its own timeout', async () => {
            const container = createRealScrollContainer();
            createWrapperWithoutNativeButton();
            const anchor = document.createElement('div');
            anchor.className = '_9663006 _2c189bc';
            anchor.getBoundingClientRect = () => ({ top: -1000, bottom: -900, height: 100 });
            document.body.appendChild(anchor);

            vi.spyOn(GoToTop, '_findScrollContainer').mockImplementation(function () {
                this._scrollContainer = container;
                return container;
            });
            vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(anchor);

            GoToTop._masterEnabled = true;
            GoToTop.enable();
            expect(GoToTop.enabled).toBe(true);

            vi.useFakeTimers();
            try {
                const promise = GoToTop.scrollToTopAndWait({ timeout: 5000 });
                expect(GoToTop._isLocked).toBe(true);

                let settled = false;
                promise.then(() => { settled = true; }, () => { settled = true; });

                // Let the scroll operation genuinely get into flight.
                await vi.advanceTimersByTimeAsync(GoToTop.ANCHOR_POLL_INTERVAL * 2);
                const scrollCallsBeforeDisable = container.scrollTopSetCount;
                expect(scrollCallsBeforeDisable).toBeGreaterThan(0);
                expect(settled).toBe(false);

                GoToTop.disable();

                // Advance several more polling intervals — still far short of
                // the 5000ms timeout ceiling given to scrollToTopAndWait.
                await vi.advanceTimersByTimeAsync(GoToTop.ANCHOR_POLL_INTERVAL * 5);

                // The in-flight operation terminated promptly, not by running
                // to its own timeout ceiling.
                expect(settled).toBe(true);
                // No further scroll movement occurred after disable.
                expect(container.scrollTopSetCount).toBe(scrollCallsBeforeDisable);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
