import { test, expect } from './fixtures.js';
import { blockSendRequests, composer } from './helpers/composer.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { createTestPreset, pickPreset, presetOverlay, seedOnlyPreset } from './helpers/presets.js';

// Prompt injection prepends the picked preset's content to the message when it is sent; with the empty option picked no preset content is sent (docs/FEATURES.md, Using Prompt Injection and Using No Prompt Group).
// The spec drives DeepSeek's real send path (Enter in the composer) and reads the prompt DeepSeek would have posted: every send request is aborted in the browser, so nothing reaches DeepSeek.

const PRESET = createTestPreset('inject');
const USER_TEXT = 'e2e prompt injection probe (aborted before it leaves the browser)';
const COMPLETION_PATH = '/api/v0/chat/completion';

/** Presses Enter on `text` in the composer and resolves the prompt of the (aborted) completion request it produced. */
async function sendAndCapturePrompt(page, blocked, text) {
    const before = blocked.requests().length;
    await composer(page).fill(text);
    await composer(page).press('Enter');
    await expect.poll(() => blocked.requests().slice(before).some(({ url }) => new URL(url).pathname === COMPLETION_PATH), { message: 'pressing Enter posts a completion request (aborted)' }).toBe(true);
    const completion = blocked.requests().slice(before).find(({ url }) => new URL(url).pathname === COMPLETION_PATH);
    expect(typeof completion.body?.prompt, 'the completion request carries a prompt field').toBe('string');
    return completion.body.prompt;
}

/** Opens a fresh home page with every send request blocked, the overlay shown and no preset picked. */
async function openHomeBlockingSends(page) {
    const blocked = await blockSendRequests(page);
    await page.goto(DEEPSEEK_ORIGIN + '/');
    await expect(presetOverlay(page), 'the preset overlay is shown (precondition)').toBeVisible();
    await expect(presetOverlay(page), 'no preset is picked on a new chat (precondition)').not.toContainText(PRESET.name);
    return blocked;
}

test.describe('prompt injection', () => {
    test.beforeEach(async ({ context, settings }) => {
        await seedOnlyPreset(settings, context, PRESET);
        await settings.set({ isEnabled: true });
    });

    test('with no preset picked the sent prompt carries the typed text and no preset content', async ({ page }) => {
        const blocked = await openHomeBlockingSends(page);
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'the sent prompt carries the typed text').toContain(USER_TEXT);
        expect(prompt, 'with no preset picked the sent prompt carries no preset content').not.toContain(PRESET.content);
    });

    test('with a preset picked the sent prompt carries the preset content before the typed text', async ({ page }) => {
        const blocked = await openHomeBlockingSends(page);
        await pickPreset(page, PRESET);
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'the sent prompt carries the picked preset content').toContain(PRESET.content);
        expect(prompt, 'the sent prompt still carries the typed text').toContain(USER_TEXT);
        expect(prompt.indexOf(PRESET.content), 'the preset content comes before the typed text').toBeLessThan(prompt.indexOf(USER_TEXT));
    });
});
