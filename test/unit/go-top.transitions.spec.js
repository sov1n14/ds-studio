/**
 * GoToTop — solo/stacked mode transition unit tests.
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
});
