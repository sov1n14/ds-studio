import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import StorageManager from '../../utils/storage-manager.js';

describe('GoToTop', () => {
    // ─── Shared fixture helpers ───────────────────────────────────────────────

    /**
     * Creates the live-site DOM structure:
     *   ._871cbca > .aaff8b8f > (optional nativeBtn)
     * Returns { outerWrapper, injectParent }.
     */
    function createWrapperWithoutNativeButton() {
        const outerWrapper = document.createElement('div');
        outerWrapper.className = '_871cbca';
        const injectParent = document.createElement('div');
        injectParent.className = 'aaff8b8f';
        const inputArea = document.createElement('div');
        injectParent.appendChild(inputArea);
        outerWrapper.appendChild(injectParent);
        document.body.appendChild(outerWrapper);
        return { outerWrapper, injectParent };
    }

    /**
     * Creates a native go-bottom button matching the live-site fixture
     * (go-bottom.html ground truth).
     */
    function createNativeButton() {
        const nativeBtn = document.createElement('div');
        nativeBtn.setAttribute('role', 'button');
        nativeBtn.className =
            'ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ' +
            'ds-button--m ds-button--icon-relative-m ds-button--floating _0706cde';
        nativeBtn.setAttribute('tabindex', '0');
        nativeBtn.setAttribute('style',
            '--dsl-button-color: var(--dsw-alias-button-floating-fill); ' +
            '--dsl-button-height: 34px; ' +
            '--dsl-button-hover-color: var(--dsw-alias-button-floating-hover); ' +
            '--dsl-button-icon-size: 14px;');

        const bg = document.createElement('div');
        bg.className = 'ds-button__background';
        const border = document.createElement('div');
        border.className = 'ds-button__border';
        const icon = document.createElement('div');
        icon.className = 'ds-button__icon ds-button__icon--last-child';
        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" ' +
            'xmlns="http://www.w3.org/2000/svg"><path d="M11.8486 5.5" fill="currentColor"></path></svg>';
        nativeBtn.appendChild(bg);
        nativeBtn.appendChild(border);
        nativeBtn.appendChild(icon);
        return nativeBtn;
    }

    /**
     * Creates the full live-site context:
     *   ._871cbca > .aaff8b8f > nativeBtn
     */
    function createFullWrapperWithNativeButton() {
        const { outerWrapper, injectParent } = createWrapperWithoutNativeButton();
        const nativeBtn = createNativeButton();
        injectParent.appendChild(nativeBtn);
        return { outerWrapper, injectParent, nativeBtn };
    }

    // ─── beforeEach / afterEach ───────────────────────────────────────────────

    beforeEach(() => {
        GoToTop.disable();
        GoToTop.enabled = false;
        GoToTop._masterEnabled = false;
        GoToTop._locked = false;
        GoToTop._degraded = false;
        GoToTop._missCount = 0;
        GoToTop._hasSeenDom = false;
        GoToTop._button = null;
        GoToTop._injectionMode = null;
        GoToTop._scrollContainer = null;
        GoToTop._scrollPromise = null;
        GoToTop._scrollResolve = null;
        GoToTop._scrollReject = null;
        GoToTop._observer = null;
        GoToTop._routeObserver = null;
        GoToTop._wrapperObserver = null;
        GoToTop._wrapperObserverTimer = null;
        GoToTop._scrollListener = null;
        GoToTop._popstateHandler = null;
        GoToTop._observerTimer = null;
        GoToTop._enableRetryTimer = null;
        GoToTop._enableRetryCount = 0;
        GoToTop._lastPath = '';
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ─────────────────────────────────────
    //  Constructor / state
    // ─────────────────────────────────────

    describe('constructor / state', () => {
        it('has default state values', () => {
            expect(GoToTop.enabled).toBe(false);
            expect(GoToTop._masterEnabled).toBe(false);
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._injectionMode).toBeNull();
            expect(GoToTop._scrollContainer).toBeNull();
            expect(GoToTop._locked).toBe(false);
            expect(GoToTop._degraded).toBe(false);
            expect(GoToTop._missCount).toBe(0);
            expect(GoToTop._hasSeenDom).toBe(false);
            expect(GoToTop._scrollPromise).toBeNull();
            expect(GoToTop._scrollResolve).toBeNull();
            expect(GoToTop._scrollReject).toBeNull();
            expect(GoToTop._wrapperObserver).toBeNull();
            expect(GoToTop._wrapperObserverTimer).toBeNull();
            expect(GoToTop._enableRetryTimer).toBeNull();
            expect(GoToTop._enableRetryCount).toBe(0);
            expect(GoToTop._lastPath).toBe('');
        });

        it('has correct constants', () => {
            expect(GoToTop.TIMEOUT).toBe(30000);
            expect(GoToTop.ANCHOR_POLL_INTERVAL).toBe(100);
            expect(GoToTop.MAX_ANCHOR_RETRIES).toBe(5);
            expect(GoToTop.DEGRADED_THRESHOLD).toBe(3);
            expect(GoToTop.SCROLL_STEP_FACTOR).toBe(0.9);
            expect(GoToTop.OBSERVER_DEBOUNCE).toBe(50);
            expect(GoToTop.WRAPPER_OBSERVER_DEBOUNCE).toBe(80);
            // New ds-button constants (v2.9+)
            expect(GoToTop.NATIVE_BTN_TAG).toBe('div');
            expect(GoToTop.NATIVE_BTN_CLASSES).toBe(
                'ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ' +
                'ds-button--m ds-button--icon-relative-m ds-button--floating'
            );
            expect(GoToTop.NATIVE_BTN_CLASSES).not.toContain('_0706cde');
            expect(GoToTop.NATIVE_BTN_INLINE_STYLE).toContain('--dsl-button-height: 34px');
            expect(GoToTop.NATIVE_BTN_INLINE_STYLE).toContain('--dsl-button-color');
            expect(GoToTop.NATIVE_BTN_INLINE_STYLE).toContain('--dsl-button-hover-color');
            expect(GoToTop.NATIVE_BTN_INLINE_STYLE).toContain('--dsl-button-icon-size: 14px');
            expect(GoToTop.STACK_GAP_PX).toBe(8);
            // Deleted constants must NOT exist
            expect(GoToTop.NATIVE_BTN_PADDING).toBeUndefined();
            expect(GoToTop.NATIVE_BTN_FONT_SIZE).toBeUndefined();
            expect(GoToTop.NATIVE_BTN_LINE_HEIGHT).toBeUndefined();
        });
    });

    // ─────────────────────────────────────
    //  _querySelectorWithFallback
    // ─────────────────────────────────────

    describe('_querySelectorWithFallback', () => {
        it('returns the first matching element', () => {
            const div1 = document.createElement('div');
            div1.className = 'foo';
            const div2 = document.createElement('div');
            div2.className = 'bar';
            document.body.append(div1, div2);

            const result = GoToTop._querySelectorWithFallback(['.foo', '.bar']);
            expect(result).toBe(div1);
        });

        it('returns null when no selectors match', () => {
            const result = GoToTop._querySelectorWithFallback(['.nonexistent', '.also-missing']);
            expect(result).toBeNull();
        });

        it('returns null for empty selectors array', () => {
            expect(GoToTop._querySelectorWithFallback([])).toBeNull();
            expect(GoToTop._querySelectorWithFallback(null)).toBeNull();
        });

        it('increments _missCount on failure when DOM was previously seen', () => {
            GoToTop._missCount = 0;
            GoToTop._hasSeenDom = true;
            GoToTop._querySelectorWithFallback(['.nonexistent']);
            expect(GoToTop._missCount).toBe(1);
        });

        it('does NOT increment _missCount before DOM is first seen', () => {
            GoToTop._missCount = 0;
            GoToTop._hasSeenDom = false;
            GoToTop._querySelectorWithFallback(['.nonexistent']);
            expect(GoToTop._missCount).toBe(0);
        });

        it('resets _missCount to 0 on success', () => {
            const div = document.createElement('div');
            div.className = 'hit';
            document.body.appendChild(div);

            GoToTop._missCount = 5;
            GoToTop._querySelectorWithFallback(['.hit']);
            expect(GoToTop._missCount).toBe(0);
        });

        it('sets _hasSeenDom on first success', () => {
            GoToTop._hasSeenDom = false;
            const div = document.createElement('div');
            div.className = 'hit';
            document.body.appendChild(div);

            GoToTop._querySelectorWithFallback(['.hit']);
            expect(GoToTop._hasSeenDom).toBe(true);
        });

        it('sets _degraded after DEGRADED_THRESHOLD misses when DOM was seen', () => {
            GoToTop._missCount = 0;
            GoToTop._degraded = false;
            GoToTop._hasSeenDom = true;

            for (let i = 0; i < GoToTop.DEGRADED_THRESHOLD - 1; i++) {
                GoToTop._querySelectorWithFallback(['.nope']);
            }
            expect(GoToTop._degraded).toBe(false);

            GoToTop._querySelectorWithFallback(['.nope']);
            expect(GoToTop._degraded).toBe(true);
        });

        it('does not warn repeatedly once already degraded', () => {
            GoToTop._degraded = true;
            GoToTop._hasSeenDom = true;
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            GoToTop._querySelectorWithFallback(['.nope']);
            expect(warn).not.toHaveBeenCalled();

            warn.mockRestore();
        });
    });

    // ─────────────────────────────────────
    //  _findScrollContainer
    // ─────────────────────────────────────

    describe('_findScrollContainer (BUG FIX #1: .ds-scroll-area resolution)', () => {
        it('Strategy 1: walks UP from anchor to find nearest .ds-scroll-area ancestor', () => {
            const dsScrollArea = document.createElement('div');
            dsScrollArea.className = 'ds-scroll-area';
            Object.defineProperty(dsScrollArea, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(dsScrollArea, 'clientHeight', { value: 100, configurable: true });

            const anchor = document.createElement('span');
            dsScrollArea.appendChild(anchor);
            document.body.appendChild(dsScrollArea);

            const result = GoToTop._findScrollContainer(anchor);
            expect(result).toBe(dsScrollArea);
            expect(GoToTop._scrollContainer).toBe(dsScrollArea);
        });

        it('Strategy 1 does NOT pick up sidebar .ds-scroll-area when anchor is in message list', () => {
            const sidebarScrollArea = document.createElement('div');
            sidebarScrollArea.className = 'ds-scroll-area';
            Object.defineProperty(sidebarScrollArea, 'scrollHeight', { value: 800, configurable: true });
            Object.defineProperty(sidebarScrollArea, 'clientHeight', { value: 100, configurable: true });

            const msgListScrollArea = document.createElement('div');
            msgListScrollArea.className = '_765a5cd ds-scroll-area';
            Object.defineProperty(msgListScrollArea, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(msgListScrollArea, 'clientHeight', { value: 100, configurable: true });

            const anchor = document.createElement('span');
            anchor.className = '_9663006 _2c189bc';
            msgListScrollArea.appendChild(anchor);

            document.body.appendChild(sidebarScrollArea);
            document.body.appendChild(msgListScrollArea);

            const result = GoToTop._findScrollContainer(anchor);
            expect(result).toBe(msgListScrollArea);
            expect(result).not.toBe(sidebarScrollArea);
        });

        it('Strategy 2 fallback: uses virtual-list walk-up when anchor is not inside .ds-scroll-area', () => {
            const dsScrollArea = document.createElement('div');
            dsScrollArea.className = 'ds-scroll-area';
            Object.defineProperty(dsScrollArea, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(dsScrollArea, 'clientHeight', { value: 100, configurable: true });

            const virtualListItems = document.createElement('div');
            virtualListItems.className = 'ds-virtual-list-items';
            dsScrollArea.appendChild(virtualListItems);

            document.body.appendChild(dsScrollArea);

            const anchor = document.createElement('span');
            document.body.appendChild(anchor);

            const result = GoToTop._findScrollContainer(anchor);
            expect(result).toBe(dsScrollArea);
            expect(GoToTop._scrollContainer).toBe(dsScrollArea);
        });

        it('validates scrollHeight > clientHeight before caching .ds-scroll-area', () => {
            const dsScrollArea = document.createElement('div');
            dsScrollArea.className = 'ds-scroll-area';
            Object.defineProperty(dsScrollArea, 'scrollHeight', { value: 100, configurable: true });
            Object.defineProperty(dsScrollArea, 'clientHeight', { value: 200, configurable: true });
            document.body.appendChild(dsScrollArea);

            const anchor = document.createElement('span');
            document.body.appendChild(anchor);

            GoToTop._scrollContainer = null;
            const fallback = document.scrollingElement || document.documentElement;
            const result = GoToTop._findScrollContainer(anchor);
            expect(result).toBe(fallback);
            expect(GoToTop._scrollContainer).toBeNull();
        });

        it('walks up from anchor to find overflow-y:auto ancestor', () => {
            const wrapper = document.createElement('div');
            const container = document.createElement('div');
            container.style.overflowY = 'auto';
            Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
            const anchor = document.createElement('span');
            container.appendChild(anchor);
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            GoToTop._scrollContainer = null;
            const result = GoToTop._findScrollContainer(anchor);
            expect(result).toBe(container);
            expect(GoToTop._scrollContainer).toBe(container);
        });

        it('does NOT cache document-level fallback for re-probing on next call', () => {
            const anchor = document.createElement('span');
            document.body.appendChild(anchor);

            GoToTop._scrollContainer = null;
            GoToTop._findScrollContainer(anchor);

            const newContainer = document.createElement('div');
            newContainer.style.overflowY = 'auto';
            Object.defineProperty(newContainer, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(newContainer, 'clientHeight', { value: 100, configurable: true });
            newContainer.appendChild(anchor);
            document.body.insertBefore(newContainer, document.body.firstChild);

            GoToTop._scrollContainer = null;
            const result = GoToTop._findScrollContainer(anchor);
            expect(result).toBe(newContainer);
        });

        it('falls back to document.scrollingElement when no container found', () => {
            const anchor = document.createElement('span');
            document.body.appendChild(anchor);

            GoToTop._scrollContainer = null;
            const fallback = document.scrollingElement || document.documentElement;
            const result = GoToTop._findScrollContainer(anchor);
            expect(result).toBe(fallback);
            expect(GoToTop._scrollContainer).toBeNull();
        });

        it('returns document.scrollingElement when anchor is null', () => {
            const fallback = document.scrollingElement || document.documentElement;
            const result = GoToTop._findScrollContainer(null);
            expect(result).toBe(fallback);
        });
    });

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
    //  _getNativeButton
    // ─────────────────────────────────────

    describe('_getNativeButton', () => {
        it('detects native button by primary selector ._0706cde', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();
            // Reset hasSeenDom so fallback chain is consulted
            GoToTop._hasSeenDom = false;
            const result = GoToTop._getNativeButton();
            expect(result).toBe(nativeBtn);
        });

        it('never returns our own .dsw-gotop button even when it structurally matches', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            // Inject a GoTop button that carries ds-button--floating + ds-button--circle
            const ourBtn = document.createElement('div');
            ourBtn.className =
                'ds-button ds-button--floating ds-button--circle ds-button--m dsw-gotop';
            ourBtn.setAttribute('role', 'button');
            injectParent.appendChild(ourBtn);

            GoToTop._hasSeenDom = true;

            const result = GoToTop._getNativeButton();
            // Our own button must never be returned
            expect(result).not.toBe(ourBtn);
        });

        it('falls back to structural selector when _0706cde is absent', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            // Native button without the hash class (renamed scenario)
            const nativeBtn = document.createElement('div');
            nativeBtn.setAttribute('role', 'button');
            nativeBtn.className =
                'ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ' +
                'ds-button--m ds-button--icon-relative-m ds-button--floating';
            injectParent.appendChild(nativeBtn);

            GoToTop._hasSeenDom = true;

            const result = GoToTop._getNativeButton();
            expect(result).toBe(nativeBtn);
        });

        it('returns null when no native button is present', () => {
            // DOM is empty; _hasSeenDom = false so miss is not counted
            GoToTop._hasSeenDom = false;
            expect(GoToTop._getNativeButton()).toBeNull();
        });

        it('does not return null when native button exists and _hasSeenDom is true', () => {
            const { nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._hasSeenDom = true;
            const result = GoToTop._getNativeButton();
            expect(result).not.toBeNull();
        });

        it('fallback rejects primary button (post-validation): matches fallback selector but has ds-button--primary', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            // A button matching fallback #2/#3/#4 (ds-button--floating + ds-button--circle inside .aaff8b8f)
            // but fails post-validation because it carries ds-button--primary (and ds-button--filled, etc.)
            const wrongBtn = document.createElement('div');
            wrongBtn.setAttribute('role', 'button');
            wrongBtn.className =
                'ds-button ds-button--primary ds-button--filled ds-button--floating ' +
                'ds-button--circle ds-button--m ds-button--disabled _52c986b';
            injectParent.appendChild(wrongBtn);

            GoToTop._hasSeenDom = true;
            const result = GoToTop._getNativeButton();
            expect(result).toBeNull();
        });

        it('fallback rejects non-floating button: no ds-button--floating means no fallback match', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            // A button without ds-button--floating cannot match any fallback selector
            const wrongBtn = document.createElement('div');
            wrongBtn.setAttribute('role', 'button');
            wrongBtn.className =
                'ds-button ds-button--primary ds-button--filled ' +
                'ds-button--circle ds-button--m ds-button--disabled _52c986b';
            injectParent.appendChild(wrongBtn);

            GoToTop._hasSeenDom = true;
            const result = GoToTop._getNativeButton();
            expect(result).toBeNull();
        });
    });

    // ─────────────────────────────────────
    //  _createButtonElement
    // ─────────────────────────────────────

    describe('_createButtonElement', () => {
        // ── Template (fallback) path ─────────────────────────────────────────

        it('template path: creates a <div> (NATIVE_BTN_TAG) when nativeBtn is null', () => {
            const btn = GoToTop._createButtonElement(null);
            expect(btn).not.toBeNull();
            expect(btn.tagName).toBe('DIV');
        });

        it('template path: applies NATIVE_BTN_CLASSES (no _0706cde)', () => {
            const btn = GoToTop._createButtonElement(null);
            // Must have all stable ds-* classes
            expect(btn.classList.contains('ds-button')).toBe(true);
            expect(btn.classList.contains('ds-button--outlinedNeutral')).toBe(true);
            expect(btn.classList.contains('ds-button--outlined')).toBe(true);
            expect(btn.classList.contains('ds-button--circle')).toBe(true);
            expect(btn.classList.contains('ds-button--m')).toBe(true);
            expect(btn.classList.contains('ds-button--icon-relative-m')).toBe(true);
            expect(btn.classList.contains('ds-button--floating')).toBe(true);
            // Must NOT carry the hash class
            expect(btn.classList.contains('_0706cde')).toBe(false);
        });

        it('template path: sets NATIVE_BTN_INLINE_STYLE via setAttribute("style", ...)', () => {
            const btn = GoToTop._createButtonElement(null);
            const style = btn.getAttribute('style');
            expect(style).toContain('--dsl-button-height: 34px');
            expect(style).toContain('--dsl-button-color');
            expect(style).toContain('--dsl-button-hover-color');
            expect(style).toContain('--dsl-button-icon-size: 14px');
        });

        it('template path: builds three child divs — ds-button__background, ds-button__border, ds-button__icon', () => {
            const btn = GoToTop._createButtonElement(null);
            expect(btn.querySelector('.ds-button__background')).not.toBeNull();
            expect(btn.querySelector('.ds-button__border')).not.toBeNull();
            expect(btn.querySelector('.ds-button__icon')).not.toBeNull();
        });

        it('template path: no <span> tail element', () => {
            const btn = GoToTop._createButtonElement(null);
            expect(btn.querySelector('span')).toBeNull();
        });

        it('template path: no inline padding, fontSize, or lineHeight', () => {
            const btn = GoToTop._createButtonElement(null);
            // These properties belonged to the old design and must be absent
            expect(btn.style.padding).toBe('');
            expect(btn.style.fontSize).toBe('');
            expect(btn.style.lineHeight).toBe('');
        });

        // ── Clone (main) path ────────────────────────────────────────────────

        it('clone path: clones the native button (same tag)', () => {
            const nativeBtn = createNativeButton();
            const btn = GoToTop._createButtonElement(nativeBtn);
            expect(btn.tagName).toBe('DIV');
        });

        it('clone path: removes _0706cde from cloned element', () => {
            const nativeBtn = createNativeButton();
            expect(nativeBtn.classList.contains('_0706cde')).toBe(true);

            const btn = GoToTop._createButtonElement(nativeBtn);
            expect(btn.classList.contains('_0706cde')).toBe(false);
        });

        it('clone path: preserves all stable ds-* classes from native', () => {
            const nativeBtn = createNativeButton();
            const btn = GoToTop._createButtonElement(nativeBtn);
            expect(btn.classList.contains('ds-button')).toBe(true);
            expect(btn.classList.contains('ds-button--floating')).toBe(true);
            expect(btn.classList.contains('ds-button--circle')).toBe(true);
            expect(btn.classList.contains('ds-button--m')).toBe(true);
        });

        // ── Shared (both paths) ──────────────────────────────────────────────

        it('both paths: adds dsw-gotop class', () => {
            expect(GoToTop._createButtonElement(null).classList.contains('dsw-gotop')).toBe(true);
            expect(GoToTop._createButtonElement(createNativeButton()).classList.contains('dsw-gotop')).toBe(true);
        });

        it('both paths: sets role="button"', () => {
            expect(GoToTop._createButtonElement(null).getAttribute('role')).toBe('button');
            expect(GoToTop._createButtonElement(createNativeButton()).getAttribute('role')).toBe('button');
        });

        it('both paths: sets tabindex="0"', () => {
            expect(GoToTop._createButtonElement(null).getAttribute('tabindex')).toBe('0');
            expect(GoToTop._createButtonElement(createNativeButton()).getAttribute('tabindex')).toBe('0');
        });

        it('both paths: sets aria-disabled="false"', () => {
            expect(GoToTop._createButtonElement(null).getAttribute('aria-disabled')).toBe('false');
            expect(GoToTop._createButtonElement(createNativeButton()).getAttribute('aria-disabled')).toBe('false');
        });

        it('both paths: sets aria-label="回到頂部"', () => {
            expect(GoToTop._createButtonElement(null).getAttribute('aria-label')).toBe('回到頂部');
            expect(GoToTop._createButtonElement(createNativeButton()).getAttribute('aria-label')).toBe('回到頂部');
        });

        it('both paths: icon inside .ds-button__icon has scaleY(-1) transform', () => {
            for (const nativeBtn of [null, createNativeButton()]) {
                const btn = GoToTop._createButtonElement(nativeBtn);
                const svg = btn.querySelector('.ds-button__icon svg');
                expect(svg, `nativeBtn=${nativeBtn}`).not.toBeNull();
                expect(svg.style.transform).toContain('scaleY(-1)');
            }
        });

        it('both paths: SVG icon has fill="currentColor" on path element', () => {
            for (const nativeBtn of [null, createNativeButton()]) {
                const btn = GoToTop._createButtonElement(nativeBtn);
                const path = btn.querySelector('.ds-button__icon svg path');
                expect(path, `nativeBtn=${nativeBtn}`).not.toBeNull();
                expect(path.getAttribute('fill')).toBe('currentColor');
            }
        });

        it('both paths: click handler calls scrollToTopAndWait', () => {
            const spy = vi.spyOn(GoToTop, 'scrollToTopAndWait').mockResolvedValue({ success: true });
            GoToTop._createButtonElement(null).click();
            expect(spy).toHaveBeenCalledOnce();
        });

        it('both paths: Enter key triggers scrollToTopAndWait', () => {
            const spy = vi.spyOn(GoToTop, 'scrollToTopAndWait').mockResolvedValue({ success: true });
            const btn = GoToTop._createButtonElement(null);
            btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            expect(spy).toHaveBeenCalledOnce();
        });

        it('both paths: Space key triggers scrollToTopAndWait', () => {
            const spy = vi.spyOn(GoToTop, 'scrollToTopAndWait').mockResolvedValue({ success: true });
            const btn = GoToTop._createButtonElement(null);
            btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
            expect(spy).toHaveBeenCalledOnce();
        });

        it('both paths: other keys do not trigger scroll', () => {
            const spy = vi.spyOn(GoToTop, 'scrollToTopAndWait').mockResolvedValue({ success: true });
            const btn = GoToTop._createButtonElement(null);
            btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not throw when nativeBtn is null', () => {
            expect(() => GoToTop._createButtonElement(null)).not.toThrow();
        });
    });

    // ─────────────────────────────────────
    //  _locateWrapperElements
    // ─────────────────────────────────────

    describe('_locateWrapperElements', () => {
        it('returns { injectParent, outerWrapper } with correct nesting', () => {
            const outerWrapper = document.createElement('div');
            const injectParent = document.createElement('div');
            const nativeBtn = document.createElement('div');
            injectParent.appendChild(nativeBtn);
            outerWrapper.appendChild(injectParent);
            document.body.appendChild(outerWrapper);

            const result = GoToTop._locateWrapperElements(nativeBtn);
            expect(result).toEqual({ injectParent, outerWrapper });
        });

        it('returns null for null input', () => {
            expect(GoToTop._locateWrapperElements(null)).toBeNull();
        });

        it('returns null when button has no parentElement', () => {
            const orphanBtn = document.createElement('div');
            expect(GoToTop._locateWrapperElements(orphanBtn)).toBeNull();
        });

        it('uses injectParent as outerWrapper when injectParent has no parent', () => {
            const injectParent = document.createElement('div');
            const nativeBtn = document.createElement('div');
            injectParent.appendChild(nativeBtn);

            const result = GoToTop._locateWrapperElements(nativeBtn);
            expect(result.injectParent).toBe(injectParent);
            expect(result.outerWrapper).toBe(injectParent);
        });

        it('native button parentElement is the immediate container', () => {
            const outerWrapper = document.createElement('div');
            const injectParent = document.createElement('div');
            const nativeBtn = document.createElement('div');
            injectParent.appendChild(nativeBtn);
            outerWrapper.appendChild(injectParent);
            document.body.appendChild(outerWrapper);

            const result = GoToTop._locateWrapperElements(nativeBtn);
            expect(result.injectParent).toBe(injectParent);
            expect(result.injectParent).toBe(nativeBtn.parentElement);
        });
    });

    // ─────────────────────────────────────
    //  _locateWrapperDirect
    // ─────────────────────────────────────

    describe('_locateWrapperDirect', () => {
        it('returns { injectParent, outerWrapper } when .aaff8b8f exists', () => {
            const { outerWrapper, injectParent } = createWrapperWithoutNativeButton();
            const result = GoToTop._locateWrapperDirect();
            expect(result).not.toBeNull();
            expect(result.injectParent).toBe(injectParent);
            expect(result.outerWrapper).toBe(outerWrapper);
        });

        it('falls back to INJECT_PARENT_FALLBACK selector when .aaff8b8f is absent', () => {
            const outerWrapper = document.createElement('div');
            outerWrapper.className = '_871cbca';
            const firstChild = document.createElement('div');
            const injectParent = document.createElement('div');
            outerWrapper.appendChild(firstChild);
            outerWrapper.appendChild(injectParent);
            document.body.appendChild(outerWrapper);

            const result = GoToTop._locateWrapperDirect();
            expect(result).not.toBeNull();
            expect(result.injectParent).toBe(injectParent);
        });

        it('returns null when neither container selector matches', () => {
            document.body.innerHTML = '';
            expect(GoToTop._locateWrapperDirect()).toBeNull();
        });

        it('uses OUTER_WRAPPER_SELECTOR for outerWrapper when available', () => {
            const { outerWrapper } = createWrapperWithoutNativeButton();
            const result = GoToTop._locateWrapperDirect();
            expect(result.outerWrapper).toBe(outerWrapper);
        });
    });

    // ─────────────────────────────────────
    //  _injectIntoWrapperDirect
    // ─────────────────────────────────────

    describe('_injectIntoWrapperDirect', () => {
        beforeEach(() => {
            GoToTop._button = null;
            GoToTop._injectionMode = null;
        });

        it('injects button as firstChild of injectParent', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            const result = GoToTop._injectIntoWrapperDirect();
            expect(result).toBe(true);
            expect(GoToTop._button).not.toBeNull();
            expect(injectParent.firstChild).toBe(GoToTop._button);
        });

        it('sets _injectionMode to wrapper-solo', () => {
            createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
        });

        it('button has dsw-gotop--solo class', () => {
            createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(true);
            expect(GoToTop._button.classList.contains('dsw-gotop')).toBe(true);
        });

        it('button retains ds-button--* classes from template path', () => {
            createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const classes = Array.from(GoToTop._button.classList);
            const dsClasses = classes.filter(c => c.startsWith('ds-'));
            // Template path applies NATIVE_BTN_CLASSES: ds-button, ds-button--outlinedNeutral, etc.
            expect(dsClasses.length).toBeGreaterThan(0);
            expect(GoToTop._button.classList.contains('ds-button')).toBe(true);
            expect(GoToTop._button.classList.contains('ds-button--circle')).toBe(true);
            expect(GoToTop._button.classList.contains('ds-button--floating')).toBe(true);
        });

        it('button starts hidden (style.display = "none")', () => {
            createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            expect(GoToTop._button.style.display).toBe('none');
        });

        it('starts wrapper observer', () => {
            createWrapperWithoutNativeButton();
            const spy = vi.spyOn(GoToTop, '_startWrapperObserver');
            GoToTop._injectIntoWrapperDirect();
            expect(spy).toHaveBeenCalledOnce();
            spy.mockRestore();
        });

        it('dedup: returns true without re-creating when .dsw-gotop already present', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const result = GoToTop._injectIntoWrapperDirect();
            expect(result).toBe(true);
            expect(injectParent.querySelectorAll('.dsw-gotop').length).toBe(1);
        });

        it('returns false when no container found', () => {
            document.body.innerHTML = '';
            const result = GoToTop._injectIntoWrapperDirect();
            expect(result).toBe(false);
            expect(GoToTop._button).toBeNull();
        });
    });

    // ─────────────────────────────────────
    //  _applyStackedOffset
    // ─────────────────────────────────────

    describe('_applyStackedOffset', () => {
        it('fallback: sets margin-bottom to 62px when native geometry is unreadable (jsdom)', () => {
            // In jsdom: offsetHeight === 0 → uses fallback 34 (new ds-button--m size)
            //           computed marginBottom is '' → parseFloat → NaN → uses fallback 20
            // Result: 20 + 34 + STACK_GAP_PX(8) = 62px
            const btn = document.createElement('div');
            const nativeBtn = document.createElement('div');
            document.body.appendChild(nativeBtn);

            GoToTop._applyStackedOffset(btn, nativeBtn);
            expect(btn.style.marginBottom).toBe('62px');
        });

        it('uses actual offsetHeight and marginBottom when geometry is readable', () => {
            const btn = document.createElement('div');
            const nativeBtn = document.createElement('div');
            document.body.appendChild(nativeBtn);

            Object.defineProperty(nativeBtn, 'offsetHeight', { value: 34, configurable: true });
            vi.spyOn(window, 'getComputedStyle').mockReturnValue({ marginBottom: '20px', right: '' });

            GoToTop._applyStackedOffset(btn, nativeBtn);
            // 20 + 34 + 8 = 62px
            expect(btn.style.marginBottom).toBe('62px');
        });

        it('mirrors native button right value when parseable', () => {
            const btn = document.createElement('div');
            const nativeBtn = document.createElement('div');
            document.body.appendChild(nativeBtn);

            vi.spyOn(window, 'getComputedStyle').mockReturnValue({ marginBottom: '20px', right: '12px' });
            Object.defineProperty(nativeBtn, 'offsetHeight', { value: 34, configurable: true });

            GoToTop._applyStackedOffset(btn, nativeBtn);
            expect(btn.style.right).toBe('12px');
        });

        it('does not set right style when native right is not parseable', () => {
            const btn = document.createElement('div');
            const nativeBtn = document.createElement('div');
            document.body.appendChild(nativeBtn);

            vi.spyOn(window, 'getComputedStyle').mockReturnValue({ marginBottom: '20px', right: 'auto' });
            Object.defineProperty(nativeBtn, 'offsetHeight', { value: 34, configurable: true });

            GoToTop._applyStackedOffset(btn, nativeBtn);
            expect(btn.style.right).toBe('');
        });
    });

    // ─────────────────────────────────────
    //  _injectIntoWrapper
    // ─────────────────────────────────────

    describe('_injectIntoWrapper', () => {
        beforeEach(() => {
            GoToTop._button = null;
            GoToTop._injectionMode = null;
        });

        it('injects button into parent before nativeBtn', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            const result = GoToTop._injectIntoWrapper(nativeBtn);
            expect(result).toBe(true);
            expect(GoToTop._button).not.toBeNull();
            expect(GoToTop._button.className).toContain('dsw-gotop');
            expect(GoToTop._injectionMode).toBe('injected');
            // Button should be inserted BEFORE nativeBtn in the parent
            expect(injectParent.children[1]).toBe(GoToTop._button);
            expect(injectParent.children[2]).toBe(nativeBtn);
        });

        it('starts hidden (style.display = "none")', () => {
            const { nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            expect(GoToTop._button.style.display).toBe('none');
        });

        it('adds dsw-gotop--stacked modifier class to the injected button', () => {
            const { nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(true);
        });

        it('sets inline margin-bottom via _applyStackedOffset (jsdom fallback: 62px)', () => {
            const { nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            // jsdom: offsetHeight=0 → fallback 34, marginBottom='' → fallback 20; 20+34+8=62
            expect(GoToTop._button.style.marginBottom).toBe('62px');
        });

        it('dedup: returns true if .dsw-gotop already present without re-creating', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            const btn1 = GoToTop._button;

            const result = GoToTop._injectIntoWrapper(nativeBtn);
            expect(result).toBe(true);
            expect(GoToTop._button).toBe(btn1); // Same reference, not replaced
            expect(injectParent.querySelectorAll('.dsw-gotop').length).toBe(1);
        });

        it('starts wrapper observer on outerWrapper', () => {
            const spy = vi.spyOn(GoToTop, '_startWrapperObserver');
            const { nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            expect(spy).toHaveBeenCalledOnce();

            spy.mockRestore();
        });

        it('returns false and does not create button when wrapper elements not found', () => {
            const orphanBtn = document.createElement('div');

            const result = GoToTop._injectIntoWrapper(orphanBtn);
            expect(result).toBe(false);
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._injectionMode).toBeNull();
        });

        it('smart dedup: upgrades solo remnant button to injected mode', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            // First inject in solo mode
            GoToTop._injectIntoWrapperDirect();
            expect(GoToTop._injectionMode).toBe('wrapper-solo');

            // Now native button appears
            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            // Reset state to simulate fresh injection call
            GoToTop._button = null;
            GoToTop._injectionMode = null;

            GoToTop._injectIntoWrapper(nativeBtn);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(false);
            expect(GoToTop._button.classList.contains('ds-button')).toBe(true);
        });
    });

    // ─────────────────────────────────────
    //  _transitionToStacked
    // ─────────────────────────────────────

    describe('_transitionToStacked', () => {
        it('reuses the SAME button element reference (no remove+recreate)', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const originalBtn = GoToTop._button;

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            expect(GoToTop._button).toBe(originalBtn);
        });

        it('swaps class: removes dsw-gotop--solo, adds dsw-gotop--stacked, keeps dsw-gotop', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(true);

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(false);
            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(true);
            expect(GoToTop._button.classList.contains('dsw-gotop')).toBe(true);
        });

        it('does not alter ds-button--* classes (pure modifier swap)', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            // Record all ds-button classes before transition
            const dsBefore = Array.from(GoToTop._button.classList).filter(c => c.startsWith('ds-button'));

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);
            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            const dsAfter = Array.from(GoToTop._button.classList).filter(c => c.startsWith('ds-button'));
            expect(dsAfter).toEqual(dsBefore);
        });

        it('moves button before nativeBtn in DOM (insertBefore)', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            const children = Array.from(injectParent.children);
            const goTopIdx = children.indexOf(GoToTop._button);
            const nativeIdx = children.indexOf(nativeBtn);
            expect(goTopIdx).toBeLessThan(nativeIdx);
        });

        it('applies stacked offset via _applyStackedOffset', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            const offsetSpy = vi.spyOn(GoToTop, '_applyStackedOffset');
            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            expect(offsetSpy).toHaveBeenCalledWith(GoToTop._button, nativeBtn);
        });

        it('sets _injectionMode to "injected"', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            expect(GoToTop._injectionMode).toBe('injected');
        });

        it('preserves display:none through the transition (hidden stays hidden)', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            GoToTop._button.style.display = 'none';

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            expect(GoToTop._button.style.display).toBe('none');
        });

        it('preserves visible display through the transition (visible stays visible)', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            GoToTop._button.style.display = '';

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            expect(GoToTop._button.style.display).toBe('');
        });
    });

    // ─────────────────────────────────────
    //  _transitionToSolo
    // ─────────────────────────────────────

    describe('_transitionToSolo', () => {
        it('reuses the SAME button element reference (no remove+recreate)', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            const originalBtn = GoToTop._button;

            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(GoToTop._button).toBe(originalBtn);
        });

        it('swaps class: removes dsw-gotop--stacked, adds dsw-gotop--solo, keeps dsw-gotop', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(true);

            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(false);
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(true);
            expect(GoToTop._button.classList.contains('dsw-gotop')).toBe(true);
        });

        it('does not alter ds-button--* classes (pure modifier swap)', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            const dsBefore = Array.from(GoToTop._button.classList).filter(c => c.startsWith('ds-button'));

            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            const dsAfter = Array.from(GoToTop._button.classList).filter(c => c.startsWith('ds-button'));
            expect(dsAfter).toEqual(dsBefore);
        });

        it('moves button to firstChild of injectParent', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(injectParent.firstChild).toBe(GoToTop._button);
        });

        it('clears margin-bottom inline style set by stacked mode', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            expect(GoToTop._button.style.marginBottom).toBe('62px');

            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(GoToTop._button.style.marginBottom).toBe('');
        });

        it('clears right inline style set by stacked mode', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            vi.spyOn(window, 'getComputedStyle').mockReturnValue({ marginBottom: '20px', right: '12px' });
            GoToTop._injectIntoWrapper(nativeBtn);
            expect(GoToTop._button.style.right).toBe('12px');

            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(GoToTop._button.style.right).toBe('');
        });

        it('sets _injectionMode to "wrapper-solo"', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(GoToTop._injectionMode).toBe('wrapper-solo');
        });

        it('preserves display:none through the transition', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._button.style.display = 'none';

            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(GoToTop._button.style.display).toBe('none');
        });

        it('preserves visible display through the transition', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._button.style.display = '';

            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(GoToTop._button.style.display).toBe('');
        });
    });

    // ─────────────────────────────────────
    //  Mode transitions: solo ↔ stacked (integration via _injectIntoWrapper dedup path)
    // ─────────────────────────────────────

    describe('mode transitions', () => {
        it('solo→stacked upgrade via _injectIntoWrapper dedup path: REUSES same element, swaps class, applies offset', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const originalBtn = GoToTop._button;
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            expect(originalBtn.classList.contains('dsw-gotop--solo')).toBe(true);

            // Native button appears
            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._injectIntoWrapper(nativeBtn);

            // Must be the SAME element, not a new one
            expect(GoToTop._button).toBe(originalBtn);
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(false);
            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(true);
            expect(GoToTop._button.classList.contains('dsw-gotop')).toBe(true);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(GoToTop._button.style.marginBottom).toBe('62px');
        });

        it('solo→stacked via observer callback: REUSES same element (no DOM removal)', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const originalBtn = GoToTop._button;
            expect(GoToTop._injectionMode).toBe('wrapper-solo');

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);
            vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(nativeBtn);
            vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);

            // Simulate the observer callback: button is connected, mode is wrapper-solo, native appeared
            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);
            GoToTop._evaluateVisibility();

            expect(GoToTop._button).toBe(originalBtn);
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(true);
        });

        it('stacked→solo downgrade via observer callback: REUSES same element, clears margin-bottom', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            const originalBtn = GoToTop._button;
            expect(GoToTop._injectionMode).toBe('injected');
            expect(originalBtn.classList.contains('dsw-gotop--stacked')).toBe(true);

            vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(null);
            vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);

            // Simulate the observer callback
            GoToTop._transitionToSolo(GoToTop._button, injectParent);
            GoToTop._evaluateVisibility();

            expect(GoToTop._button).toBe(originalBtn);
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(true);
            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(false);
            expect(GoToTop._button.style.marginBottom).toBe('');
        });

        it('no-op guard: when already in stacked mode and native button still present, no DOM moves or class churn', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectIntoWrapper(nativeBtn);
            const originalBtn = GoToTop._button;
            const originalClass = GoToTop._button.className;

            vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(nativeBtn);
            vi.spyOn(GoToTop, '_transitionToStacked');
            vi.spyOn(GoToTop, '_transitionToSolo');
            vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);

            // The no-op path should NOT call transition helpers
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(GoToTop._transitionToStacked).not.toHaveBeenCalled();
            expect(GoToTop._transitionToSolo).not.toHaveBeenCalled();
            // Button element unchanged
            expect(GoToTop._button).toBe(originalBtn);
            expect(GoToTop._button.className).toBe(originalClass);
        });

        it('no-op guard: when already in wrapper-solo mode and native button absent, no DOM moves or class churn', () => {
            createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const originalBtn = GoToTop._button;
            const originalClass = GoToTop._button.className;

            vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(null);
            vi.spyOn(GoToTop, '_transitionToStacked');
            vi.spyOn(GoToTop, '_transitionToSolo');

            // button is connected, mode is wrapper-solo, native absent → no-op
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            expect(GoToTop._transitionToStacked).not.toHaveBeenCalled();
            expect(GoToTop._transitionToSolo).not.toHaveBeenCalled();
            expect(GoToTop._button).toBe(originalBtn);
            expect(GoToTop._button.className).toBe(originalClass);
        });

        it('visibility is preserved across solo→stacked: visible button stays visible', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            GoToTop._button.style.display = '';  // make it visible

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);

            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);

            expect(GoToTop._button.style.display).toBe('');
        });

        it('visibility is preserved across stacked→solo: hidden button stays hidden', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._button.style.display = 'none';

            GoToTop._transitionToSolo(GoToTop._button, injectParent);

            expect(GoToTop._button.style.display).toBe('none');
        });
    });

    // ─────────────────────────────────────
    //  _injectAsFallback (DELETED — no fixed fallback in v2.9+)
    // ─────────────────────────────────────
    // _injectAsFallback was removed in the source. No tests for it.

    // ─────────────────────────────────────
    //  _injectButton (orchestrator)
    // ─────────────────────────────────────

    describe('_injectButton', () => {
        beforeEach(() => {
            GoToTop._button = null;
            GoToTop._injectionMode = null;
        });

        it('uses injectIntoWrapper when native button exists with wrapper', () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();

            GoToTop._injectButton();
            expect(GoToTop._button).not.toBeNull();
            expect(GoToTop._injectionMode).toBe('injected');
            expect(injectParent.contains(GoToTop._button)).toBe(true);
            expect(GoToTop._button.classList.contains('dsw-gotop--stacked')).toBe(true);
        });

        it('returns false and leaves _button null when neither native button nor wrapper container exists', () => {
            document.body.innerHTML = ''; // ensure no wrapper containers
            const result = GoToTop._injectButton();
            expect(result).toBe(false);
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._injectionMode).toBeNull();
        });

        it('uses wrapper-solo when native button absent but .aaff8b8f wrapper exists', () => {
            createWrapperWithoutNativeButton();
            GoToTop._injectButton();
            expect(GoToTop._button).not.toBeNull();
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(true);
        });

        it('is no-op when button is already connected in DOM', () => {
            GoToTop._button = document.createElement('div');
            GoToTop._button.className = 'dsw-gotop';
            document.body.appendChild(GoToTop._button);
            GoToTop._injectionMode = 'injected';

            const createSpy = vi.spyOn(GoToTop, '_createButtonElement');
            GoToTop._injectButton();
            expect(createSpy).not.toHaveBeenCalled();
            createSpy.mockRestore();
        });

        it('cleans up orphan (disconnected) button and re-injects to wrapper-solo when wrapper exists', () => {
            GoToTop._button = document.createElement('div');
            GoToTop._button.className = 'dsw-gotop';
            GoToTop._injectionMode = 'injected';

            createWrapperWithoutNativeButton(); // wrapper exists, no native button
            GoToTop._injectButton();
            expect(GoToTop._button).not.toBeNull();
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
        });

        it('cleans up orphan button and returns false when no wrapper exists', () => {
            document.body.innerHTML = '';
            GoToTop._button = document.createElement('div');
            GoToTop._button.className = 'dsw-gotop';
            GoToTop._injectionMode = 'injected';

            const result = GoToTop._injectButton();
            expect(result).toBe(false);
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._injectionMode).toBeNull();
        });

        it('no code path ever adds dsw-gotop--fixed class (fixed fallback removed)', () => {
            // All injection paths must not produce dsw-gotop--fixed
            createWrapperWithoutNativeButton();
            GoToTop._injectButton();
            if (GoToTop._button) {
                expect(GoToTop._button.classList.contains('dsw-gotop--fixed')).toBe(false);
            }
        });
    });

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
            vi.useFakeTimers();
            try {
                const { outerWrapper } = createWrapperWithoutNativeButton();
                GoToTop._injectIntoWrapperDirect();
                const oldBtn = GoToTop._button;

                // Simulate button being removed by React re-render
                oldBtn.remove();
                vi.spyOn(GoToTop, '_getNativeButton').mockReturnValue(null);

                outerWrapper.appendChild(document.createElement('span'));
                vi.advanceTimersByTime(GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 10);

                expect(GoToTop._button).not.toBeNull();
                expect(GoToTop._injectionMode).toBe('wrapper-solo');
            } finally {
                vi.useRealTimers();
            }
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
                expect(GoToTop._locked).toBe(true);

                // Second call while locked: must abort first scroll
                const secondResult = GoToTop.scrollToTopAndWait();
                // Second call returns undefined (not a promise)
                expect(secondResult).toBeUndefined();
                // _locked resets to false after abort
                expect(GoToTop._locked).toBe(false);
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

        it('calls scrollBy on the correct nested scroll container, not document', async () => {
            const container = createScrollContainer();
            const scrollBySpy = vi.spyOn(container, 'scrollBy');
            GoToTop._scrollContainer = container;
            vi.spyOn(GoToTop, '_getAnchor')
                .mockReturnValue(makeAnchorAtTop({ top: 0, bottom: 50, height: 50 }));

            await GoToTop.scrollToTopAndWait();
            expect(scrollBySpy).toHaveBeenCalled();
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
                expect(GoToTop._locked).toBe(false);
                expect(GoToTop._missCount).toBe(0);
                expect(GoToTop._degraded).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });

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
            expect(GoToTop._missCount).toBe(0);
            expect(GoToTop._degraded).toBe(false);
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

    // ─────────────────────────────────────
    //  _onRouteChange
    // ─────────────────────────────────────

    describe('_onRouteChange', () => {
        it('resets missCount, degraded, hasSeenDom, and cleans up button', () => {
            GoToTop._missCount = 5;
            GoToTop._degraded = true;
            GoToTop._hasSeenDom = true;
            GoToTop._scrollContainer = document.createElement('div');
            const btn = document.createElement('div');
            GoToTop._button = btn;
            GoToTop._injectionMode = 'injected';
            document.body.appendChild(btn);

            GoToTop._onRouteChange();

            expect(GoToTop._missCount).toBe(0);
            expect(GoToTop._degraded).toBe(false);
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
