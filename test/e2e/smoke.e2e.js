import { test, expect, readDiskManifestVersion } from './fixtures.js';

test.describe('extension loaded', () => {
    test('extension service worker is running as DS studio', { tag: '@offline' }, async ({ serviceWorker, extensionId }) => {
        expect(extensionId).toMatch(/^[a-p]{32}$/);
        const name = await serviceWorker.evaluate(() => chrome.runtime.getManifest().name);
        expect(name).toBe('DS studio');
    });

    test('running service worker reports the manifest.json version on disk', { tag: '@offline' }, async ({ serviceWorker }) => {
        // 防止持久設定檔執行快取的舊版擴充功能：執行中的版本必須等於 repo 內 manifest.json 的版本。
        const runningVersion = await serviceWorker.evaluate(() => chrome.runtime.getManifest().version);
        expect(runningVersion, 'service worker version must equal manifest.json on disk').toBe(readDiskManifestVersion());
    });
});
