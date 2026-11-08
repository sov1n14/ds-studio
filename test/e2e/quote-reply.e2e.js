import { test, expect } from './fixtures.js';
import { composer } from './helpers/composer.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { QUOTE_BUTTON_SELECTOR } from './helpers/extension-ui.js';
import { expectNeverWithin } from './helpers/observation.js';
import { asBlockquote, dragSelectTwoReplyParagraphs } from './helpers/quote.js';

// Quote reply follows the master switch only: selecting reply text shows a floating quote button; clicking it appends the selection to the composer as a Markdown blockquote, every selected line prefixed with "> " (docs/FEATURES.md, Quote Reply). Nothing is sent.

// The quote button appears 250 ms after the selection settles; 1.5 s is six times that.
const NO_BUTTON_WINDOW_MS = 1_500;

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
