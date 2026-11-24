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

/**
 * 以滑鼠在回覆第一段的第一行內拖曳選取一段文字（不跨行），並回傳選取的文字。
 * 選取範圍取自第一個非空白文字節點：從第一個非空白字元起，最多 20 個字元，且每個字元都與起點位於同一行。
 */
export async function dragSelectWithinReplyLine(page) {
    const paragraph = page.locator(REPLY_WITH_TWO_PARAGRAPHS).first().locator(':scope > p').filter({ hasText: /\S/ }).first();
    await paragraph.scrollIntoViewIfNeeded();
    const { from, to } = await paragraph.evaluate((p) => {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
        const node = walker.nextNode();
        const charRect = (offset) => {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            return range.getBoundingClientRect();
        };
        const start = node.textContent.search(/\S/);
        const first = charRect(start);
        let last = start;
        for (let i = start + 1; i < Math.min(node.textContent.length, start + 20); i += 1) {
            const rect = charRect(i);
            if (Math.abs(rect.top - first.top) > 1) break;
            if (node.textContent[i].trim()) last = i;
        }
        const end = charRect(last);
        return { from: { x: first.left + 1, y: first.top + first.height / 2 }, to: { x: end.right - 1, y: end.top + end.height / 2 } };
    });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    return page.evaluate(() => window.getSelection().toString());
}
