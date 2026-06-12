import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures');

describe('parseHtmlToMarkdown (4.x export parser)', () => {
    const { parseHtmlToMarkdown } = contentScript;

    beforeEach(() => {
        contentScript.__resetState();
    });

    function loadFixture(name) {
        const html = fs.readFileSync(path.join(FIXTURES, 'html-snippets', `${name}.html`), 'utf-8').replace(/\r\n/g, '\n');
        const expected = fs.readFileSync(path.join(FIXTURES, 'markdown-expected', `${name}.md`), 'utf-8');
        return { html, expected: expected.trim().replace(/\r\n/g, '\n') };
    }

    function parseHtml(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        return doc.body.firstElementChild;
    }

    it('converts basic paragraphs with bold/italic/links', () => {
        const { html, expected } = loadFixture('basic-paragraph');
        const node = parseHtml(html);
        const result = parseHtmlToMarkdown(node, { forceReferences: true });
        expect(result).toBe(expected);
    });

    it('converts code blocks with language annotation', () => {
        const { html, expected } = loadFixture('code-block');
        const node = parseHtml(html);
        const result = parseHtmlToMarkdown(node, { forceReferences: true });
        expect(result).toBe(expected);
    });

    it('converts tables', () => {
        const { html, expected } = loadFixture('table');
        const node = parseHtml(html);
        const result = parseHtmlToMarkdown(node, { forceReferences: true });
        expect(result).toBe(expected);
    });

    it('converts citations with reference links', () => {
        const { html, expected } = loadFixture('citation');
        const node = parseHtml(html);
        const result = parseHtmlToMarkdown(node, { forceReferences: true });
        expect(result).toBe(expected);
    });

    it('converts nested lists', () => {
        const { html, expected } = loadFixture('nested-list');
        const node = parseHtml(html);
        const result = parseHtmlToMarkdown(node, { forceReferences: true });
        expect(result).toBe(expected);
    });

    it('returns empty string for empty input', () => {
        const result = parseHtmlToMarkdown(document.createElement('div'), { forceReferences: true });
        expect(result).toBe('');
    });

    it('handles forceReferences=false suppressing citation links', () => {
        const { html } = loadFixture('citation');
        const node = parseHtml(html);
        const result = parseHtmlToMarkdown(node, { forceReferences: false });
        // forceReferences=false hides the [[link-N]](url) output
        expect(result).not.toContain('[[link-');
    });

    it('strips redundant newlines', () => {
        const div = document.createElement('div');
        div.innerHTML = '<p>Line 1</p><p>Line 2</p>';
        const result = parseHtmlToMarkdown(div, { forceReferences: true });
        expect(result).not.toMatch(/\n{3,}/);
    });
});
