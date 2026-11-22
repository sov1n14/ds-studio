import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test as base, expect } from '@playwright/test';
import { DEEPSEEK_ORIGIN, openConversation } from './helpers/conversations.js';
import { getExtensionWorker, reloadExtension } from './helpers/extension.js';
import { installHumanPacing, pauseBetweenTests } from './helpers/human.js';
import { launchOfflineLane } from './helpers/offline-lane.js';
import { LANE_ENV, OFFLINE_LANE } from './helpers/pacing.js';
import { createSettingsSession } from './helpers/settings.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROFILE_DIR = path.join(REPO_ROOT, '.browser-profile');

// The offline lane (playwright.offline.config.js sets the variable) runs a disposable bundled Chromium that serves no DeepSeek page; the live lane drives .browser-profile.
const IS_OFFLINE_LANE = process.env[LANE_ENV] === OFFLINE_LANE;
export const ESCAPED_REQUESTS_ANNOTATION = 'offline-escaped-requests';

/** 讀取磁碟上 `manifest.json` 的版本號，作為執行中擴充功能應有的版本。 */
export function readDiskManifestVersion() {
    return JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8')).version;
}

export const test = base.extend({
    // Human-like pause before each test (D-105; the first test of the worker starts at once). Auto with no dependencies, so it runs before `settings` and `page`; its own timeout is off, and the pause extends the test budget.
    humanPacing: [async ({}, use) => {
        await pauseBetweenTests();
        await use();
    }, { auto: true, timeout: 0 }],

    // The offline lane of this worker (browser, request guard); null in the live lane.
    offlineLane: [async ({}, use) => {
        if (!IS_OFFLINE_LANE) {
            await use(null);
            return;
        }
        const lane = await launchOfflineLane(REPO_ROOT);
        try {
            await use(lane);
        } finally {
            await lane.close();
        }
    }, { scope: 'worker' }],

    // Offline lane only: after the test and every fixture it used have been torn down, no request may have escaped the context. The count goes to the report as an annotation.
    escapedRequestGuard: [async ({ offlineLane }, use, testInfo) => {
        await use();
        if (!offlineLane) return;
        const escaped = offlineLane.guard.takeEscaped();
        testInfo.annotations.push({ type: ESCAPED_REQUESTS_ANNOTATION, description: String(escaped.length) });
        if (escaped.length > 0) {
            throw new Error(`${escaped.length} request(s) escaped the offline lane (aborted by the guard, nothing reached the network): ${escaped.join(', ')}`);
        }
    }, { auto: true }],

    // One Chrome (with the unpacked extension) shared by the whole worker: the logged-in .browser-profile in the live lane, the disposable offline browser in the offline lane.
    profileContext: [async ({ offlineLane }, use) => {
        if (offlineLane) {
            // The offline copy is built from disk just before launch, so there is no cached worker to reload; the version check still guards the copy.
            const worker = await getExtensionWorker(offlineLane.context);
            const runningVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
            if (runningVersion !== readDiskManifestVersion()) {
                throw new Error(`Extension version mismatch in the offline lane: service worker reports ${runningVersion}, manifest.json on disk is ${readDiskManifestVersion()}.`);
            }
            await installHumanPacing(offlineLane.context);
            await use(offlineLane.context);
            return;
        }
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
            // Every Page and Locator action of this worker now pauses like a person first (D-105).
            await installHumanPacing(context);
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
        if (IS_OFFLINE_LANE) {
            throw new Error('The offline lane serves no DeepSeek page: a test that needs the `page` fixture belongs to a later stage and carries no @offline tag.');
        }
        const page = await context.newPage();
        await page.goto(`${DEEPSEEK_ORIGIN}/`);
        await use(page);
        await page.close();
    },
});

export { expect };
