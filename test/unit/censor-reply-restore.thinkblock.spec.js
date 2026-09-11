import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';
import selectors from '../../content/ds-selectors.js';

describe('_buildThinkBlock DOM structure mutant killers', () => {
    beforeEach(resetCensorReplyRestore);

    function build(content, secs) {
        if (content === undefined) content = 'test thinking';
        if (secs === undefined) secs = 3.7;
        return CensorReplyRestore._buildThinkBlock({ content: content }, secs);
    }

    describe('container', () => {
        it('uses THINK_BLOCK_CLASS', () => {
            expect(build().className).toBe(selectors.THINK_BLOCK_CLASS);
        });
        it('style has CSS custom property segments', () => {
            const s = build().getAttribute('style');
            expect(s).toContain('--collapsible-area-title-height: 38px');
            expect(s).toContain('--group-title-sticky-base-top: 0px');
            expect(s).toContain('--group-title-sticky-top: calc(');
            expect(s).toContain('--ds-virtual-list-transform-y');
            expect(s).toContain('--ds-virtual-list-ios-compensation-y');
        });
        it('has 4 children', () => {
            expect(build().children).toHaveLength(4);
        });
    });

    describe('header', () => {
        it('class and cursor', () => {
            const h = build().children[0];
            expect(h.className).toBe(selectors.THINK_HEADER_CLASS);
            expect(h.style.cursor).toBe('pointer');
        });
        it('sparkle icon 16x16', () => {
            const html = build().children[0].innerHTML;
            expect(html).toContain('_970ac5e');
            expect(html).toContain('font-size: 16px');
        });
        it('arrow icon 14x14', () => {
            const html = build().children[0].innerHTML;
            expect(html).toContain('font-size: 14px');
        });
        it('_5ab5d64 wrapper', () => {
            expect(build().querySelector('._5ab5d64')).not.toBeNull();
        });
        it('_5255ff8 _4d41763 span', () => {
            const span = build().querySelector('._5255ff8');
            expect(span).not.toBeNull();
            expect(span.classList.contains('_4d41763')).toBe(true);
        });
        it('rounded seconds in header', () => {
            const span = build('thinking', 3.7).querySelector('._5255ff8');
            expect(span.textContent).toContain('4');
        });
        it('empty seconds when 0', () => {
            const span = build('thinking', 0).querySelector('._5255ff8');
            expect(span.textContent).not.toContain('0');
        });
        it('c99b79f8 divider', () => {
            const html = build().children[0].innerHTML;
            expect(html).toContain('c99b79f8');
            expect(html).toContain('opacity: 0');
        });
        it('right-arrow path', () => {
            expect(build().children[0].innerHTML).toContain('M5.5 2.15137');
        });
        it('sparkle path data', () => {
            expect(build().children[0].innerHTML).toContain('M8.00192 6.64454');
        });
    });

    describe('header click toggle', () => {
        it('data-ht-collapsed 1 then 0', () => {
            const c = build();
            document.body.appendChild(c);
            c.children[0].click();
            expect(c.getAttribute('data-ht-collapsed')).toBe('1');
            c.children[0].click();
            expect(c.getAttribute('data-ht-collapsed')).toBe('0');
        });
        it('hides then shows content', () => {
            const c = build();
            document.body.appendChild(c);
            const tc = c.querySelector(selectors.THINK_CONTENT_SELECTOR);
            c.children[0].click();
            expect(tc.style.display).toBe('none');
            c.children[0].click();
            expect(tc.style.display).toBe('block');
        });

    });

    describe('spacer', () => {
        it('uses THINK_SPACER_CLASS', () => {
            expect(build().children[1].className).toBe(selectors.THINK_SPACER_CLASS);
        });
    });

    describe('think content', () => {
        it('composite class from 3 constants', () => {
            const tc = build().querySelector('.' + selectors.THINK_CONTENT_CLASS);
            expect(tc.classList.contains(selectors.THINK_CONTENT_OUTER_CLASS)).toBe(true);
            expect(tc.classList.contains(selectors.THINK_CONTENT_MODIFIER_CLASS)).toBe(true);
        });
        it('loading dots', () => {
            const cls = selectors.THINK_LOADING_DOTS_CLASS.split(' ')[0];
            const d = build().querySelector('.' + cls);
            expect(d).not.toBeNull();
            expect(d.getAttribute('style')).toContain('width: 16px');
            expect(d.getAttribute('style')).toContain('height: 16px');
            expect(d.innerHTML).toContain('a510c7ce');
            expect(d.innerHTML).toContain('_0652043');
        });
        it('separator', () => {
            expect(build().querySelector('.' + selectors.THINK_SEPARATOR_CLASS)).not.toBeNull();
        });
        it('markdown zoom', () => {
            const md = build().querySelector('.' + selectors.MARKDOWN_CLASS);
            expect(md).not.toBeNull();
            expect(md.getAttribute('style')).toContain('--ds-md-zoom: 1.143');
        });
        it('renders content', () => {
            const md = build('Hello world').querySelector('.' + selectors.MARKDOWN_CLASS);
            expect(md.innerHTML).toContain('Hello world');
        });
    });

    describe('footer', () => {
        it('last child with THINK_FOOTER_CLASS', () => {
            expect(build().lastElementChild.className).toBe(selectors.THINK_FOOTER_CLASS);
        });
    });

    describe('container click edge cases', () => {
        it('no throw when thinkContent removed', () => {
            const c = build();
            document.body.appendChild(c);
            c.querySelector('.' + selectors.THINK_CONTENT_CLASS).remove();
            c.setAttribute('data-ht-collapsed', '1');
            const evt = new MouseEvent('click', { bubbles: false });
            Object.defineProperty(evt, 'target', { value: c });
            expect(() => c.dispatchEvent(evt)).not.toThrow();
        });
        it('display=block when collapsed=0', () => {
            const c = build();
            document.body.appendChild(c);
            c.setAttribute('data-ht-collapsed', '0');
            const tc = c.querySelector(selectors.THINK_CONTENT_SELECTOR);
            const evt = new MouseEvent('click', { bubbles: false });
            Object.defineProperty(evt, 'target', { value: c });
            c.dispatchEvent(evt);
            expect(tc.style.display).toBe('block');
        });
    });
});
