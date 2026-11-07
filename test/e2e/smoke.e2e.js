import { test, expect } from './fixtures.js';

test.describe('live DeepSeek with the extension loaded', () => {
    test('page stays on the chat app and shows the chat input', async ({ page }) => {
        await expect(page).toHaveURL(/^https:\/\/chat\.deepseek\.com\/(?!sign_in)/);
        await expect(page.getByRole('textbox').first()).toBeVisible();
    });

    test('extension service worker is running as DS studio', async ({ serviceWorker, extensionId }) => {
        expect(extensionId).toMatch(/^[a-p]{32}$/);
        const name = await serviceWorker.evaluate(() => chrome.runtime.getManifest().name);
        expect(name).toBe('DS studio');
    });
});
