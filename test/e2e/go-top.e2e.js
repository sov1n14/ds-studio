import { test, expect } from './fixtures.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { GO_TOP_SELECTOR } from './helpers/extension-ui.js';
import { readListScroll } from './helpers/scroll.js';

// Go-to-top follows the master switch only (master-switch.e2e.js covers on/off). Opening a long conversation lands at its bottom, where the button shows; activating it scrolls the message list to the very top, where the button hides.

const FAR_FROM_TOP_PX = 1_000;

async function openFarFromTop(page, openConversation, settings) {
    await settings.set({ isEnabled: true, dsPreventAutoScroll: false });
    await openConversation(CONVERSATIONS.longWithCode);
    await expect.poll(async () => (await readListScroll(page))?.top ?? 0, { message: 'the conversation opens far from the top (precondition)' }).toBeGreaterThan(FAR_FROM_TOP_PX);
    const goTop = page.locator(GO_TOP_SELECTOR);
    await expect(goTop, 'go-top shows while the list is away from the top').toBeVisible();
    return goTop;
}

async function expectAtTopWithButtonHidden(page, goTop) {
    await expect.poll(async () => (await readListScroll(page)).top, { message: 'the message list reaches the very top' }).toBe(0);
    await expect(goTop, 'go-top hides once the list is at the top').toBeHidden();
}

test.describe('go to top', () => {
    test('clicking go-top scrolls the message list to the very top and hides the button', async ({ page, settings, openConversation }) => {
        const goTop = await openFarFromTop(page, openConversation, settings);
        await goTop.click();
        await expectAtTopWithButtonHidden(page, goTop);
    });

    test('pressing Enter on the focused go-top button scrolls to the very top', async ({ page, settings, openConversation }) => {
        const goTop = await openFarFromTop(page, openConversation, settings);
        await goTop.focus();
        await page.keyboard.press('Enter');
        await expectAtTopWithButtonHidden(page, goTop);
    });
});
