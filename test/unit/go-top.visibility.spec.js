/**
 * GoToTop — scroll position and visibility unit tests.
 * Shared fixtures: test/helpers/go-top-fixtures.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { resetGoToTopState } from '../helpers/go-top-fixtures.js';

describe('GoToTop', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { vi.useRealTimers(); });

    // ─────────────────────────────────────
    //  _isAtTop
    // ─────────────────────────────────────

    describe('_isAtTop', () => {
        // _isAtTop() only trusts:
        //   1. scrollContainer.scrollTop <= 1
        //   2. [data-virtual-list-item-key="1"] in viewport (ANCHOR_SELECTOR_FALLBACK2)
        // Loose selectors like ._9663006 are NOT used for the at-top verdict.

        function createVerifiableAnchor(rect) {
            const el = document.createElement('div');
            el.setAttribute('data-virtual-list-item-key', '1');
            el.getBoundingClientRect = () => rect;
            document.body.appendChild(el);
            return el;
        }

        function createLooseAnchor(rect) {
            // Has ._9663006 class but NOT data-virtual-list-item-key="1"
            const el = document.createElement('div');
            el.className = '_9663006 _2c189bc';
            el.getBoundingClientRect = () => rect;
            document.body.appendChild(el);
            return el;
        }

        it('returns true when verifiable anchor [data-virtual-list-item-key="1"] is fully in viewport', () => {
            createVerifiableAnchor({ top: 50, bottom: 150, height: 100 });
            expect(GoToTop._isAtTop()).toBe(true);
        });

        it('returns false when verifiable anchor is below viewport', () => {
            createVerifiableAnchor({ top: 1000, bottom: 1100, height: 100 });
            expect(GoToTop._isAtTop()).toBe(false);
        });

        it('returns false when verifiable anchor top < 0 (scrolled past)', () => {
            createVerifiableAnchor({ top: -100, bottom: 50, height: 150 });
            expect(GoToTop._isAtTop()).toBe(false);
        });

        it('returns false when no verifiable anchor and no scrollContainer (both absent)', () => {
            document.body.innerHTML = '';
            expect(GoToTop._isAtTop()).toBe(false);
        });

        it('returns false when only loose selector (._9663006) is mounted near viewport — NOT trusted for at-top', () => {
            // Loose selectors no longer drive the at-top verdict
            createLooseAnchor({ top: 10, bottom: 110, height: 100 });
            expect(GoToTop._isAtTop()).toBe(false);
        });

        it('returns false when only loose selectors mounted and scrollTop > 1', () => {
            const container = document.createElement('div');
            container.scrollTop = 50;
            document.body.appendChild(container);
            GoToTop._scrollContainer = container;
            createLooseAnchor({ top: 5, bottom: 105, height: 100 });
            expect(GoToTop._isAtTop()).toBe(false);
        });

        describe('long-message fallback (verifiable anchor)', () => {
            it('returns true when top >= 0 and height > viewport', () => {
                createVerifiableAnchor({ top: 0, bottom: 1000, height: 1000 });
                expect(GoToTop._isAtTop()).toBe(true);
            });

            it('returns false when top < 0 even if height > viewport', () => {
                createVerifiableAnchor({ top: -50, bottom: 950, height: 1000 });
                expect(GoToTop._isAtTop()).toBe(false);
            });
        });

        describe('scrollTop primary condition', () => {
            let container;
            beforeEach(() => {
                container = document.createElement('div');
                container.style.overflowY = 'auto';
                Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
                Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
                document.body.appendChild(container);
                GoToTop._scrollContainer = container;
            });

            it('returns true when scrollTop is 0 (exact)', () => {
                container.scrollTop = 0;
                expect(GoToTop._isAtTop()).toBe(true);
            });

            it('returns true when scrollTop is 1 (epsilon)', () => {
                container.scrollTop = 1;
                expect(GoToTop._isAtTop()).toBe(true);
            });

            it('returns false when scrollTop is 2', () => {
                container.scrollTop = 2;
                expect(GoToTop._isAtTop()).toBe(false);
            });

            it('returns true when scrollTop is 0 even if verifiable anchor absent', () => {
                container.scrollTop = 0;
                // No [data-virtual-list-item-key="1"] in DOM
                expect(GoToTop._isAtTop()).toBe(true);
            });

            it('returns true when scrollTop is 0 but verifiable anchor is below viewport', () => {
                container.scrollTop = 0;
                createVerifiableAnchor({ top: 500, bottom: 600, height: 100 });
                expect(GoToTop._isAtTop()).toBe(true);
            });

            it('returns false when scrollTop > 1 and verifiable anchor below viewport', () => {
                container.scrollTop = 100;
                createVerifiableAnchor({ top: 2000, bottom: 2100, height: 100 });
                expect(GoToTop._isAtTop()).toBe(false);
            });

            it('returns false when scrollTop > 1 and loose anchor in viewport (not trusted)', () => {
                container.scrollTop = 50;
                createLooseAnchor({ top: 10, bottom: 110, height: 100 });
                expect(GoToTop._isAtTop()).toBe(false);
            });
        });
    });

    // ─────────────────────────────────────
    //  _evaluateVisibility
    // ─────────────────────────────────────

    describe('_evaluateVisibility', () => {
        beforeEach(() => {
            GoToTop.enabled = true;
            GoToTop._masterEnabled = true;
            GoToTop._button = document.createElement('div');
            GoToTop._button.style.display = 'none';
        });

        it('shows button when first message bottom < 0', () => {
            const firstMsg = document.createElement('div');
            firstMsg.getBoundingClientRect = () => ({ bottom: -100 });
            document.body.appendChild(firstMsg);

            vi.spyOn(GoToTop, '_getFirstMessage').mockReturnValue(firstMsg);
            vi.spyOn(GoToTop, '_isAtTop').mockReturnValue(false);

            GoToTop._evaluateVisibility();
            expect(GoToTop._button.style.display).toBe('');
        });

        it('hides button when _isAtTop() returns true', () => {
            GoToTop._button.style.display = '';
            vi.spyOn(GoToTop, '_isAtTop').mockReturnValue(true);

            GoToTop._evaluateVisibility();
            expect(GoToTop._button.style.display).toBe('none');
        });

        it('hysteresis: preserves current display when neither condition met', () => {
            GoToTop._button.style.display = '';
            vi.spyOn(GoToTop, '_getFirstMessage').mockReturnValue(null);
            vi.spyOn(GoToTop, '_isAtTop').mockReturnValue(false);

            GoToTop._evaluateVisibility();
            expect(GoToTop._button.style.display).toBe('');
        });

        it('hysteresis: preserves display none when neither condition met', () => {
            GoToTop._button.style.display = 'none';
            vi.spyOn(GoToTop, '_getFirstMessage').mockReturnValue(null);
            vi.spyOn(GoToTop, '_isAtTop').mockReturnValue(false);

            GoToTop._evaluateVisibility();
            expect(GoToTop._button.style.display).toBe('none');
        });

        it('is no-op when disabled', () => {
            GoToTop.enabled = false;
            GoToTop._button.style.display = 'none';

            vi.spyOn(GoToTop, '_getFirstMessage');
            vi.spyOn(GoToTop, '_isAtTop');

            GoToTop._evaluateVisibility();
            expect(GoToTop._getFirstMessage).not.toHaveBeenCalled();
        });

        it('is no-op when button does not exist', () => {
            GoToTop._button = null;

            vi.spyOn(GoToTop, '_getFirstMessage');
            vi.spyOn(GoToTop, '_isAtTop');

            GoToTop._evaluateVisibility();
            expect(GoToTop._getFirstMessage).not.toHaveBeenCalled();
        });

        it('is no-op when _masterEnabled is false', () => {
            GoToTop._masterEnabled = false;
            GoToTop._button.style.display = 'none';

            vi.spyOn(GoToTop, '_getFirstMessage');
            vi.spyOn(GoToTop, '_isAtTop');

            GoToTop._evaluateVisibility();
            expect(GoToTop._getFirstMessage).not.toHaveBeenCalled();
        });
    });

    // ─────────────────────────────────────
    //  scrollToTopAndWait
    // ─────────────────────────────────────

    describe('scrollToTopAndWait', () => {
        function createScrollContainer() {
            const container = document.createElement('div');
            container.style.overflowY = 'auto';
            container.style.height = '100px';
            Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
            container.scrollBy = vi.fn();
            document.body.appendChild(container);
            return container;
        }

        function makeAnchorAtTop(rect) {
            const el = document.createElement('div');
            el.getBoundingClientRect = () => rect;
            return el;
        }

        it('returns a promise', () => {
            const container = createScrollContainer();
            GoToTop._scrollContainer = container;
            vi.spyOn(GoToTop, '_getAnchor')
                .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));

            const result = GoToTop.scrollToTopAndWait();
            expect(result).toBeInstanceOf(Promise);
        });

        it('toggle: second call while locked aborts first scroll with stopped-by-user and returns undefined', async () => {
            vi.useFakeTimers();
            try {
                const container = createScrollContainer();
                GoToTop._scrollContainer = container;
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorAtTop({ top: -1000, bottom: -900, height: 100 }));

                const firstPromise = GoToTop.scrollToTopAndWait({ timeout: 5000 });
                expect(GoToTop._isLocked).toBe(true);

                // Second call while locked: must abort first scroll
                const secondResult = GoToTop.scrollToTopAndWait();
                // Second call returns undefined (not a promise)
                expect(secondResult).toBeUndefined();
                // _isLocked resets to false after abort
                expect(GoToTop._isLocked).toBe(false);
                // First promise rejects with stopped-by-user
                await expect(firstPromise).rejects.toEqual({ success: false, reason: 'stopped-by-user' });
            } finally {
                vi.useRealTimers();
            }
        });

        it('resolves with { success: true } when reaching top', async () => {
            const container = createScrollContainer();
            GoToTop._scrollContainer = container;
            vi.spyOn(GoToTop, '_getAnchor')
                .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));

            const result = await GoToTop.scrollToTopAndWait();
            expect(result).toEqual({ success: true });
        });

        it('scrolls the correct nested scroll container to the top, not document.scrollingElement', async () => {
            const container = createScrollContainer();
            // Give the container a real, independently-tracked scrollTop so the
            // test can observe which element actually ends up at 0, without
            // pinning whichever API (scrollBy, a direct scrollTop write, ...)
            // performs the move. See go-top.scroll-engine.spec.js for the
            // rationale (mechanism is being redesigned from stepping to a jump).
            let scrollTopValue = 300;
            Object.defineProperty(container, 'scrollTop', {
                get: () => scrollTopValue,
                set: (v) => { scrollTopValue = Math.max(0, v); },
                configurable: true,
            });
            container.scrollBy = vi.fn((x, y) => { container.scrollTop = scrollTopValue + y; });
            GoToTop._scrollContainer = container;

            // Anchor tracks the container's REAL scrollTop live, so "at top"
            // only becomes true once the container has genuinely reached 0.
            const anchor = makeAnchorAtTop({ top: 0, bottom: 50, height: 50 });
            anchor.getBoundingClientRect = () => ({
                top: -container.scrollTop,
                bottom: -container.scrollTop + 50,
                height: 50,
            });
            vi.spyOn(GoToTop, '_getAnchor').mockReturnValue(anchor);

            const docScrollingElement = document.scrollingElement || document.documentElement;
            const docScrollTopBefore = docScrollingElement.scrollTop;

            const result = await GoToTop.scrollToTopAndWait();

            expect(result).toEqual({ success: true });
            expect(container.scrollTop).toBe(0);
            expect(docScrollingElement.scrollTop).toBe(docScrollTopBefore);
        });

        it('re-probes scroll container when cached container is invalid', async () => {
            vi.useFakeTimers();
            try {
                GoToTop._scrollContainer = null;

                const newContainer = createScrollContainer();
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));
                vi.spyOn(GoToTop, '_findScrollContainer').mockReturnValue(newContainer);

                const promise = GoToTop.scrollToTopAndWait();
                vi.advanceTimersByTime(500);

                const result = await promise;
                expect(result).toEqual({ success: true });
                expect(GoToTop._findScrollContainer).toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it('does NOT cache document-level fallback (re-probes on next scroll)', async () => {
            GoToTop._scrollContainer = null;
            GoToTop._button = document.createElement('div');
            document.body.appendChild(GoToTop._button);

            vi.spyOn(GoToTop, '_getAnchor')
                .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));

            const result = await GoToTop.scrollToTopAndWait();
            expect(result).toHaveProperty('success');
            const docFallback = document.scrollingElement || document.documentElement;
            expect(GoToTop._scrollContainer).not.toBe(docFallback);
        });

        it('on timeout: resolves with { success: false, reason: timeout }', async () => {
            vi.useFakeTimers();
            try {
                const container = createScrollContainer();
                GoToTop._scrollContainer = container;
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorAtTop({ top: -1000, bottom: -900, height: 100 }));

                const promise = GoToTop.scrollToTopAndWait({ timeout: 100 });
                vi.advanceTimersByTime(200);

                const result = await promise;
                expect(result).toEqual({ success: false, reason: 'timeout' });
            } finally {
                vi.useRealTimers();
            }
        });

        it('aria-disabled stays "false" throughout scroll (never set to true during scroll)', async () => {
            GoToTop._button = GoToTop._createButtonElement(null);
            document.body.appendChild(GoToTop._button);
            const button = GoToTop._button;

            const container = createScrollContainer();
            GoToTop._scrollContainer = container;
            vi.spyOn(GoToTop, '_getAnchor')
                .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));

            expect(button.getAttribute('aria-disabled')).toBe('false');
            await GoToTop.scrollToTopAndWait();
            // aria-disabled must never flip to true; it remains false both during and after scroll
            expect(button.getAttribute('aria-disabled')).toBe('false');
        });

        it('rejects with aborted on route change during scroll', async () => {
            vi.useFakeTimers();
            try {
                const container = createScrollContainer();
                GoToTop._scrollContainer = container;
                vi.spyOn(GoToTop, '_getAnchor')
                    .mockReturnValue(makeAnchorAtTop({ top: -1000, bottom: -900, height: 100 }));

                const promise = GoToTop.scrollToTopAndWait({ timeout: 5000 });
                GoToTop._onRouteChange();

                await expect(promise).rejects.toEqual({ success: false, reason: 'aborted' });
                expect(GoToTop._isLocked).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
