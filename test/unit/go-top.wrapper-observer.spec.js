/**
 * GoToTop — wrapper MutationObserver behavior (re-injection, visibility preservation, solo/stacked transitions, debounce).
 * Requirements: docs/en/architecture/content-ui.md GoTop section ("A MutationObserver ... watches the outer wrapper"), docs/spec/03-ui-adjustments.md section 18.
 * Shared fixtures: test/helpers/go-top-fixtures.js
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

// happy-dom delivers MutationObserver records through its own captured real setTimeout, while the debounce timer inside the callback uses the (faked) global. Yield one real macrotask so the record is delivered and the debounce timer is armed, then advance the fake clock past exactly one debounce window, so any follow-up mutation made by the callback itself is NOT processed before the assertions.
const realSetTimeout = globalThis.setTimeout;
const yieldToMacrotask = () => new Promise((resolve) => realSetTimeout(resolve, 0));
async function flushOneDebounce() {
    await yieldToMacrotask();
    await vi.advanceTimersByTimeAsync(GoToTop.WRAPPER_OBSERVER_DEBOUNCE + 10);
}

describe('GoToTop wrapper observer', () => {
    beforeEach(() => {
        resetGoToTopState();
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    describe('re-injection after React re-render removes the button', () => {
        it('with native button: a hidden button is re-injected hidden, stacked, directly before the native button', async () => {
            const { injectParent, nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            const oldBtn = GoToTop._button;
            expect(oldBtn.style.display).toBe('none');

            oldBtn.remove();
            await flushOneDebounce();

            const btn = GoToTop._button;
            expect(btn).not.toBeNull();
            expect(btn).not.toBe(oldBtn);
            expect(btn.isConnected).toBe(true);
            expect(btn.style.display).toBe('none');
            expect(GoToTop._injectionMode).toBe('injected');
            expect(btn.classList.contains('dsw-gotop--stacked')).toBe(true);
            expect(btn.classList.contains('dsw-gotop--solo')).toBe(false);
            expect(btn.parentElement).toBe(injectParent);
            expect(btn.nextElementSibling).toBe(nativeBtn);
        });

        it('with native button: a visible button is re-injected visible', async () => {
            const { nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            GoToTop._button.style.display = '';
            const oldBtn = GoToTop._button;

            oldBtn.remove();
            await flushOneDebounce();

            expect(GoToTop._button).not.toBe(oldBtn);
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._button.style.display).toBe('');
        });

        it('without native button: a hidden solo button is re-injected hidden as the wrapper first child', async () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const oldBtn = GoToTop._button;

            oldBtn.remove();
            await flushOneDebounce();

            const btn = GoToTop._button;
            expect(btn).not.toBe(oldBtn);
            expect(btn.isConnected).toBe(true);
            expect(btn.style.display).toBe('none');
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            expect(btn.classList.contains('dsw-gotop--solo')).toBe(true);
            expect(injectParent.firstElementChild).toBe(btn);
        });

        it('without native button: a visible solo button is re-injected visible', async () => {
            createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            GoToTop._button.style.display = '';
            const oldBtn = GoToTop._button;

            oldBtn.remove();
            await flushOneDebounce();

            expect(GoToTop._button).not.toBe(oldBtn);
            expect(GoToTop._button.isConnected).toBe(true);
            expect(GoToTop._button.style.display).toBe('');
        });
    });

    describe('mode transitions while the button stays connected', () => {
        it('wrapper-solo + native button appears: the SAME node is upgraded to stacked, moved directly before the native button, then visibility is re-evaluated', async () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const soloBtn = GoToTop._button;
            soloBtn.style.display = '';
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            const evalSpy = vi.spyOn(GoToTop, '_evaluateVisibility');

            const nativeBtn = createNativeButton();
            injectParent.appendChild(nativeBtn);
            await flushOneDebounce();

            expect(GoToTop._button).toBe(soloBtn);
            expect(soloBtn.isConnected).toBe(true);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(soloBtn.classList.contains('dsw-gotop--stacked')).toBe(true);
            expect(soloBtn.classList.contains('dsw-gotop--solo')).toBe(false);
            expect(soloBtn.nextElementSibling).toBe(nativeBtn);
            expect(soloBtn.style.marginBottom).not.toBe('');
            expect(soloBtn.style.display).toBe('');
            expect(evalSpy).toHaveBeenCalled();
        });

        it('injected + native button still present: an unrelated wrapper mutation leaves the button untouched and triggers no re-evaluation', async () => {
            const { outerWrapper, nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            const btn = GoToTop._button;
            // Sentinel: a transition would recompute this inline offset from the native geometry.
            btn.style.marginBottom = '999px';
            const evalSpy = vi.spyOn(GoToTop, '_evaluateVisibility');

            outerWrapper.appendChild(document.createElement('span'));
            await flushOneDebounce();

            expect(GoToTop._button).toBe(btn);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(btn.classList.contains('dsw-gotop--stacked')).toBe(true);
            expect(btn.style.marginBottom).toBe('999px');
            expect(evalSpy).not.toHaveBeenCalled();
        });

        it('wrapper-solo + still no native button: an unrelated wrapper mutation leaves the button where it is and triggers no re-evaluation', async () => {
            const { injectParent } = createWrapperWithoutNativeButton();
            GoToTop._injectIntoWrapperDirect();
            const btn = GoToTop._button;
            const evalSpy = vi.spyOn(GoToTop, '_evaluateVisibility');

            // React prepends a node ahead of the solo button; no mode change is due, so GoTop must not be moved back to the front.
            const prepended = document.createElement('span');
            injectParent.insertBefore(prepended, injectParent.firstChild);
            await flushOneDebounce();

            expect(GoToTop._button).toBe(btn);
            expect(GoToTop._injectionMode).toBe('wrapper-solo');
            expect(injectParent.firstElementChild).toBe(prepended);
            expect(evalSpy).not.toHaveBeenCalled();
        });

        it('injected + native button disappears with no solo wrapper on the page: the button stays stacked and visibility is still re-evaluated', async () => {
            // Native button rendered in a container outside the known floating-bar / content-column structure, so the solo locator finds no target.
            const host = document.createElement('div');
            const nativeBtn = createNativeButton();
            host.appendChild(nativeBtn);
            document.body.appendChild(host);
            GoToTop._injectIntoWrapper(nativeBtn);
            const btn = GoToTop._button;
            expect(GoToTop._injectionMode).toBe('injected');
            expect(GoToTop._locateWrapperDirect()).toBeNull();
            const evalSpy = vi.spyOn(GoToTop, '_evaluateVisibility');

            nativeBtn.remove();
            await flushOneDebounce();

            expect(GoToTop._button).toBe(btn);
            expect(btn.isConnected).toBe(true);
            expect(btn.parentElement).toBe(host);
            expect(GoToTop._injectionMode).toBe('injected');
            expect(btn.classList.contains('dsw-gotop--stacked')).toBe(true);
            expect(evalSpy).toHaveBeenCalled();
        });
    });

    describe('debounce', () => {
        it('rapid successive wrapper mutations leave exactly one pending re-evaluation timer', async () => {
            const { outerWrapper, nativeBtn } = createFullWrapperWithNativeButton();
            GoToTop._injectIntoWrapper(nativeBtn);
            await yieldToMacrotask();
            const baseline = vi.getTimerCount();

            for (let i = 0; i < 3; i++) {
                outerWrapper.appendChild(document.createElement('span'));
                await yieldToMacrotask();
            }

            expect(vi.getTimerCount()).toBe(baseline + 1);
        });
    });
});
