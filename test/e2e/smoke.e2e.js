import { test, expect, readDiskManifestVersion } from './fixtures.js';

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

    test('running service worker reports the manifest.json version on disk', async ({ serviceWorker }) => {
        // 防止持久設定檔執行快取的舊版擴充功能：執行中的版本必須等於 repo 內 manifest.json 的版本。
        const runningVersion = await serviceWorker.evaluate(() => chrome.runtime.getManifest().version);
        expect(runningVersion, 'service worker version must equal manifest.json on disk').toBe(readDiskManifestVersion());
    });
});
