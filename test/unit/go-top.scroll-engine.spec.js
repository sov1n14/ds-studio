/**
 * GoToTop — scroll-engine redesign unit tests (jump-based convergence).
 * Shared fixtures: test/helpers/go-top-fixtures.js
 *
 * Requirement under test: scrollToTopAndWait() is being redesigned from
 * stepping upward one viewport at a time (scrollBy(0, -innerHeight * 0.9),
 * polling every ANCHOR_POLL_INTERVAL) to a jump: set scrollTop = 0 directly,
 * then re-jump if the virtualized list lazily mounts older messages above
 * and grows underneath it. The existing convergence gate (stable
 * scrollHeight across STABLE_REQUIRED polls, then _isAtTop() anchor
 * verification) is retained unchanged.
 *
 *   R1 — arrival is not proportional to conversation length: a very tall
 *        (50x viewport), non-growing container reaches scrollTop 0 within a
 *        small constant poll-interval budget — not a budget scaled to
 *        container height. This is the core test for the redesign.
 *   R2 — lazy-mount regrowth is still handled: if scrollHeight grows (and
 *        scrollTop is consequently no longer 0) after the first arrival,
 *        the function scrolls again and resolves only once height has
 *        stabilized.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState } from '../helpers/go-top-fixtures.js';

/**
 * Builds a scroll container whose `scrollTop` is a real, independently
 * tracked value (get/set), and whose `scrollBy` routes through that same
 * setter — so the test observes the actual final state regardless of
 * whether the implementation moves the container via stepped scrollBy
 * calls or a single direct scrollTop write.
 *
 * If `growth` is provided, the FIRST time scrollTop lands exactly on 0,
 * scrollHeight grows by `growth` and scrollTop is pushed back up by the
 * same amount — simulating a virtualized list mounting older messages
 * above the viewport (a real browser preserves visual scroll position when
 * content is inserted above what's currently visible).
 */
function createStatefulContainer({ scrollHeight, clientHeight, initialScrollTop, growth = 0 }) {
    const container = document.createElement('div');
    container.style.overflowY = 'auto';
    let scrollHeightValue = scrollHeight;
    let scrollTopValue = initialScrollTop;
    let hasGrown = false;

    Object.defineProperty(container, 'scrollHeight', { get: () => scrollHeightValue, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(container, 'scrollTop', {
        get: () => scrollTopValue,
        set: (v) => {
            scrollTopValue = Math.max(0, v);
            if (growth > 0 && scrollTopValue === 0 && !hasGrown) {
                hasGrown = true;
                scrollHeightValue += growth;
                scrollTopValue = growth;
            }
        },
        configurable: true,
    });
    container.scrollBy = vi.fn((x, y) => { container.scrollTop = scrollTopValue + y; });

    document.body.appendChild(container);
    return container;
}

/**
 * Anchor whose bounding rect tracks the container's REAL scrollTop live, so
 * the "at top" verdict genuinely depends on the container's current scroll
 * position rather than a value snapshotted once at mock-setup time. This is
 * what makes the test mechanism-agnostic: it passes whether convergence is
 * driven by stepped scrollBy calls or a single scrollTop write.
 */
function makeAnchorTrackingContainer(container) {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({
        top: -container.scrollTop,
        bottom: -container.scrollTop + 50,
        height: 50,
    });
    return el;
}

describe('GoToTop', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { vi.useRealTimers(); });

    describe('scrollToTopAndWait — jump-based convergence', () => {
        it('R1: reaches scrollTop 0 within a small constant poll-interval budget on a very tall, non-growing container (not proportional to container height)', async () => {
            vi.useFakeTimers();
            const originalInnerHeight = window.innerHeight;
            try {
                // Fix the viewport height so the step size of the OLD
                // mechanism (0.9 * innerHeight) is deterministic.
                Object.defineProperty(window, 'innerHeight', { value: 100, configurable: true });

                const clientHeight = 100;
                // 50 viewports tall, scrolled all the way to the bottom —
                // distance-to-top ≈ 49 viewports.
                const container = createStatefulContainer({
                    scrollHeight: clientHeight * 50,
                    clientHeight,
                    initialScrollTop: clientHeight * 49,
                });
                GoToTop._scrollContainer = container;
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorTrackingContainer(container));

                let settled = false;
                let settledResult;
                GoToTop.scrollToTopAndWait({ timeout: 20000 }).then(
                    (r) => { settled = true; settledResult = r; },
                    (e) => { settled = true; settledResult = e; }
                );

                // Budget: a handful of poll intervals — far below what stepping
                // one viewport (0.9 * innerHeight = 90px) at a time across a
                // 4900px distance would need (≈55 steps * ANCHOR_POLL_INTERVAL
                // ≈ 5.5s, matching the ~56-step / 5.9s figure for a 50-viewport
                // conversation).
                const budget = GoToTop.ANCHOR_POLL_INTERVAL * 15;
                await vi.advanceTimersByTimeAsync(budget);

                expect(settled).toBe(true);
                expect(settledResult).toEqual({ success: true });
                expect(container.scrollTop).toBe(0);
            } finally {
                Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
                vi.useRealTimers();
            }
        });

        it('R2: re-scrolls to top when scrollHeight grows (lazy-mounted older messages) after the first arrival, and resolves only once height stabilizes', async () => {
            vi.useFakeTimers();
            try {
                const clientHeight = 100;
                const container = createStatefulContainer({
                    scrollHeight: clientHeight * 10,
                    clientHeight,
                    initialScrollTop: clientHeight * 9,
                    growth: clientHeight * 2,
                });
                GoToTop._scrollContainer = container;
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorTrackingContainer(container));

                const promise = GoToTop.scrollToTopAndWait({ timeout: 20000 });
                await vi.advanceTimersByTimeAsync(20000);
                const result = await promise;

                expect(result).toEqual({ success: true });
                expect(container.scrollTop).toBe(0);
                // Growth must actually have fired — otherwise this test proves
                // nothing about regrowth handling.
                expect(container.scrollHeight).toBe(clientHeight * 12);
            } finally {
                vi.useRealTimers();
            }
        });

        it('uses this.TIMEOUT as default timeout when options.timeout is not provided', async () => {
            vi.useFakeTimers();
            try {
                const clientHeight = 100;
                const container = createStatefulContainer({
                    scrollHeight: clientHeight * 10,
                    clientHeight,
                    initialScrollTop: 0,
                });
                GoToTop._scrollContainer = container;
                // Anchor never at top -> forces timeout path
                vi.spyOn(GoToTop, '_isAtTop').mockReturnValue(false);
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorTrackingContainer(container));

                const originalTimeout = GoToTop.TIMEOUT;
                GoToTop.TIMEOUT = 500;

                let settled = false;
                let settledResult;
                // No options.timeout -> should fall back to this.TIMEOUT (500ms)
                GoToTop.scrollToTopAndWait().then(
                    (r) => { settled = true; settledResult = r; },
                    (e) => { settled = true; settledResult = e; }
                );

                // Just before TIMEOUT (500ms): should not have resolved yet
                await vi.advanceTimersByTimeAsync(400);
                expect(settled).toBe(false);

                // Past TIMEOUT: should resolve with timeout reason
                await vi.advanceTimersByTimeAsync(200);
                expect(settled).toBe(true);
                expect(settledResult).toEqual({ success: false, reason: 'timeout' });

                GoToTop.TIMEOUT = originalTimeout;
            } finally {
                vi.useRealTimers();
            }
        });

        it('DOM mutation on scroll container resets stability count, requiring additional ticks to converge', async () => {
            vi.useFakeTimers();
            try {
                // Capture the MutationObserver callback so we can invoke it manually
                // (happy-dom may not fire MO callbacks synchronously with fake timers)
                let moCallback;
                const OrigMO = globalThis.MutationObserver;
                globalThis.MutationObserver = class {
                    constructor(cb) { moCallback = cb; }
                    observe() {}
                    disconnect() {}
                };

                const container = document.createElement('div');
                container.style.overflowY = 'auto';
                Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
                Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
                let scrollTopVal = 0;
                Object.defineProperty(container, 'scrollTop', {
                    get: () => scrollTopVal,
                    set: (v) => { scrollTopVal = Math.max(0, v); },
                    configurable: true,
                });
                document.body.appendChild(container);

                GoToTop._scrollContainer = container;
                vi.spyOn(GoToTop, '_isAtTop').mockReturnValue(true);
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(document.createElement('div'));

                let settled = false;
                let settledResult;
                GoToTop.scrollToTopAndWait({ timeout: 10000 }).then(
                    (r) => { settled = true; settledResult = r; },
                    (e) => { settled = true; settledResult = e; }
                );

                // step() fires immediately at time 0:
                //   _lastScrollHeight = -1 -> 500, _stableTopCount = 0, scheduleNext()
                // +100ms (tick 1): _stableTopCount = 1, scheduleNext()
                // +200ms (tick 2): _stableTopCount = 2, scheduleNext()
                // Without mutation, +300ms (tick 3): _stableTopCount = 3 >= STABLE_REQUIRED -> resolve
                await vi.advanceTimersByTimeAsync(GoToTop.ANCHOR_POLL_INTERVAL * 2);

                // Manually fire the MO callback to simulate a childList mutation
                moCallback([{ type: 'childList' }]);

                // Without the _stableTopCount = 0 reset in the MO callback,
                // the next tick would see _stableTopCount = 3 and resolve immediately.
                // With the reset, 3 more stable ticks are needed before convergence.
                await vi.advanceTimersByTimeAsync(GoToTop.ANCHOR_POLL_INTERVAL * 1);
                expect(settled).toBe(false);

                // Allow enough time for stability to rebuild (3 more stable ticks)
                await vi.advanceTimersByTimeAsync(GoToTop.ANCHOR_POLL_INTERVAL * 5);
                expect(settled).toBe(true);
                expect(settledResult).toEqual({ success: true });

                globalThis.MutationObserver = OrigMO;
            } finally {
                vi.useRealTimers();
            }
        });

        it('resolves anchor_not_found via early-return when anchor is absent and scrollTop is 0 before stability is reached', async () => {
            vi.useFakeTimers();
            try {
                const container = document.createElement('div');
                container.style.overflowY = 'auto';
                // scrollHeight changes on every read so _stableTopCount never reaches STABLE_REQUIRED
                let heightCounter = 1000;
                Object.defineProperty(container, 'scrollHeight', {
                    get: () => ++heightCounter,
                    configurable: true,
                });
                Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
                Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
                document.body.appendChild(container);

                GoToTop._scrollContainer = container;
                // Anchor absent -> consecutiveMisses increments each tick
                vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(null);

                const promise = GoToTop.scrollToTopAndWait({ timeout: 30000 });
                // MAX_ANCHOR_RETRIES(5) ticks at ANCHOR_POLL_INTERVAL(100ms) + margin
                await vi.advanceTimersByTimeAsync(GoToTop.ANCHOR_POLL_INTERVAL * 10);
                const result = await promise;

                expect(result).toEqual({ success: false, reason: 'anchor_not_found' });
            } finally {
                vi.useRealTimers();
            }
        });

    });
});
