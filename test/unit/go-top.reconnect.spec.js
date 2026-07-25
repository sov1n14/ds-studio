/**
 * GoToTop — DOM reconnection unit tests: readiness gating, wrapper
 * observer reconciliation, and route-change teardown/re-connect.
 * Shared fixtures: test/helpers/go-top-fixtures.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import {
    createWrapperWithoutNativeButton,
    createNativeButton,
    createFullWrapperWithNativeButton,
    resetGoToTopState,
} from '../helpers/go-top-fixtures.js';

describe('GoToTop', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { vi.useRealTimers(); });

    // ─────────────────────────────────────
    //  _tryConnectDom (Change A — gating)
    // ─────────────────────────────────────

    describe('_tryConnectDom', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            GoToTop.enabled = true;
            GoToTop._enableRetryCount = 0;
            GoToTop._enableRetryTimer = null;
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('does NOT inject when both .aaff8b8f and native button are absent — schedules retry instead', () => {
            document.body.innerHTML = '';
            const injectSpy = vi.spyOn(GoToTop, '_injectButton');

            GoToTop._tryConnectDom();

            expect(injectSpy).not.toHaveBeenCalled();
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._enableRetryTimer).not.toBeNull();
        });

        it('injects immediately when .aaff8b8f wrapper is present (regardless of _getAnchor)', () => {
            createWrapperWithoutNativeButton();
            vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(null);
            const injectSpy = vi.spyOn(GoToTop, '_injectButton');

            GoToTop._tryConnectDom();

            expect(injectSpy).toHaveBeenCalledOnce();
        });

        it('injects immediately when native button is present', () => {
            createFullWrapperWithNativeButton();
            const injectSpy = vi.spyOn(GoToTop, '_injectButton');

            GoToTop._tryConnectDom();

            expect(injectSpy).toHaveBeenCalledOnce();
        });

        it('after 120 misses: _injectButton NOT called, _button stays null, no further timer scheduled', () => {
            document.body.innerHTML = '';
            const injectSpy = vi.spyOn(GoToTop, '_injectButton');
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            GoToTop._enableRetryCount = 120; // already at cap
            GoToTop._tryConnectDom();

            expect(injectSpy).not.toHaveBeenCalled();
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._enableRetryTimer).toBeNull();
            expect(GoToTop._enableRetryCount).toBe(0); // reset after giving up
            warnSpy.mockRestore();
        });

        it('disable() mid-retry cancels the pending timer', () => {
            document.body.innerHTML = '';
            GoToTop._tryConnectDom();
            expect(GoToTop._enableRetryTimer).not.toBeNull();

            GoToTop.disable();
            expect(GoToTop._enableRetryTimer).toBeNull();
        });

        it('resets _enableRetryCount to 0 on successful injection', () => {
            createWrapperWithoutNativeButton();
            GoToTop._enableRetryCount = 5;
            vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(null);

            GoToTop._tryConnectDom();

            expect(GoToTop._enableRetryCount).toBe(0);
        });
    });

    // ─────────────────────────────────────
    //  _startWrapperObserver / _stopWrapperObserver
    // ─────────────────────────────────────

    describe('_startWrapperObserver / _stopWrapperObserver', () => {
        beforeEach(() => {
            GoToTop._wrapperObserver = null;
            GoToTop._wrapperObserverTimer = null;
        });

        it('creates MutationObserver on outerWrapper', () => {
            const outerWrapper = document.createElement('div');
            document.body.appendChild(outerWrapper);

            GoToTop._startWrapperObserver(outerWrapper);
            expect(GoToTop._wrapperObserver).not.toBeNull();
            expect(GoToTop._wrapperObserver).toBeInstanceOf(MutationObserver);
        });

        it('is no-op if observer is already running', () => {
            const outerWrapper = document.createElement('div');
            document.body.appendChild(outerWrapper);

            GoToTop._startWrapperObserver(outerWrapper);
            const obs = GoToTop._wrapperObserver;
            GoToTop._startWrapperObserver(outerWrapper);
            expect(GoToTop._wrapperObserver).toBe(obs);
        });

        it('stop disconnects observer and clears timer', () => {
            const outerWrapper = document.createElement('div');
            document.body.appendChild(outerWrapper);

            GoToTop._startWrapperObserver(outerWrapper);
            const disconnectSpy = vi.spyOn(GoToTop._wrapperObserver, 'disconnect');

            GoToTop._stopWrapperObserver();
            expect(disconnectSpy).toHaveBeenCalledOnce();
            expect(GoToTop._wrapperObserver).toBeNull();
            expect(GoToTop._wrapperObserverTimer).toBeNull();
        });

        it('solo → stacked upgrade via observer: REUSES same element when native button appears', async () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const originalBtn = GoToTop._button;
            expect(GoToTop._injectionMode).toBe('wrapper-solo');

            // Simulate native button appearing
            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);
            vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(nativeBtn);
            vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);

            // Simulate observer callback: button connected, mode wrapper-solo, native appeared
            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            expect(GoToTop._button).toBe(originalBtn);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(false);
            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(true);
        });

        it('re-injects as solo when button removed and no native button', async () => {
            const { outerWrapper, injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const oldBtn = GoToTop._button;

            // Simulate button being removed by React re-render
            oldBtn.remove();
            vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(null);

            outerWrapper.appendChild(document.createElement('span'));
            // Real MutationObserver + real debounce timer: fake timers don't
            // deliver pending MutationObserver records (see happy-dom limits memory).
            await new Promise((resolve) => setTimeout(resolve, GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 40));

            // Must be a genuinely NEW, connected button — not the stale pre-removal reference.
            expect(GoToTop._button).not.toBeNull();
            expect(GoToTop._button).not.toBe(oldBtn);
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._button.parentElement).toBe(injectParent);
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
        });

        it('reconciliation no-op: injected mode with native button present does no work', async () => {
            const { outerWrapper, injectParent } = createWrapperWithoutNativeButton();
            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._injectIntoWrapperDirect(); // starts wrapper observer, mode = wrapper-solo
            vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(nativeBtn);
            vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);
            GoToTop._transitionToStacked(GoToTop._button, nativeBtn); // set up: mode = injected
            expect(GoToTop._injectionMode).toBe('injected'); // sanity check on setup

            const btn = GoToTop._button;
            const classNameSnapshot = btn.className;
            const styleSnapshot = btn.getAttribute('style');
            const parentSnapshot = btn.parentElement;

            const soloSpy = vi.spyOn(GoToTop, '_transitionToSolo');
            const stackedSpy = vi.spyOn(GoToTop, '_transitionToStacked');
            const offsetSpy = vi.spyOn(GoToTop, '_applyStackedOffset');
            GoToTop._evaluateVisibility.mockClear();

            // Unrelated childList mutation inside the observed wrapper subtree.
            outerWrapper.appendChild(document.createElement('span'));
            await new Promise((resolve) => setTimeout(resolve, GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 40));

            expect(GoToTop._button).toBe(btn);
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(btn.className).toBe(classNameSnapshot);
            expect(btn.getAttribute('style')).toBe(styleSnapshot);
            expect(btn.parentElement).toBe(parentSnapshot);
            expect(soloSpy).not.toHaveBeenCalled();
            expect(stackedSpy).not.toHaveBeenCalled();
            expect(offsetSpy).not.toHaveBeenCalled();
            expect(GoToTop._evaluateVisibility).not.toHaveBeenCalled();
        });

        it('reconciliation no-op: wrapper-solo mode with no native button does no work', async () => {
            const { outerWrapper, injectParent } = createWrapperWithoutNativeButton();

            GoToTop._injectIntoWrapperDirect(); // starts wrapper observer, mode = wrapper-solo
            vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(null);
            vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);
            expect(GoToTop._injectionMode).toBe('wrapper-solo'); // sanity check on setup

            const btn = GoToTop._button;
            const classNameSnapshot = btn.className;
            const styleSnapshot = btn.getAttribute('style');
            const parentSnapshot = btn.parentElement;

            const soloSpy = vi.spyOn(GoToTop, '_transitionToSolo');
            const stackedSpy = vi.spyOn(GoToTop, '_transitionToStacked');
            const offsetSpy = vi.spyOn(GoToTop, '_applyStackedOffset');
            GoToTop._evaluateVisibility.mockClear();

            // Unrelated childList mutation inside the observed wrapper subtree.
            outerWrapper.appendChild(document.createElement('span'));
            await new Promise((resolve) => setTimeout(resolve, GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 40));

            expect(GoToTop._button).toBe(btn);
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            expect(btn.className).toBe(classNameSnapshot);
            expect(btn.getAttribute('style')).toBe(styleSnapshot);
            expect(btn.parentElement).toBe(parentSnapshot);
            expect(soloSpy).not.toHaveBeenCalled();
            expect(stackedSpy).not.toHaveBeenCalled();
            expect(offsetSpy).not.toHaveBeenCalled();
            expect(GoToTop._evaluateVisibility).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────
    //  _onRouteChange
    // ─────────────────────────────────────

    describe('_onRouteChange', () => {
        it('resets hasSeenDom, and cleans up button', () => {
            GoToTop._hasSeenDom = true;
            GoToTop._scrollContainer = document.createElement('div');
            const btn = document.createElement('div');
            GoToTop._button = btn;
            GoToTop._injectionMode = 'injected';
            document.body.appendChild(btn);

            GoToTop._onRouteChange();

            expect(GoToTop._hasSeenDom).toBe(false);
            expect(GoToTop._scrollContainer).toBeNull();
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._injectionMode).toBeNull();
        });

        it('aborts active scroll and resets lock', async () => {
            vi.useFakeTimers();
            try {
                const container = document.createElement('div');
                container.style.overflowY = 'auto';
                container.scrollBy = vi.fn();
                document.body.appendChild(container);
                GoToTop._scrollContainer = container;
                const anchor = document.createElement('div');
                anchor.getBoundingClientRect = () => ({ top: -1000, bottom: -900, height: 100 });
                vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(anchor);

                const promise = GoToTop.scrollToTopAndWait({ timeout: 5000 });
                GoToTop._onRouteChange();

                await expect(promise).rejects.toEqual({ success: false, reason: 'aborted' });
                expect(GoToTop._locked).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('drives gated _tryConnectDom after the 100ms route-change debounce', async () => {
            vi.useFakeTimers();
            try {
                GoToTop.enabled = true;
                GoToTop._onRouteChange();

                const connectSpy = vi.spyOn(GoToTop, '_tryConnectDom');

                // Before the debounce fires, nothing happens.
                expect(connectSpy).not.toHaveBeenCalled();

                vi.advanceTimersByTime(100);

                // Route change now routes through the gated retry loop, not a one-shot _injectButton.
                expect(connectSpy).toHaveBeenCalledOnce();
            } finally {
                vi.useRealTimers();
            }
        });

        it('when .aaff8b8f is ABSENT at debounce time: does NOT inject, but schedules a retry', async () => {
            vi.useFakeTimers();
            try {
                GoToTop.enabled = true;
                document.body.innerHTML = ''; // no .aaff8b8f, no native button
                const injectSpy = vi.spyOn(GoToTop, '_injectButton');

                GoToTop._onRouteChange();
                vi.advanceTimersByTime(100); // fire route-change debounce → _tryConnectDom

                // Gate not satisfied: no immediate injection, retry timer armed instead.
                expect(injectSpy).not.toHaveBeenCalled();
                expect(GoToTop._button).toBeNull();
                expect(GoToTop._enableRetryTimer).not.toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        it('retry fires after .aaff8b8f later appears: button IS injected on the gated retry', async () => {
            vi.useFakeTimers();
            try {
                GoToTop.enabled = true;
                document.body.innerHTML = ''; // wrapper not mounted yet
                vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(null);

                GoToTop._onRouteChange();
                vi.advanceTimersByTime(100); // route-change debounce → first gated attempt fails

                expect(GoToTop._button).toBeNull();
                expect(GoToTop._enableRetryTimer).not.toBeNull();

                // Wrapper mounts later (React finishes rendering the new conversation).
                createWrapperWithoutNativeButton();

                // 500ms retry interval elapses → gated retry now passes and injects.
                vi.advanceTimersByTime(500);

                expect(GoToTop._button).not.toBeNull();
                expect(document.body.contains(GoToTop._button)).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it('when .aaff8b8f IS present at debounce time: injects on the first gated attempt (no retry)', async () => {
            vi.useFakeTimers();
            try {
                GoToTop.enabled = true;
                createWrapperWithoutNativeButton(); // wrapper already mounted
                vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(null);
                const injectSpy = vi.spyOn(GoToTop, '_injectButton');

                GoToTop._onRouteChange();
                vi.advanceTimersByTime(100); // route-change debounce → first gated attempt

                expect(injectSpy).toHaveBeenCalledOnce();
                expect(GoToTop._button).not.toBeNull();
                expect(document.body.contains(GoToTop._button)).toBe(true);
                // Gate passed immediately → no retry timer left armed.
                expect(GoToTop._enableRetryTimer).toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        it('when native button IS present at debounce time: injects on the first gated attempt (no retry)', async () => {
            vi.useFakeTimers();
            try {
                GoToTop.enabled = true;
                createFullWrapperWithNativeButton(); // native button + wrapper mounted
                vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(null);
                const injectSpy = vi.spyOn(GoToTop, '_injectButton');

                GoToTop._onRouteChange();
                vi.advanceTimersByTime(100);

                expect(injectSpy).toHaveBeenCalledOnce();
                expect(GoToTop._button).not.toBeNull();
                expect(GoToTop._enableRetryTimer).toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        it('tears down the old button before re-injecting on route change', () => {
            const oldBtn = document.createElement('div');
            oldBtn.className = 'dsw-gotop';
            document.body.appendChild(oldBtn);
            GoToTop._button = oldBtn;
            GoToTop._injectionMode = 'injected';

            GoToTop._onRouteChange();

            // Old button is removed from the DOM and state cleared synchronously,
            // before the debounced re-injection runs.
            expect(document.body.contains(oldBtn)).toBe(false);
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._injectionMode).toBeNull();
        });
    });
});
