import { test, expect } from './fixtures.js';
import { clickSendWith, composer, guardAgainstSending } from './helpers/composer.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { pacedTimeout } from './helpers/human.js';
import { QUOTE_BUTTON_SELECTOR } from './helpers/extension-ui.js';
import { createTestPreset, pickPreset, seedOnlyPreset } from './helpers/presets.js';
import { asBlockquote, dragSelectTwoReplyParagraphs } from './helpers/quote.js';
import { DSSelectors } from './helpers/selectors.js';

// Regression for v4.36.8: while DeepSeek's native edit box is open on a user message, the page holds two textareas (the edit box first, the main composer after it).
// Composer actions must keep targeting the main composer: the picked preset's prefix (written at send time) and a quote reply land in the main composer, and the edit box keeps only the original message text (docs/FEATURES.md, Edit Message Cleanup, Quote Reply, Using Prompt Injection).
// Nothing is sent: the composer Send click is swallowed before DeepSeek's React root and every send endpoint is aborted; the edit is never submitted.

const PRESET = createTestPreset('edit');
const USER_TEXT = 'e2e edit-window probe (never sent)';

/** User message items currently rendered in the conversation list. */
const USER_MESSAGE_ITEM = DSSelectors.VISIBLE_ITEMS_SELECTOR + ' > ' + DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR + ':has(' + DSSelectors.USER_CONTENT_SELECTOR + ')';

/** The documented edit-box cleanup: a message wrapped as <user-input>...</user-input> is shown without the wrapper. */
function originalMessageText(displayed) {
    const wrapped = displayed.match(/<user-input>\n([\s\S]*)\n<\/user-input>/);
    return wrapped ? wrapped[1] : displayed;
}

/** Opens the native edit box on the first rendered user message; resolves the edit box locator and the message's original text. */
async function openEditBoxOnFirstUserMessage(page) {
    const firstItem = page.locator(USER_MESSAGE_ITEM).first();
    await expect(firstItem, 'the conversation shows a user message to edit (precondition)').toBeVisible();
    const key = await firstItem.getAttribute(DSSelectors.VIRTUAL_ITEM_KEY_ATTR);
    // Pin the item by its key: the virtual list re-renders, so a positional locator could drift to another message.
    const item = page.locator(DSSelectors.VISIBLE_ITEMS_SELECTOR + ' > [' + DSSelectors.VIRTUAL_ITEM_KEY_ATTR + '="' + key + '"]');
    const original = originalMessageText(await item.locator(DSSelectors.USER_CONTENT_SELECTOR).innerText());
    expect(original.trim(), 'the user message has text (precondition)').not.toBe('');

    await item.hover();
    await page.locator(DSSelectors.EDIT_MESSAGE_BUTTON_SELECTOR).and(item.locator('[role="button"]')).click();
    const editBox = item.locator('textarea');
    await expect(editBox, 'the native edit box opens inside the edited message').toBeVisible();
    await expect(page.locator('textarea'), 'the page now holds two textareas: the edit box and the main composer (precondition)').toHaveCount(2);
    await expect(editBox, 'the edit box opens holding only the original message text').toHaveValue(original);
    return { editBox, original };
}

test.describe('edit message (v4.36.8 regression)', () => {
    test('with the edit box open, a quote reply and the preset prefix land in the main composer and the edit box keeps only the original text', async ({ page, context, settings, openConversation }) => {
        await seedOnlyPreset(settings, context, PRESET);
        await settings.set({ isEnabled: true });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        await pickPreset(page, PRESET);
        const guard = await guardAgainstSending(page);
        const input = composer(page);
        try {
            await input.fill('');
            const { editBox, original } = await openEditBoxOnFirstUserMessage(page);

            const selected = await dragSelectTwoReplyParagraphs(page);
            expect(selected.trim(), 'the drag selected reply text (precondition)').not.toBe('');
            await page.locator(QUOTE_BUTTON_SELECTOR).click();
            await expect(input, 'the quote lands in the main composer as a blockquote (quote reply is active)').toHaveValue(asBlockquote(selected));
            await expect(editBox, 'the quote does not land in the edit box').toHaveValue(original);

            await expect(async () => {
                const value = await clickSendWith(page, USER_TEXT);
                expect(value, 'clicking the composer Send writes the preset prefix into the main composer (prefix is active)').toContain(PRESET.content);
                expect(value, 'the typed text is kept beside the prefix').toContain(USER_TEXT);
            }).toPass({ timeout: pacedTimeout(15_000) });
            await expect(editBox, 'the preset prefix does not land in the edit box, which still holds only the original text').toHaveValue(original);

            expect(guard.sendRequests(), 'no send request left the page').toBe(0);
        } finally {
            await input.fill('');
        }
    });
});
