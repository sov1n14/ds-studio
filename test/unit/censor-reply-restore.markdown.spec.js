import { describe, it, expect } from 'vitest';

const bundle = require('../../content/censor-reply-restore.markdown.js');

describe('censor-reply-restore.markdown mutant killers', () => {

    describe('_escapeHtml', () => {
        it('escapes ampersand', () => {
            expect(bundle._escapeHtml('a & b')).toBe('a &amp; b');
        });
        it('escapes less-than', () => {
            expect(bundle._escapeHtml('<div>')).toBe('&lt;div&gt;');
        });
        it('escapes greater-than', () => {
            expect(bundle._escapeHtml('a > b')).toBe('a &gt; b');
        });
        it('all three chars together', () => {
            expect(bundle._escapeHtml('& < >')).toBe('&amp; &lt; &gt;');
        });
    });

    describe('_renderInline', () => {
        it('link exact output', () => {
            expect(bundle._renderInline('[t](http://x)')).toBe('<a href="http://x" target="_blank" rel="noreferrer"><span>t</span></a>');
        });
        it('bold exact', () => {
            expect(bundle._renderInline('**b**')).toBe('<strong><span>b</span></strong>');
        });
        it('italic exact', () => {
            expect(bundle._renderInline('*i*')).toBe('<em><span>i</span></em>');
        });
        it('inline code exact', () => {
            const bt = String.fromCharCode(96);
            expect(bundle._renderInline(bt + 'c' + bt)).toBe('<code>c</code>');
        });
        it('escapes before formatting', () => {
            expect(bundle._renderInline('& **b**')).toBe('&amp; <strong><span>b</span></strong>');
        });
    });

    describe('_renderMarkdown', () => {
        it('falsy returns empty', () => {
            expect(bundle._renderMarkdown(null)).toBe('');
            expect(bundle._renderMarkdown(undefined)).toBe('');
            expect(bundle._renderMarkdown('')).toBe('');
            expect(bundle._renderMarkdown(0)).toBe('');
        });

        it('simple paragraph exact output', () => {
            expect(bundle._renderMarkdown('hello')).toBe('<p class="ds-markdown-paragraph"><span>hello</span></p>\n');
        });

        it('consecutive lines join with space', () => {
            expect(bundle._renderMarkdown('a\nb')).toContain('a b');
        });

        it('empty line separates paragraphs', () => {
            const html = bundle._renderMarkdown('p1\n\np2');
            expect((html.match(/<p /g) || []).length).toBe(2);
        });

        it('h3 level', () => {
            const html = bundle._renderMarkdown('### T');
            expect(html).toContain('<h3>');
            expect(html).toContain('</h3>');
        });

        it('heading inline rendering', () => {
            expect(bundle._renderMarkdown('# **B**')).toContain('<strong><span>B</span></strong>');
        });

        it('--- is hr', () => {
            expect(bundle._renderMarkdown('---').trim()).toBe('<hr>');
        });

        it('---- is also hr', () => {
            expect(bundle._renderMarkdown('----').trim()).toBe('<hr>');
        });

        it('-- is NOT hr', () => {
            expect(bundle._renderMarkdown('--')).not.toContain('<hr>');
        });

        it('code block without lang omits lang header', () => {
            const fence = String.fromCharCode(96, 96, 96);
            const html = bundle._renderMarkdown(fence + '\ncode\n' + fence);
            expect(html).not.toContain('md-code-lang');
            expect(html).toContain('<pre><span>code</span></pre>');
        });

        it('code block with lang shows lang', () => {
            const fence = String.fromCharCode(96, 96, 96);
            const html = bundle._renderMarkdown(fence + 'py\nprint(1)\n' + fence);
            expect(html).toContain('<span class="md-code-lang">py</span>');
        });

        it('code block preserves newlines', () => {
            const fence = String.fromCharCode(96, 96, 96);
            const html = bundle._renderMarkdown(fence + '\nL1\nL2\n' + fence);
            expect(html).toContain('L1\nL2');
        });

        it('code block escapes HTML', () => {
            const fence = String.fromCharCode(96, 96, 96);
            const html = bundle._renderMarkdown(fence + '\n<b>\n' + fence);
            expect(html).toContain('&lt;b&gt;');
        });

        it('multi-line blockquote joins with newline', () => {
            const html = bundle._renderMarkdown('> L1\n> L2');
            expect(html).toContain('L1\nL2');
        });

        it('blockquote exact structure', () => {
            const html = bundle._renderMarkdown('> q');
            expect(html).toContain('<blockquote><p class="ds-markdown-paragraph"><span>q</span></p></blockquote>');
        });

        it('blockquote stops at non-quote line', () => {
            const html = bundle._renderMarkdown('> quoted\nnot quoted');
            expect(html).toContain('<blockquote>');
            expect(html).toContain('<p class="ds-markdown-paragraph">');
        });

        it('UL exact structure', () => {
            const html = bundle._renderMarkdown('- a\n- b');
            expect(html).toContain('<ul>\n  <li><p><span>a</span></p></li>\n  <li><p><span>b</span></p></li>\n</ul>');
        });

        it('UL with * marker', () => {
            const html = bundle._renderMarkdown('* x\n* y');
            expect(html).toContain('<ul>');
            expect(html).toContain('<li><p><span>x</span></p></li>');
        });

        it('UL items get inline rendering', () => {
            expect(bundle._renderMarkdown('- **b**')).toContain('<strong><span>b</span></strong>');
        });

        it('OL starts at 1', () => {
            expect(bundle._renderMarkdown('1. a\n2. b')).toContain('<ol start="1">');
        });

        it('OL strips multi-digit prefix', () => {
            expect(bundle._renderMarkdown('10. t')).toContain('<span>t</span>');
        });

        it('OL has closing tag', () => {
            expect(bundle._renderMarkdown('1. a')).toContain('</ol>');
        });

        it('OL items get inline rendering', () => {
            expect(bundle._renderMarkdown('1. *i*')).toContain('<em><span>i</span></em>');
        });

        it('single row table no table tag', () => {
            expect(bundle._renderMarkdown('| H |')).not.toContain('<table>');
        });

        it('table skips separator', () => {
            const html = bundle._renderMarkdown('| H |\n|---|\n| D |');
            expect(html).toContain('<th><span>H</span></th>');
            expect(html).toContain('<td><span>D</span></td>');
        });

        it('table wraps in ds-scroll-area', () => {
            expect(bundle._renderMarkdown('| A |\n|---|\n| B |')).toContain('<div class="ds-scroll-area">');
        });

        it('table header inline rendering', () => {
            expect(bundle._renderMarkdown('| **H** |\n|---|\n| D |')).toContain('<strong><span>H</span></strong>');
        });

        it('table correct header count', () => {
            const html = bundle._renderMarkdown('| A | B |\n|---|---|\n| X | Y |');
            expect((html.match(/<th>/g) || []).length).toBe(2);
        });

        it('table correct body cell count', () => {
            const html = bundle._renderMarkdown('| A |\n|---|\n| X |\n| Y |');
            expect((html.match(/<td>/g) || []).length).toBe(2);
        });

        it('table body cell inline rendering', () => {
            const bt = String.fromCharCode(96);
            const html = bundle._renderMarkdown('| H |\n|---|\n| ' + bt + 'code' + bt + ' |');
            expect(html).toContain('<code>code</code>');
        });

        it('paragraph inline rendering', () => {
            const html = bundle._renderMarkdown('a **b** c');
            expect(html).toContain('a <strong><span>b</span></strong> c');
        });
    });

    describe('_renderTokens', () => {
        it('paragraph', () => {
            expect(bundle._renderTokens([{ type: 'paragraph', content: 'hi' }]))
                .toBe('<p class="ds-markdown-paragraph"><span>hi</span></p>\n');
        });
        it('heading', () => {
            expect(bundle._renderTokens([{ type: 'heading', level: 2, content: 't' }]))
                .toBe('<h2><span>t</span></h2>\n');
        });
        it('hr', () => {
            expect(bundle._renderTokens([{ type: 'hr' }])).toBe('<hr>\n');
        });
        it('blockquote', () => {
            expect(bundle._renderTokens([{ type: 'blockquote', content: 'q' }]))
                .toBe('<blockquote><p class="ds-markdown-paragraph"><span>q</span></p></blockquote>\n');
        });
        it('ul', () => {
            expect(bundle._renderTokens([{ type: 'ul', items: ['a', 'b'] }]))
                .toBe('<ul>\n  <li><p><span>a</span></p></li>\n  <li><p><span>b</span></p></li>\n</ul>\n');
        });
        it('ol', () => {
            expect(bundle._renderTokens([{ type: 'ol', items: ['x'] }]))
                .toBe('<ol start="1">\n  <li><p><span>x</span></p></li>\n</ol>\n');
        });
        it('code without lang', () => {
            expect(bundle._renderTokens([{ type: 'code', lang: '', code: 'x' }]))
                .toBe('<div class="md-code-block md-code-block-dark"><pre><span>x</span></pre></div>\n');
        });
        it('code with lang', () => {
            const html = bundle._renderTokens([{ type: 'code', lang: 'js', code: 'y' }]);
            expect(html).toContain('<div class="md-code-block-header"><span class="md-code-lang">js</span></div>');
        });
        it('code escapes HTML', () => {
            expect(bundle._renderTokens([{ type: 'code', lang: '', code: '<b>' }])).toContain('&lt;b&gt;');
        });
        it('table token', () => {
            expect(bundle._renderTokens([{ type: 'table', rows: ['| A |', '|---|', '| B |'] }])).toContain('<table>');
        });
        it('unknown type empty', () => {
            expect(bundle._renderTokens([{ type: 'zzz' }])).toBe('');
        });
        it('multiple tokens concatenate', () => {
            expect(bundle._renderTokens([{ type: 'hr' }, { type: 'paragraph', content: 'p' }]))
                .toBe('<hr>\n<p class="ds-markdown-paragraph"><span>p</span></p>\n');
        });
    });

    describe('_renderTable', () => {
        it('empty array returns empty', () => {
            expect(bundle._renderTable([])).toBe('');
        });
        it('1 row returns empty', () => {
            expect(bundle._renderTable(['| A |'])).toBe('');
        });
        it('2 rows: header only no body', () => {
            const html = bundle._renderTable(['| H |', '|---|']);
            expect(html).toContain('<th>');
            expect(html).not.toContain('<td>');
        });
        it('body starts from index 2', () => {
            const html = bundle._renderTable(['| H |', '|---|', '| D1 |', '| D2 |']);
            expect((html.match(/<td>/g) || []).length).toBe(2);
        });
        it('cells are trimmed', () => {
            const html = bundle._renderTable(['|  H  |', '|---|', '|  D  |']);
            expect(html).toContain('<th><span>H</span></th>');
            expect(html).toContain('<td><span>D</span></td>');
        });
        it('starts with scroll-area', () => {
            const html = bundle._renderTable(['| A |', '|---|', '| B |']);
            expect(html.startsWith('<div class="ds-scroll-area">')).toBe(true);
        });
        it('ends with closing tags', () => {
            const html = bundle._renderTable(['| A |', '|---|', '| B |']);
            expect(html).toContain('</tbody></table></div>');
        });
        it('filters empty cells', () => {
            const html = bundle._renderTable(['| A | B |', '|---|---|', '| X | Y |']);
            expect((html.match(/<th>/g) || []).length).toBe(2);
            expect((html.match(/<td>/g) || []).length).toBe(2);
        });
    });
});
