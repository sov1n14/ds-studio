import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import ChatWidth from '../../content/chat-width.js';

describe('ChatWidth CSS generation (7.x scenarios)', () => {
    // Re-initialize state between tests
    beforeEach(() => {
        ChatWidth.enabled = false;
        ChatWidth.percent = 70;
    });

    describe('getCSS()', () => {
        it('produces CSS with MIN vw when percent is below minimum', () => {
            const css = ChatWidth.getCSS(0);
            expect(css).toContain('--message-list-max-width: 30vw');
        });

        it('produces CSS with MAX vw when percent exceeds maximum', () => {
            const css = ChatWidth.getCSS(150);
            expect(css).toContain('--message-list-max-width: 100vw');
        });

        it('produces CSS with the exact percent when in range', () => {
            const css = ChatWidth.getCSS(70);
            expect(css).toContain('--message-list-max-width: 70vw');
        });

        it('clamps to MIN at boundary 29', () => {
            const css = ChatWidth.getCSS(29);
            expect(css).toContain('--message-list-max-width: 30vw');
        });

        it('clamps to MAX at boundary 101', () => {
            const css = ChatWidth.getCSS(101);
            expect(css).toContain('--message-list-max-width: 100vw');
        });

        it('accepts boundary MIN exactly (30)', () => {
            const css = ChatWidth.getCSS(30);
            expect(css).toContain('--message-list-max-width: 30vw');
        });

        it('accepts boundary MAX exactly (100)', () => {
            const css = ChatWidth.getCSS(100);
            expect(css).toContain('--message-list-max-width: 100vw');
        });

        it('includes all selectors in output', () => {
            const css = ChatWidth.getCSS(50);
            expect(css).toContain('.ds-virtual-list-items._6f2c522');
            expect(css).toContain('._871cbca');
        });

        it('enforces !important on each property', () => {
            const css = ChatWidth.getCSS(50);
            const importantCount = (css.match(/!important/g) || []).length;
            expect(importantCount).toBeGreaterThanOrEqual(4);
        });
    });

    describe('applyWidth()', () => {
        it('injects styles when enabled', () => {
            ChatWidth.enabled = true;
            ChatWidth.applyWidth(80);
            const style = document.getElementById(ChatWidth.STYLE_ID);
            expect(style).not.toBeNull();
            expect(style.textContent).toContain('80vw');
        });

        it('removes style element when disabled', () => {
            ChatWidth.enabled = false;
            ChatWidth.applyWidth(50);
            const style = document.getElementById(ChatWidth.STYLE_ID);
            expect(style).toBeNull();
        });
    });
});
