/**
 * GoToTop — button element construction unit tests.
 * Shared fixtures: test/helpers/go-top-fixtures.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import {
    createNativeButton,
    resetGoToTopState,
} from '../helpers/go-top-fixtures.js';

describe('GoToTop', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { vi.useRealTimers(); });

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
            expect(GoToTop._hasSeenDom).toBe(false);
            expect(GoToTop._scrollPromise).toBeNull();
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
});
