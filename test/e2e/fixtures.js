import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test as base, expect } from '@playwright/test';
import { DEEPSEEK_ORIGIN, openConversation } from './helpers/conversations.js';
import { getExtensionWorker, reloadExtension } from './helpers/extension.js';
import { createSettingsSession } from './helpers/settings.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROFILE_DIR = path.join(REPO_ROOT, '.browser-profile');

/** 讀取磁碟上 `manifest.json` 的版本號，作為執行中擴充功能應有的版本。 */
export function readDiskManifestVersion() {
    return JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')).version;
}

export const test = base.extend({
    // One logged-in Chrome (with the unpacked extension) shared by the whole worker.
    profileContext: [async ({}, use) => {
        if (!existsSync(PROFILE_DIR)) {
            throw new Error(`E2E profile missing: ${PROFILE_DIR}. Launch Chrome with this --user-data-dir, log in to DeepSeek, load the extension, then rerun.`);
        }
        const context = await chromium.launchPersistentContext(PROFILE_DIR, {
            channel: 'chrome',
            headless: false,
            ignoreDefaultArgs: ['--disable-extensions'],
        });
        try {
            // 持久設定檔可能沿用快取的舊版 service worker；在開啟任何 DeepSeek 分頁前重新載入一次，並確認執行中的版本與磁碟一致。
            const worker = await reloadExtension(context);
            const runningVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
            const diskVersion = readDiskManifestVersion();
            if (runningVersion !== diskVersion) {
                throw new Error(`Extension version mismatch: service worker reports ${runningVersion}, manifest.json on disk is ${diskVersion}. Reload the unpacked extension from this repo in .browser-profile, then rerun.`);
            }
        } catch (error) {
            await context.close();
            throw error;
        }
        await use(context);
        await context.close();
    }, { scope: 'worker' }],

    // Built-in `context` is test-scoped; route it to the shared profile context.
    context: async ({ profileContext }, use) => {
        await use(profileContext);
    },

    // The extension worker, never a DeepSeek page worker; re-resolved per test because idle MV3 workers stop.
    serviceWorker: async ({ profileContext }, use) => {
        await use(await getExtensionWorker(profileContext));
    },

    extensionId: async ({ serviceWorker }, use) => {
        await use(new URL(serviceWorker.url()).host);
    },

    // Settings session: `await settings.set({...})` writes chrome.storage.local; every touched key is restored after the test.
    settings: async ({ profileContext }, use) => {
        const session = createSettingsSession(profileContext);
        try {
            await use(session);
        } finally {
            await session.restore();
        }
    },

    // `await openConversation(uuid)` loads a kept conversation in `page` and waits for its messages.
    openConversation: async ({ page }, use) => {
        await use((uuid) => openConversation(page, uuid));
    },

    // Depends on `settings` so Playwright closes the page before `settings` restores storage: its content script can no longer rewrite restored keys.
    page: async ({ context, settings }, use) => {
        const page = await context.newPage();
        await page.goto(`${DEEPSEEK_ORIGIN}/`);
        await use(page);
        await page.close();
    },
});

export { expect };
