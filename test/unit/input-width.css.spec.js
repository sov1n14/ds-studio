// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import InputWidth from '../../content/input-width.js';

/** Live message-list root captured from DeepSeek (conv2-finished), message text replaced by placeholders. */
const MESSAGE_LIST_FIXTURE = path.resolve(__dirname, '../fixtures/ds-snapshots/conv2-finished-message-list.html');

/** Mounts the live message list; handles are located by real nesting, never by the selectors under test. */
function mountLiveMessageList() {
    document.body.innerHTML = fs.readFileSync(MESSAGE_LIST_FIXTURE, 'utf8');
    const listRoot = document.body.firstElementChild;
    const virtualList = listRoot.querySelector('.ds-virtual-list-visible-items').parentElement;
    const textarea = listRoot.querySelector('textarea[name="search"]');
    const composer = textarea.parentElement.parentElement.parentElement;
    const bar = composer.parentElement;
    return { listRoot, virtualList, composer, bar, column: bar.parentElement };
}

function injectCss(css) {
    const style = document.createElement('style');
    style.setAttribute('data-test-css', '');
    style.textContent = css;
    document.head.appendChild(style);
}

/** Computed max-width of a detached probe styled with the given value (resolves vw against this window). */
function maxWidthOf(value) {
    const probe = document.createElement('div');
    probe.style.maxWidth = value;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).maxWidth;
    probe.remove();
    return resolved;
}

describe('InputWidth logic (8.2.x, 9.x scenarios)', () => {
    beforeEach(() => {
        InputWidth.enabled = false;
        InputWidth.percent = 70;
        InputWidth._chatWidthPercent = 70;
        InputWidth._chatWidthEnabled = false;
    });

    afterEach(() => {
        document.querySelectorAll('style[data-test-css]').forEach((el) => el.remove());
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

        it('on the live page: caps and centres the content column, the floating button bar and the composer card', () => {
            const { column, bar, composer } = mountLiveMessageList();
            injectCss(InputWidth.getCSS(60));
            const expectedMaxWidth = maxWidthOf('60vw');

            for (const [name, el] of Object.entries({ column, bar, composer })) {
                const style = getComputedStyle(el);
                expect(style.maxWidth, `${name} max-width`).toBe(expectedMaxWidth);
                expect(style.marginLeft, `${name} margin-left`).toBe('auto');
                expect(style.marginRight, `${name} margin-right`).toBe('auto');
                expect(style.paddingLeft, `${name} padding-left`).toBe('0px');
                expect(style.paddingRight, `${name} padding-right`).toBe('0px');
            }
        });

        it('on the live page: leaves the message list, its message items and the scroll gutters unstyled', () => {
            const { listRoot, virtualList } = mountLiveMessageList();
            injectCss(InputWidth.getCSS(60));
            const untouched = {
                gutters: listRoot.firstElementChild,
                virtualList,
                firstItem: virtualList.querySelector('[data-virtual-list-item-key]'),
            };

            for (const [name, el] of Object.entries(untouched)) {
                const style = getComputedStyle(el);
                expect(style.maxWidth, `${name} max-width`).not.toBe(maxWidthOf('60vw'));
                expect(style.marginLeft, `${name} margin-left`).not.toBe('auto');
            }
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
