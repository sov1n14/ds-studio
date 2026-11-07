import { test, expect } from './fixtures.js';
import { composer, guardAgainstSending, pressEnterWith } from './helpers/composer.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { PRESET_OVERLAY_SELECTOR } from './helpers/extension-ui.js';

// The in-page preset overlay picks the prompt group for the current tab. Picking does not write the composer: the extension prepends the picked group's content when the message is sent (docs/FEATURES.md, 使用提示詞注入 step 2, and 頁面內快速切換 Overlay).
// The observable effect without sending: press Enter with the send guard on, then read the composer, which the extension has rewritten for sending; DeepSeek never receives the Enter and the send endpoints are aborted.

const STAMP = Date.now();
const PRESET = Object.freeze({
    id: `preset-e2e-${STAMP}`,
    name: `E2E preset ${STAMP}`,
    content: `E2E-PRESET-MARKER-${STAMP}`,
    createdAt: STAMP,
    updatedAt: STAMP,
    globalPromptEnabled: false,
});
const USER_TEXT = 'e2e preset overlay probe (never sent)';
// Keys the extension writes while a preset is picked, restored by the settings fixture.
const KEYS_WRITTEN_BY_PICKING = ['activePresetId', 'pinnedPresetId', 'dsPresetTombstones', 'dsLocalAuth', 'chatPresetMapMeta', 'syncConflictPending'];

async function pickOption(page, overlay, option) {
    const trigger = overlay.getByRole('button');
    await trigger.click();
    const menu = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
    await expect(menu, 'the preset list opens').toBeVisible();
    await option(menu.getByRole('option')).click();
}

test.describe('preset overlay', () => {
    test('picking a preset makes the composer carry its content at send time; picking the empty option drops it', async ({ page, settings }) => {
        await settings.track(KEYS_WRITTEN_BY_PICKING);
        await settings.setInBothAreas({
            dsPresetIndex: [PRESET.id],
            dsPresetOrderMeta: { order: [PRESET.id], orderUpdatedAt: STAMP },
            [`dsPreset_${PRESET.id}`]: PRESET,
            activePresetId: '',
            pinnedPresetId: '',
        });
        await settings.set({ isEnabled: true });
        await page.goto(`${DEEPSEEK_ORIGIN}/`);

        const overlay = page.locator(PRESET_OVERLAY_SELECTOR);
        await expect(overlay, 'the preset overlay is shown in the chat header').toBeVisible();
        await expect(overlay, 'no preset is picked yet (precondition)').not.toContainText(PRESET.name);
        const guard = await guardAgainstSending(page);
        try {
            const unpicked = await pressEnterWith(page, USER_TEXT);
            expect(unpicked, 'Enter keeps the typed text in the composer').toContain(USER_TEXT);
            expect(unpicked, 'without a picked preset the composer carries no preset content (precondition)').not.toContain(PRESET.content);

            await pickOption(page, overlay, (options) => options.filter({ hasText: PRESET.name }));
            await expect(overlay, 'the overlay shows the picked preset').toContainText(PRESET.name);
            await expect(async () => {
                const value = await pressEnterWith(page, USER_TEXT);
                expect(value, 'the composer carries the picked preset content at send time').toContain(PRESET.content);
                expect(value, 'the typed text is kept beside the preset content').toContain(USER_TEXT);
            }).toPass({ timeout: 15_000 });

            await pickOption(page, overlay, (options) => options.filter({ hasNotText: PRESET.name }));
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
