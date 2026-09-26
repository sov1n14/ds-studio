/**
 * content/invalidation-toast.js — extension-invalidation toast.
 *
 * Contract (from requirements, NOT from reading the implementation):
 *   globalThis.DSSInvalidationToast = { show() }
 *   - show() appends a .ds-invalidation-toast element to document.body.
 *   - The toast is position:fixed with backgroundColor #4d6bfe.
 *   - The toast contains a text <span> and a refresh <a>.
 *   - The refresh <a>, when clicked, calls location.reload().
 *   - Calling show() a second time does NOT create a duplicate toast (idempotent).
 *   - Uses dsI18n.t() for text content.
 *
 * DOM-adapter layer — implementation exists, tests written after.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let DSSInvalidationToast;
let reloadSpy;

beforeEach(async () => {
    // Fresh module load each test to reset the module-scope isShown flag.
    vi.resetModules();
    document.body.innerHTML = '';

    // Mock location.reload — jsdom location is not fully writable, so use spy.
    reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    // dsI18n is already globally available from vitest.setup.js.
    // Spy on dsI18n.t to return predictable strings.
    vi.spyOn(globalThis.dsI18n, 't').mockImplementation((key) => `[${key}]`);

    // Dynamic import so the IIFE re-executes with a fresh isShown flag.
    await import('../../content/invalidation-toast.js');
    DSSInvalidationToast = globalThis.DSSInvalidationToast;
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('content/invalidation-toast — show()', () => {
    it('creates a .ds-invalidation-toast element in document.body', () => {
        DSSInvalidationToast.show();
        const toast = document.querySelector('.ds-invalidation-toast');
        expect(toast).not.toBeNull();
        expect(toast.parentNode).toBe(document.body);
    });

    it('toast has position:fixed and backgroundColor #4d6bfe', () => {
        DSSInvalidationToast.show();
        const toast = document.querySelector('.ds-invalidation-toast');
        expect(toast.style.position).toBe('fixed');
        // jsdom may store hex as-is or convert to rgb; accept either.
        const bg = toast.style.backgroundColor;
        const isCorrectColor = bg === '#4d6bfe' || bg === 'rgb(77, 107, 254)';
        expect(isCorrectColor).toBe(true);
    });

    it('toast contains a <span> and an <a>', () => {
        DSSInvalidationToast.show();
        const toast = document.querySelector('.ds-invalidation-toast');
        expect(toast.querySelector('span')).not.toBeNull();
        expect(toast.querySelector('a')).not.toBeNull();
    });

    it('uses dsI18n.t() for message and refresh text', () => {
        DSSInvalidationToast.show();
        const toast = document.querySelector('.ds-invalidation-toast');
        const span = toast.querySelector('span');
        const anchor = toast.querySelector('a');
        expect(span.textContent).toBe('[invalidationToast.message]');
        expect(anchor.textContent).toBe('[invalidationToast.refresh]');
    });

    it('second call does NOT create a duplicate toast (idempotency)', () => {
        DSSInvalidationToast.show();
        DSSInvalidationToast.show();
        const toasts = document.querySelectorAll('.ds-invalidation-toast');
        expect(toasts.length).toBe(1);
    });

    it('clicking the refresh anchor calls location.reload()', () => {
        DSSInvalidationToast.show();
        const anchor = document.querySelector('.ds-invalidation-toast a');
        anchor.click();
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
});
