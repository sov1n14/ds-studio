import { describe, it, expect, beforeEach } from 'vitest';
import '../../utils/storage-manager.js';
import CensorReplyRestore from '../../content/censor-reply-restore.js';
import { resetCensorReplyRestore } from '../helpers/censor-reply-restore-fixtures.js';

/**
 * Markdown rendering, think-block construction, and _injectRestoredContent
 * placing restored content into a censored message element.
 *
 * Split out of the original censor-reply-restore.spec.js monolith; every case
 * below is the unchanged original assertion set.
 */
describe('CensorReplyRestore — rendering and content injection', () => {
    beforeEach(resetCensorReplyRestore);

    describe('_renderMarkdown()', () => {
        // Each row is a true parameter variation of the same assertion shape:
        // render the markdown input, then confirm every expected substring is present.
        it.each([
            ['renders a simple paragraph', 'Hello world', ['<p class="ds-markdown-paragraph">', '<span>Hello world</span>']],
            ['renders headings', '# Title\n## Sub', ['<h1><span>Title</span></h1>', '<h2><span>Sub</span></h2>']],
            ['renders bold and italic', '**bold** and *italic*', ['<strong><span>bold</span></strong>', '<em><span>italic</span></em>']],
            ['renders inline code', 'Use `code` here', ['<code>code</code>']],
            ['renders links', '[text](https://example.com)', ['<a href="https://example.com" target="_blank" rel="noreferrer">', '<span>text</span>']],
            ['renders horizontal rule', '---', ['<hr>']],
            ['renders blockquote', '> quote text', ['<blockquote>', 'quote text']],
            ['renders unordered list', '- item1\n- item2', ['<ul>', '<li><p><span>item1</span></p></li>', '<li><p><span>item2</span></p></li>']],
            ['renders ordered list', '1. first\n2. second', ['<ol start="1">', '<span>first</span>']],
            ['renders code block', '```js\nconst x = 1;\n```', ['<div class="md-code-block md-code-block-dark">', 'const x = 1;']],
            ['renders tables', '| H1 | H2 |\n|---|---|\n| A | B |', ['<table>', '<th><span>H1</span></th>', '<td><span>A</span></td>']]
        ])('%s', (_name, markdown, expectedSubstrings) => {
            const html = CensorReplyRestore._renderMarkdown(markdown);
            for (const substr of expectedSubstrings) {
                expect(html).toContain(substr);
            }
        });

        it('returns empty string for null/empty input', () => {
            expect(CensorReplyRestore._renderMarkdown('')).toBe('');
            expect(CensorReplyRestore._renderMarkdown(null)).toBe('');
        });
    });

    describe('_buildThinkBlock() — no longer forces collapse', () => {
        it('think block is expanded by default', () => {
            const container = CensorReplyRestore._buildThinkBlock({ content: 'test thinking' }, 1.5);

            expect(container.hasAttribute('data-ht-collapsed')).toBe(false);

            const thinkContent = container.querySelector('.ds-think-content');
            expect(thinkContent.style.display).not.toBe('none');
        });

        it('container click handler hides content when data-ht-collapsed is set', () => {
            const container = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 1.5);
            document.body.appendChild(container);

            container.setAttribute('data-ht-collapsed', '1');
            container.click();

            const thinkContent = container.querySelector('.ds-think-content');
            expect(thinkContent.style.display).toBe('none');
        });

        it('container click handler shows content when data-ht-collapsed is cleared', () => {
            const container = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 1.5);
            document.body.appendChild(container);

            container.setAttribute('data-ht-collapsed', '0');
            container.click();

            const thinkContent = container.querySelector('.ds-think-content');
            expect(thinkContent.style.display).not.toBe('none');
        });

        it('container click does NOT fire when header is clicked', () => {
            const container = CensorReplyRestore._buildThinkBlock({ content: 'test' }, 1.5);
            document.body.appendChild(container);

            const header = container.querySelector('._245c867');
            const thinkContent = container.querySelector('.ds-think-content');

            header.click();

            expect(container.getAttribute('data-ht-collapsed')).toBe('1');
            expect(thinkContent.style.display).toBe('none');

            header.click();

            expect(container.getAttribute('data-ht-collapsed')).toBe('0');
            expect(thinkContent.style.display).not.toBe('none');
        });
    });

    describe('_injectRestoredContent()', () => {
        function createMessageEl(withThinkContainer) {
            const msgEl = document.createElement('div');
            msgEl.className = 'ds-message _63c77b1';

            if (withThinkContainer) {
                const thinkWrap = document.createElement('div');
                thinkWrap.className = '_74c0879';
                const thinkContent = document.createElement('div');
                thinkContent.className = 'e1675d8b ds-think-content _767406f';
                const sep = document.createElement('div');
                sep.className = '_9ecc93a';
                thinkContent.appendChild(sep);
                thinkWrap.appendChild(thinkContent);
                msgEl.appendChild(thinkWrap);
            }

            const mainContent = document.createElement('div');
            mainContent.className = 'ds-markdown ds-assistant-message-main-content';
            mainContent.textContent = 'censored text';
            msgEl.appendChild(mainContent);

            return msgEl;
        }

        it('injects response content without think fragment', () => {
            const msgEl = createMessageEl(false);
            const record = {
                message_id: 38,
                fragments: [{ type: 'RESPONSE', content: 'Hello' }]
            };

            CensorReplyRestore._injectRestoredContent(msgEl, record);
            const mainContent = msgEl.querySelector('.ds-assistant-message-main-content.restored-content');
            expect(mainContent).not.toBeNull();
            expect(mainContent.innerHTML).toContain('Hello');
            expect(mainContent.innerHTML).toContain('restored-badge');
        });

        it('injects response with think fragment when think container exists', () => {
            const msgEl = createMessageEl(true);
            const record = {
                message_id: 38,
                fragments: [
                    { type: 'THINK', content: 'thinking...' },
                    { type: 'RESPONSE', content: 'answer' }
                ],
                thinking_elapsed_secs: 2.5
            };

            CensorReplyRestore._injectRestoredContent(msgEl, record);
            const thinkContent = msgEl.querySelector('._74c0879.restored-content');
            expect(thinkContent).not.toBeNull();
            const restoredEl = msgEl.querySelector('.ds-assistant-message-main-content.restored-content');
            expect(restoredEl).not.toBeNull();
            expect(restoredEl.innerHTML).toContain('answer');
        });

        it('builds think block when think container is missing', () => {
            const msgEl = createMessageEl(false);
            const record = {
                message_id: 38,
                fragments: [
                    { type: 'THINK', content: 'thinking...' },
                    { type: 'RESPONSE', content: 'answer' }
                ]
            };

            CensorReplyRestore._injectRestoredContent(msgEl, record);
            const thinkBlock = msgEl.querySelector('._74c0879');
            expect(thinkBlock).not.toBeNull();
        });

        it('does nothing for empty fragments', () => {
            const msgEl = createMessageEl(false);
            CensorReplyRestore._injectRestoredContent(msgEl, { message_id: 38, fragments: [] });
            const mainContent = msgEl.querySelector('.restored-content');
            expect(mainContent).toBeNull();
        });

        it('adds dss-censored-hidden class to original content element', () => {
            const msgEl = createMessageEl(false);
            const record = { message_id: 38, fragments: [{ type: 'RESPONSE', content: 'Hello' }] };
            CensorReplyRestore._injectRestoredContent(msgEl, record);
            const originalContent = msgEl.querySelector('.ds-assistant-message-main-content:not(.restored-content)');
            expect(originalContent).not.toBeNull();
            expect(originalContent.classList.contains('dss-censored-hidden')).toBe(true);
        });

        it('does not double-inject when restored-content already exists', () => {
            const msgEl = createMessageEl(false);
            const mainContent = msgEl.querySelector('.ds-assistant-message-main-content');
            mainContent.classList.add('restored-content');
            const record = { message_id: 38, fragments: [{ type: 'RESPONSE', content: 'Hello' }] };
            CensorReplyRestore._tryRestoreMessage(msgEl);
            expect(msgEl.querySelectorAll('.restored-content')).toHaveLength(1);
        });
    });
});
