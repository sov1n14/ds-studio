/**
 * GoToTop — DOM location unit tests.
 * Shared fixtures: test/helpers/go-top-fixtures.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import {
    createWrapperWithoutNativeButton,
    createFullWrapperWithNativeButton,
    resetGoToTopState,
} from '../helpers/go-top-fixtures.js';

describe('GoToTop', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { vi.useRealTimers(); });

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

        it('sets _hasSeenDom on first success', () => {
            GoToTop._hasSeenDom = false;
            const div = document.createElement('div');
            div.className = 'hit';
            document.body.appendChild(div);

            GoToTop._querySelectorWithFallback(['.hit']);
            expect(GoToTop._hasSeenDom).toBe(true);
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
});
