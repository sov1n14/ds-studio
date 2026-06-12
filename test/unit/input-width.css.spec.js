import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import InputWidth from '../../content/input-width.js';

describe('InputWidth logic (8.2.x, 9.x scenarios)', () => {
    beforeEach(() => {
        InputWidth.enabled = false;
        InputWidth.percent = 70;
        InputWidth._chatWidthPercent = 70;
        InputWidth._chatWidthEnabled = false;
    });

    describe('getEffectivePercent()', () => {
        it('returns own percent when chat-width is not enabled', () => {
            InputWidth._chatWidthEnabled = false;
            InputWidth._chatWidthPercent = 50;
            InputWidth.percent = 70;
            expect(InputWidth.getEffectivePercent()).toBe(70);
        });

        it('returns own percent when chat-width percent is larger', () => {
            InputWidth._chatWidthEnabled = true;
            InputWidth._chatWidthPercent = 80;
            InputWidth.percent = 70;
            expect(InputWidth.getEffectivePercent()).toBe(70);
        });

        it('returns chat-width percent when it is smaller than own percent', () => {
            InputWidth._chatWidthEnabled = true;
            InputWidth._chatWidthPercent = 40;
            InputWidth.percent = 70;
            expect(InputWidth.getEffectivePercent()).toBe(40);
        });

        it('returns own percent when both are equal', () => {
            InputWidth._chatWidthEnabled = true;
            InputWidth._chatWidthPercent = 70;
            InputWidth.percent = 70;
            expect(InputWidth.getEffectivePercent()).toBe(70);
        });

        it('handles chat-width very small (MIN boundary)', () => {
            InputWidth._chatWidthEnabled = true;
            InputWidth._chatWidthPercent = 30;
            InputWidth.percent = 100;
            expect(InputWidth.getEffectivePercent()).toBe(30);
        });
    });

    describe('getCSS()', () => {
        it('clamps percent to MIN/MAX range', () => {
            const css = InputWidth.getCSS(0);
            expect(css).toContain('max-width: 30vw');
        });

        it('clamps to MAX when exceeded', () => {
            const css = InputWidth.getCSS(150);
            expect(css).toContain('max-width: 100vw');
        });

        it('includes all input selectors', () => {
            const css = InputWidth.getCSS(60);
            expect(css).toContain('._871cbca');
            expect(css).toContain('.aaff8b8f');
            expect(css).toContain('._77cefa5._3d616d3');
        });

        it('enforces !important on each property', () => {
            const css = InputWidth.getCSS(60);
            const importantCount = (css.match(/!important/g) || []).length;
            expect(importantCount).toBeGreaterThanOrEqual(6);
        });
    });

    describe('applyWidth()', () => {
        it('injects styles when enabled', () => {
            InputWidth.enabled = true;
            InputWidth.applyWidth(60);
            const style = document.getElementById(InputWidth.STYLE_ID);
            expect(style).not.toBeNull();
            expect(style.textContent).toContain('60vw');
        });

        it('removes style element when disabled', () => {
            InputWidth.enabled = false;
            InputWidth.applyWidth(60);
            const style = document.getElementById(InputWidth.STYLE_ID);
            expect(style).toBeNull();
        });
    });
});
