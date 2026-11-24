// @vitest-environment jsdom
/**
 * GoTop clone class: every module that renders, locates or excludes the extension's own button agrees on one class, and the stylesheet styles that class.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import GoToTop from '../../content/go-top.js';
import { createNativeButton, resetGoToTopState } from '../helpers/go-top-fixtures.js';

const S = require('../../content/ds-selectors.js');
const GO_TOP_CSS = path.resolve(__dirname, '../../content/go-top.css');

describe('GoTop clone class', () => {
    beforeEach(resetGoToTopState);
    afterEach(() => { resetGoToTopState(); vi.useRealTimers(); });

    it('is a plain class name exported by ds-selectors', () => {
        expect(S.GO_TOP_CLONE_CLASS).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it('the rendered clone button carries the shared class and not the native button class', () => {
        const btn = GoToTop._createButtonElement(createNativeButton());
        expect(btn.classList.contains(S.GO_TOP_CLONE_CLASS)).toBe(true);
        expect(btn.classList.contains(S.GO_TOP_NATIVE_BUTTON_CLASS)).toBe(false);
    });

    it('the native button selector excludes an element carrying the shared class', () => {
        const nativeBtn = createNativeButton();
        const clone = nativeBtn.cloneNode(true);
        clone.classList.add(S.GO_TOP_CLONE_CLASS);
        document.body.append(nativeBtn, clone);
        const matches = document.querySelectorAll(GoToTop.NATIVE_BTN_SELECTOR);
        expect(Array.from(matches)).toEqual([nativeBtn]);
    });

    it('the floating-button fallback skips a floating circle button inside the clone', () => {
        const clone = document.createElement('div');
        clone.classList.add(S.GO_TOP_CLONE_CLASS);
        const inner = document.createElement('div');
        inner.setAttribute('role', 'button');
        inner.classList.add(S.DS_BUTTON_FLOATING_CLASS, S.DS_BUTTON_CIRCLE_CLASS);
        clone.appendChild(inner);
        document.body.appendChild(clone);
        expect(GoToTop._queryFloatingButtonOutsideGoTop()).toBeNull();
    });

    it('go-top.css styles the shared class', () => {
        const css = fs.readFileSync(GO_TOP_CSS, 'utf8');
        expect(css).toContain('.' + S.GO_TOP_CLONE_CLASS + ' {');
    });
});
