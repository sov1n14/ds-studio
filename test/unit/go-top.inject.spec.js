/**
 * GoToTop — button injection unit tests.
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
});
