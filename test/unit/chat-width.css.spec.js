// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import ChatWidth from '../../content/chat-width.js';

/** Live message-list root captured from DeepSeek (conv2-finished), message text replaced by placeholders. */
const MESSAGE_LIST_FIXTURE = path.resolve(__dirname, '../fixtures/ds-snapshots/conv2-finished-message-list.html');

/** Mounts the live message list; handles are located by real nesting, never by the selectors under test. */
function mountLiveMessageList() {
    document.body.innerHTML = fs.readFileSync(MESSAGE_LIST_FIXTURE, 'utf8');
    const listRoot = document.body.firstElementChild;
    const virtualList = listRoot.querySelector('.ds-virtual-list-visible-items').parentElement;
    const textarea = listRoot.querySelector('textarea[name="search"]');
    const bar = textarea.parentElement.parentElement.parentElement.parentElement;
    return { listRoot, virtualList, bar, column: bar.parentElement };
}

function injectCss(css) {
    const style = document.createElement('style');
    style.setAttribute('data-test-css', '');
    style.textContent = css;
    document.head.appendChild(style);
}

describe('ChatWidth CSS generation (7.x scenarios)', () => {
    // Re-initialize state between tests
    beforeEach(() => {
        ChatWidth.enabled = false;
        ChatWidth.percent = 70;
    });

    afterEach(() => {
        document.querySelectorAll('style[data-test-css]').forEach((el) => el.remove());
        document.body.innerHTML = '';
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

        it('on the live message list: sets the width variable on the virtual list and centres the content column only', () => {
            const { listRoot, virtualList, column, bar } = mountLiveMessageList();
            injectCss(ChatWidth.getCSS(50));

            expect(getComputedStyle(virtualList).getPropertyValue('--message-list-max-width').trim()).toBe('50vw');
            // The variable is scoped to the virtual list, not declared on the list root around it.
            expect(getComputedStyle(listRoot).getPropertyValue('--message-list-max-width')).toBe('');

            const columnStyle = getComputedStyle(column);
            expect(columnStyle.marginLeft).toBe('auto');
            expect(columnStyle.marginRight).toBe('auto');
            expect(columnStyle.paddingLeft).toBe('0px');
            expect(columnStyle.paddingRight).toBe('0px');
            // Centring targets the column itself, not the floating button bar inside it.
            expect(getComputedStyle(bar).marginLeft).not.toBe('auto');
        });

        it('enforces !important on each property', () => {
            const css = ChatWidth.getCSS(50);
            const importantCount = (css.match(/!important/g) || []).length;
            expect(importantCount).toBeGreaterThanOrEqual(4);
        });
    });
});
