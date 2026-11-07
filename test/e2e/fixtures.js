import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test as base, expect } from '@playwright/test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROFILE_DIR = path.join(REPO_ROOT, '.browser-profile');
const DEEPSEEK_URL = 'https://chat.deepseek.com/';

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
        await use(context);
        await context.close();
    }, { scope: 'worker' }],

    // Built-in `context` is test-scoped; route it to the shared profile context.
    context: async ({ profileContext }, use) => {
        await use(profileContext);
    },

    serviceWorker: [async ({ profileContext }, use) => {
        const worker = profileContext.serviceWorkers()[0] ?? await profileContext.waitForEvent('serviceworker');
        await use(worker);
    }, { scope: 'worker' }],

    extensionId: [async ({ serviceWorker }, use) => {
        await use(new URL(serviceWorker.url()).host);
    }, { scope: 'worker' }],

    page: async ({ context }, use) => {
        const page = await context.newPage();
        await page.goto(DEEPSEEK_URL);
        await use(page);
        await page.close();
    },
});

export { expect };
