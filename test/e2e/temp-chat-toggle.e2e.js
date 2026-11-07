import { test, expect } from './fixtures.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { TEMP_CHAT_ROW_SELECTOR } from './helpers/extension-ui.js';

// The home-page temporary-chat row (switch plus the label 臨時對話) follows the master switch live: removed when it turns off, injected again when it turns on (docs/FEATURES.md, 臨時對話, 與主開關的關係).
// Only presence and visibility are asserted; the row's own on/off value is never touched.

const ROW_LABEL = '臨時對話';

test.describe('temporary-chat row', () => {
    test('the row is shown on the home page while the master switch is on, removed when it turns off, and shown again when it turns back on', async ({ page, settings }) => {
        await settings.set({ isEnabled: true });
        await page.goto(DEEPSEEK_ORIGIN + '/');
        const row = page.locator(TEMP_CHAT_ROW_SELECTOR);
        expect(new URL(page.url()).pathname, 'the page is the home page, where the row lives (precondition)').toBe('/');

        await expect(row, 'with the master switch on the row is visible on the home page').toBeVisible();
        await expect(row, 'the row carries its temporary-chat label').toContainText(ROW_LABEL);
        await expect(row.getByRole('checkbox', { name: ROW_LABEL }), 'the row holds the temporary-chat switch').toHaveCount(1);

        await settings.set({ isEnabled: false });
        await expect(row, 'turning the master switch off removes the row').toHaveCount(0);
        await expect(page.getByText(ROW_LABEL, { exact: true }), 'no temporary-chat label is left on the page').toHaveCount(0);

        await settings.set({ isEnabled: true });
        await expect(row, 'turning the master switch back on shows the row again').toBeVisible();
        await expect(row, 'the re-injected row carries its label').toContainText(ROW_LABEL);
    });
});
