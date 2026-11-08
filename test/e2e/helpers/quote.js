// Selecting reply text the way a user does, and the blockquote format quote reply writes (docs/FEATURES.md, Quote Reply).

import { expect } from '@playwright/test';
import { DSSelectors } from './selectors.js';

/** A reply body (not a thinking block) holding at least two paragraphs. */
const REPLY_WITH_TWO_PARAGRAPHS = DSSelectors.VISIBLE_ITEMS_SELECTOR + ' ' + DSSelectors.MARKDOWN_SELECTOR
    + ':not(' + DSSelectors.THINK_CONTENT_SELECTOR + ' ' + DSSelectors.MARKDOWN_SELECTOR + '):has(> p ~ p)';

/** Drags the mouse from the first character of a reply's first paragraph to the last character of its second, and returns the selected text. */
export async function dragSelectTwoReplyParagraphs(page) {
    const paragraphs = page.locator(REPLY_WITH_TWO_PARAGRAPHS).first().locator(':scope > p').filter({ hasText: /\S/ });
    await expect.poll(() => paragraphs.count(), { message: 'a reply has at least two paragraphs to select' }).toBeGreaterThanOrEqual(2);
    await paragraphs.nth(0).scrollIntoViewIfNeeded();
    const [from, to] = await Promise.all([0, 1].map((i) => paragraphs.nth(i).evaluate((p, isFirst) => {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        const node = isFirst ? texts[0] : texts[texts.length - 1];
        const range = document.createRange();
        const offset = isFirst ? 0 : node.textContent.length - 1;
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        return isFirst ? { x: rect.left + 1, y: rect.top + rect.height / 2 } : { x: rect.right - 1, y: rect.top + rect.height / 2 };
    }, i === 0)));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    return page.evaluate(() => window.getSelection().toString());
}

/** The documented quote format: every selected line prefixed with "> ". */
export function asBlockquote(text) {
    return text.split(/\r?\n/).map((line) => '> ' + line).join('\n');
}
