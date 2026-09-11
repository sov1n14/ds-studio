/**
 * GoToTop render-combined mutant killer tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import {
    createNativeButton,
    createWrapperWithoutNativeButton,
    createFullWrapperWithNativeButton,
    resetGoToTopState,
} from '../helpers/go-top-fixtures.js';

describe('GoToTop render-combined mutant killers', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { vi.useRealTimers(); });

    describe('_iconSvg', () => {
        it('contains all SVG path segments', () => {
            const svg = GoToTop._iconSvg();
            expect(svg).toContain('M11.8486 5.5');
            expect(svg).toContain('C8.44157 8.90706');
            expect(svg).toContain('C7.79912 9.46883');
            expect(svg).toContain('C7.08435 9.69222');
            expect(svg).toContain('C6.44405 9.61756');
            expect(svg).toContain('C5.78438 9.13382');
            expect(svg).toContain('L2.57617 5.92383');
            expect(svg).toContain('L6.15137 7.80273');
            expect(svg).toContain('C6.42595 8.07732');
            expect(svg).toContain('C6.87291 8.46904');
            expect(svg).toContain('C6.97895 8.48703');
            expect(svg).toContain('C7.07728 8.47813');
            expect(svg).toContain('C7.40124 8.24849');
            expect(svg).toContain('L11.8486 5.5Z');
        });
        it('has closing svg tag', () => {
            expect(GoToTop._iconSvg()).toContain('</svg>');
        });
        it('join uses empty string separator', () => {
            const svg = GoToTop._iconSvg();
            expect(svg).not.toContain(',C');
            expect(svg).not.toContain(',L');
            expect(svg).not.toContain(',<');
        });
    });

    describe('_createButtonElement clone path', () => {
        it('deep clone preserves bg and border children', () => {
            const nativeBtn = createNativeButton();
            const btn = GoToTop._createButtonElement(nativeBtn);
            expect(btn.querySelector('.ds-button__background')).not.toBeNull();
            expect(btn.querySelector('.ds-button__border')).not.toBeNull();
        });
        it('produces a distinct DOM node', () => {
            const nativeBtn = createNativeButton();
            expect(GoToTop._createButtonElement(nativeBtn)).not.toBe(nativeBtn);
        });
    });

    describe('_createButtonElement template icon class', () => {
        it('icon has ds-button__icon--last-child class', () => {
            const btn = GoToTop._createButtonElement(null);
            const icon = btn.querySelector('.ds-button__icon');
            expect(icon).not.toBeNull();
            expect(icon.classList.contains('ds-button__icon--last-child')).toBe(true);
        });
    });

    describe('_createButtonElement defensive icon', () => {
        it('creates icon when native button has none', () => {
            const nativeBtn = document.createElement('div');
            nativeBtn.className = 'ds-button ds-button--floating _0706cde';
            const btn = GoToTop._createButtonElement(nativeBtn);
            const icon = btn.querySelector('.ds-button__icon');
            expect(icon).not.toBeNull();
            expect(icon.innerHTML).toContain('<svg');
        });
    });

    describe('_createButtonElement keydown preventDefault', () => {
        it('Space key calls preventDefault', () => {
            vi.spyOn(GoToTop, 'scrollToTopAndWait').mockResolvedValue({ success: true });
            const btn = GoToTop._createButtonElement(null);
            const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
            const spy = vi.spyOn(event, 'preventDefault');
            btn.dispatchEvent(event);
            expect(spy).toHaveBeenCalled();
        });
        it('Enter key calls preventDefault', () => {
            vi.spyOn(GoToTop, 'scrollToTopAndWait').mockResolvedValue({ success: true });
            const btn = GoToTop._createButtonElement(null);
            const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
            const spy = vi.spyOn(event, 'preventDefault');
            btn.dispatchEvent(event);
            expect(spy).toHaveBeenCalled();
        });
    });

    describe('_applyStackedOffset right NaN guard', () => {
        it('does NOT set right to NaNpx when unparseable', () => {
            const btn = document.createElement('div');
            const nativeBtn = document.createElement('div');
            document.body.appendChild(nativeBtn);
            vi.spyOn(window, 'getComputedStyle').mockReturnValue({ marginBottom: '20px', right: 'auto' });
            Object.defineProperty(nativeBtn, 'offsetHeight', { value: 34, configurable: true });
            GoToTop._applyStackedOffset(btn, nativeBtn);
            expect(btn.style.right).not.toBe('NaNpx');
        });
    });

    describe('_injectIntoWrapper dedup non-solo', () => {
        it('does NOT call _transitionToStacked when already stacked', () => {
            const { nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            const spy = vi.spyOn(GoToTop, '_transitionToStacked');
            expect(GoToTop._injectIntoWrapper(nativeBtn)).toBe(true);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('_injectButton return values', () => {
        it('returns true when button is already connected', () => {
            GoToTop._button = document.createElement('div');
            GoToTop._button.className = 'dsw-gotop';
            document.body.appendChild(GoToTop._button);
            GoToTop._injectionMode = 'injected';
            expect(GoToTop._injectButton()).toBe(true);
        });
        it('skips _getNativeButton when already connected', () => {
            GoToTop._button = document.createElement('div');
            GoToTop._button.className = 'dsw-gotop';
            document.body.appendChild(GoToTop._button);
            GoToTop._injectionMode = 'injected';
            const spy = vi.spyOn(GoToTop, '_getNativeButton');
            GoToTop._injectButton();
            expect(spy).not.toHaveBeenCalled();
        });
        it('orphan cleanup nullifies state', () => {
            GoToTop._button = document.createElement('div');
            GoToTop._injectionMode = 'injected';
            document.body.innerHTML = '';
            GoToTop._injectButton();
            expect(GoToTop._button).toBeNull();
            expect(GoToTop._injectionMode).toBeNull();
        });
        it('prefers stacked over solo', () => {
            createFullWrapperWithNativeButton();
            const spy = vi.spyOn(GoToTop, '_injectIntoWrapperDirect');
            GoToTop._injectButton();
            expect(GoToTop._injectionMode).toBe('injected');
            expect(spy).not.toHaveBeenCalled();
        });
        it('returns true from stacked path', () => {
            createFullWrapperWithNativeButton();
            expect(GoToTop._injectButton()).toBe(true);
        });
        it('returns true from solo path', () => {
            createWrapperWithoutNativeButton();
            expect(GoToTop._injectButton()).toBe(true);
        });
    });

    describe('_transitionToStacked offset', () => {
        it('sets margin-bottom via _applyStackedOffset', () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            GoToTop._button.style.marginBottom = '';
            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);
            GoToTop._transitionToStacked(GoToTop._button, nativeBtn);
            expect(GoToTop._button.style.marginBottom).not.toBe('');
        });
    });

    describe('_startWrapperObserver callback', () => {
        it('restores visibility for previously visible button', async () => {
            vi.useFakeTimers();
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._button.style.display = '';
            const originalBtn = GoToTop._button;
            vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);
            originalBtn.remove();
            injectParent.appendChild(document.createElement('span'));
            await vi.advanceTimersByTimeAsync(GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 10);
            expect(GoToTop._button).not.toBeNull();
            expect(GoToTop._button.style.display).toBe('');
        });
        it('stacked to solo when native disappears', async () => {
            vi.useFakeTimers();
            const { nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            const originalBtn = GoToTop._button;
            vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);
            nativeBtn.remove();
            await vi.advanceTimersByTimeAsync(GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 10);
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            expect(GoToTop._button).toBe(originalBtn);
            expect(GoToTop._button.classList.contains('dsw-gotop--solo')).toBe(true);
        });
        it('evaluateVisibility after re-injection', async () => {
            vi.useFakeTimers();
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._button.remove();
            const evalSpy = vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);
            injectParent.appendChild(document.createElement('span'));
            await vi.advanceTimersByTimeAsync(GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 10);
            expect(evalSpy).toHaveBeenCalled();
        });
        it('evaluateVisibility after stacked to solo', async () => {
            vi.useFakeTimers();
            const { nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            const evalSpy = vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);
            nativeBtn.remove();
            await vi.advanceTimersByTimeAsync(GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 10);
            expect(evalSpy).toHaveBeenCalled();
        });
        it('debounces rapid mutations', async () => {
            vi.useFakeTimers();
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._button.remove();
            const evalSpy = vi.spyOn(GoToTop, '_evaluateVisibility').mockReturnValue(undefined);
            injectParent.appendChild(document.createElement('span'));
            await vi.advanceTimersByTimeAsync(20);
            injectParent.appendChild(document.createElement('span'));
            await vi.advanceTimersByTimeAsync(20);
            injectParent.appendChild(document.createElement('span'));
            await vi.advanceTimersByTimeAsync(GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 10);
            expect(evalSpy).toHaveBeenCalledTimes(1);
        });
        it('observes with subtree: true', () => {
            const { nativeBtn } = createFullWrapperWithNativeButton();
            const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
            GoToTop._wrapperObserver = null;
            GoToTop._injectIntoWrapper(nativeBtn);
            expect(observeSpy).toHaveBeenCalledWith(
                expect.any(Element),
                expect.objectContaining({ childList: true, subtree: true })
            );
        });
    });

    describe('_stopWrapperObserver', () => {
        it('nullifies _wrapperObserverTimer', () => {
            GoToTop._wrapperObserverTimer = setTimeout(() => {}, 10000);
            GoToTop._stopWrapperObserver();
            expect(GoToTop._wrapperObserverTimer).toBeNull();
        });
        it('calls clearTimeout even without observer', () => {
            GoToTop._wrapperObserver = null;
            GoToTop._wrapperObserverTimer = 12345;
            const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
            GoToTop._stopWrapperObserver();
            expect(clearSpy).toHaveBeenCalled();
        });
    });
});
