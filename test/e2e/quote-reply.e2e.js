import { test, expect } from './fixtures.js';
import { composer } from './helpers/composer.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { QUOTE_BUTTON_SELECTOR } from './helpers/extension-ui.js';
import { expectNeverWithin } from './helpers/observation.js';
import { DSSelectors } from './helpers/selectors.js';

// Quote reply follows the master switch only: selecting reply text shows a floating quote button; clicking it appends the selection to the composer as a Markdown blockquote, every selected line prefixed with "> " (docs/FEATURES.md, 引用回覆). Nothing is sent.

// The quote button appears 250 ms after the selection settles; 1.5 s is six times that.
const NO_BUTTON_WINDOW_MS = 1_500;

/** A reply body (not a thinking block) holding at least two paragraphs. */
const REPLY_WITH_TWO_PARAGRAPHS = `${DSSelectors.VISIBLE_ITEMS_SELECTOR} ${DSSelectors.MARKDOWN_SELECTOR}:not(${DSSelectors.THINK_CONTENT_SELECTOR} ${DSSelectors.MARKDOWN_SELECTOR}):has(> p ~ p)`;

/** Drags the mouse from the first character of a reply's first paragraph to the last character of its second, and returns the selected text. */
async function dragSelectTwoReplyParagraphs(page) {
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
function asBlockquote(text) {
    return text.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

test.describe('quote reply', () => {
    test('quoting a two-paragraph reply selection writes it into the empty composer as a blockquote', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: true });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        const input = composer(page);
        const quoteButton = page.locator(QUOTE_BUTTON_SELECTOR);
        try {
            await input.fill('');
            await expect(quoteButton, 'no quote button before any selection').toBeHidden();

            const selected = await dragSelectTwoReplyParagraphs(page);
            expect(selected, 'the drag selected text spanning more than one line').toMatch(/\S[\s\S]*\n[\s\S]*\S/);
            await expect(quoteButton, 'selecting reply text shows the quote button').toBeVisible();
            await expect(input, 'the composer is still empty before quoting').toHaveValue('');

            await quoteButton.click();
            await expect(input, 'the composer holds the selection as a blockquote, every line prefixed with "> "').toHaveValue(asBlockquote(selected));
        } finally {
            await input.fill('');
        }
    });

    test('with the master switch off a reply selection shows no quote button; switching it on brings the button back', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: false });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        const quoteButton = page.locator(QUOTE_BUTTON_SELECTOR);

        const selectedWhileOff = await dragSelectTwoReplyParagraphs(page);
        expect(selectedWhileOff.trim(), 'the drag selected reply text (precondition)').not.toBe('');
        await expectNeverWithin(page, (selector) => !!document.querySelector(selector)?.checkVisibility(), QUOTE_BUTTON_SELECTOR, NO_BUTTON_WINDOW_MS, 'with the master switch off no quote button may appear');

        await settings.set({ isEnabled: true });
        // The switch reaches the page asynchronously, so the selection gesture is repeated until the feature is live.
        await expect(async () => {
            await page.evaluate(() => window.getSelection().removeAllRanges());
            await dragSelectTwoReplyParagraphs(page);
            await expect(quoteButton, 'after switching on, the same selection shows the quote button').toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
    });
});
