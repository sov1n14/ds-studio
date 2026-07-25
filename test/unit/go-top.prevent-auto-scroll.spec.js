/**
 * GoToTop — scrollToTopAndWait coordination with PreventAutoScroll.
 * Shared fixtures: test/helpers/go-top-fixtures.js
 *
 * Requirement under test: scrollToTopAndWait() must save-and-restore the
 * PreventAutoScroll enabled state around the scroll attempt, not blind-toggle
 * it, because harvest.js may already have it enabled around a wider export
 * operation that internally calls scrollToTopAndWait.
 *   R1 — ensure it IS enabled while the scroll is in progress, when it was
 *        NOT already enabled at call time.
 *   R2 — restore the pre-call state after settling (disabled -> disabled;
 *        already-enabled -> still enabled, never turned off by this call).
 *   R3 — restoration happens on every exit path: success, timeout, abort.
 *   R4 — must not throw when window.DSstudio.PreventAutoScroll is absent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState } from '../helpers/go-top-fixtures.js';

/**
 * Fake PreventAutoScroll backed by a real boolean, matching the public
 * interface documented in content/prevent-auto-scroll-bridge.js
 * (enable/disable/isEnabled). Assertions sample isEnabled() directly rather
 * than checking whether enable()/disable() were called, per project
 * anti-tautology rules.
 */
function createFakePreventAutoScroll(initialEnabled) {
    let enabled = initialEnabled;
    return {
        enable: () => { enabled = true; },
        disable: () => { enabled = false; },
        isEnabled: () => enabled,
    };
}

function createScrollContainer() {
    const container = document.createElement('div');
    container.style.overflowY = 'auto';
    container.style.height = '100px';
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
    let scrollTopValue = 0;
    // Real get/set backing for scrollTop (matches the pattern established in
    // go-top.scroll-engine.spec.js), plus scrollBy routed through the same
    // setter — so the fixture stays valid whether the poll loop moves the
    // container via stepped scrollBy calls or a single scrollTop write.
    Object.defineProperty(container, 'scrollTop', {
        get: () => scrollTopValue,
        set: (v) => { scrollTopValue = v; },
        configurable: true,
    });
    container.scrollBy = vi.fn((x, y) => { container.scrollTop = scrollTopValue + y; });
    document.body.appendChild(container);
    return container;
}

function makeAnchorAtTop(rect) {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => rect;
    return el;
}

/**
 * Wraps the container's scrollTop setter so the FIRST write samples
 * PreventAutoScroll's isEnabled() — this observes real mid-flight state
 * rather than inferring it from call spies. A setter probe (rather than a
 * scrollBy spy) is mechanism-agnostic: it fires whether the poll loop moves
 * the container via stepped scrollBy calls (which route through this same
 * setter, see createScrollContainer) or a single direct scrollTop write.
 * Must be called AFTER createScrollContainer(), which installs the
 * get/set-backed scrollTop this wraps.
 */
function sampleIsEnabledOnFirstScrollStep(container, pas) {
    let sampled;
    const { get, set } = Object.getOwnPropertyDescriptor(container, 'scrollTop');
    Object.defineProperty(container, 'scrollTop', {
        get,
        set: (v) => {
            if (sampled === undefined) sampled = pas.isEnabled();
            set(v);
        },
        configurable: true,
    });
    return () => sampled;
}

describe('GoToTop', () => {
    beforeEach(() => {
        resetGoToTopState();
        window.DSstudio = window.DSstudio || {};
    });
    afterEach(() => {
        vi.useRealTimers();
        if (window.DSstudio) delete window.DSstudio.PreventAutoScroll;
    });

    describe('scrollToTopAndWait — PreventAutoScroll coordination', () => {
        it('enables PreventAutoScroll during the scroll and restores it to disabled after settling, when it was not already enabled', async () => {
            const pas = createFakePreventAutoScroll(false);
            window.DSstudio.PreventAutoScroll = pas;

            const container = createScrollContainer();
            const getSampled = sampleIsEnabledOnFirstScrollStep(container, pas);
            GoToTop._scrollContainer = container;
            vi.spyOn(GoToTop, '_getAnchor')
                .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));

            await GoToTop.scrollToTopAndWait();

            expect(getSampled()).toBe(true);
            expect(pas.isEnabled()).toBe(false);
        });

        it('leaves PreventAutoScroll enabled after settling, without ever disabling it, when it was already enabled before the call (harvest nesting)', async () => {
            const pas = createFakePreventAutoScroll(true);
            window.DSstudio.PreventAutoScroll = pas;

            const container = createScrollContainer();
            GoToTop._scrollContainer = container;
            vi.spyOn(GoToTop, '_getAnchor')
                .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));

            await GoToTop.scrollToTopAndWait();

            expect(pas.isEnabled()).toBe(true);
        });

        it('enables PreventAutoScroll during the attempt and restores it to disabled after a timeout', async () => {
            vi.useFakeTimers();
            try {
                const pas = createFakePreventAutoScroll(false);
                window.DSstudio.PreventAutoScroll = pas;

                const container = createScrollContainer();
                const getSampled = sampleIsEnabledOnFirstScrollStep(container, pas);
                GoToTop._scrollContainer = container;
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorAtTop({ top: -1000, bottom: -900, height: 100 }));

                const promise = GoToTop.scrollToTopAndWait({ timeout: 100 });
                vi.advanceTimersByTime(200);
                const result = await promise;

                expect(result).toEqual({ success: false, reason: 'timeout' });
                expect(getSampled()).toBe(true);
                expect(pas.isEnabled()).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('enables PreventAutoScroll during the first attempt and restores it to disabled after being aborted by a second call', async () => {
            vi.useFakeTimers();
            try {
                const pas = createFakePreventAutoScroll(false);
                window.DSstudio.PreventAutoScroll = pas;

                const container = createScrollContainer();
                const getSampled = sampleIsEnabledOnFirstScrollStep(container, pas);
                GoToTop._scrollContainer = container;
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorAtTop({ top: -1000, bottom: -900, height: 100 }));

                const firstPromise = GoToTop.scrollToTopAndWait({ timeout: 5000 });
                vi.advanceTimersByTime(60);
                const secondResult = GoToTop.scrollToTopAndWait();

                expect(secondResult).toBeUndefined();
                await expect(firstPromise).rejects.toEqual({ success: false, reason: 'stopped-by-user' });
                expect(getSampled()).toBe(true);
                expect(pas.isEnabled()).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('runs and settles normally without throwing when window.DSstudio.PreventAutoScroll is entirely absent', async () => {
            delete window.DSstudio.PreventAutoScroll;

            const container = createScrollContainer();
            GoToTop._scrollContainer = container;
            vi.spyOn(GoToTop, '_getAnchor')
                .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));

            await expect(GoToTop.scrollToTopAndWait()).resolves.toEqual({ success: true });
        });
    });
});
