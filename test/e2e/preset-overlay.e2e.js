import { test, expect } from './fixtures.js';
import { composer, guardAgainstSending, pressEnterWith } from './helpers/composer.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { createTestPreset, pickPreset, pickPresetOption, presetOverlay, seedOnlyPreset } from './helpers/presets.js';

// The in-page preset overlay picks the prompt group for the current tab. Picking does not write the composer: the extension prepends the picked group's content when the message is sent (docs/FEATURES.md, Using Prompt Injection step 2, and In-Page Quick Switch Overlay).
// The observable effect without sending: press Enter with the send guard on, then read the composer, which the extension has rewritten for sending; DeepSeek never receives the Enter and the send endpoints are aborted.

const PRESET = createTestPreset('overlay');
const USER_TEXT = 'e2e preset overlay probe (never sent)';

test.describe('preset overlay', () => {
    test('picking a preset makes the composer carry its content at send time; picking the empty option drops it', async ({ page, context, settings }) => {
        await seedOnlyPreset(settings, context, PRESET);
        await settings.set({ isEnabled: true });
        await page.goto(DEEPSEEK_ORIGIN + '/');

        const overlay = presetOverlay(page);
        await expect(overlay, 'the preset overlay is shown in the chat header').toBeVisible();
        await expect(overlay, 'no preset is picked yet (precondition)').not.toContainText(PRESET.name);
        const guard = await guardAgainstSending(page);
        try {
            const unpicked = await pressEnterWith(page, USER_TEXT);
            expect(unpicked, 'Enter keeps the typed text in the composer').toContain(USER_TEXT);
            expect(unpicked, 'without a picked preset the composer carries no preset content (precondition)').not.toContain(PRESET.content);

            await pickPreset(page, PRESET);
            await expect(async () => {
                const value = await pressEnterWith(page, USER_TEXT);
                expect(value, 'the composer carries the picked preset content at send time').toContain(PRESET.content);
                expect(value, 'the typed text is kept beside the preset content').toContain(USER_TEXT);
            }).toPass({ timeout: 15_000 });

            await pickPresetOption(page, (options) => options.filter({ hasNotText: PRESET.name }));
            await expect(overlay, 'the overlay no longer shows the preset').not.toContainText(PRESET.name);
            await expect(async () => {
                const value = await pressEnterWith(page, USER_TEXT);
                expect(value, 'after picking the empty option the composer carries no preset content').not.toContain(PRESET.content);
                expect(value, 'the typed text is still kept').toContain(USER_TEXT);
            }).toPass({ timeout: 15_000 });

            expect(guard.sendRequests(), 'no send request left the page').toBe(0);
        } finally {
            await composer(page).fill('');
        }
    });
});
