import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test as base, expect } from '@playwright/test';
import { DEEPSEEK_ORIGIN, openConversation } from './helpers/conversations.js';
import { getExtensionWorker, reloadExtension } from './helpers/extension.js';
import { installHarReplay } from './helpers/har-replay.js';
import { installHumanPacing, pauseBetweenTests } from './helpers/human.js';
import { launchOfflineLane } from './helpers/offline-lane.js';
import { LANE_ENV, OFFLINE_LANE } from '../helpers/pacing.js';
import { REPLAY_MISSES_ANNOTATION, summarizeMisses } from './helpers/replay-misses.js';
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

/** A fixture body: `await open(role)` resolves the conversation `pick(deepseekReplay, role)` names, opens it in `page`, waits for its messages and resolves its summary. */
function opensConversationOf(pick) {
    return async ({ page, deepseekReplay }, use) => {
        await use(async (role) => {
            const conversation = pick(deepseekReplay, role);
            await openConversation(page, conversation.id);
            return conversation;
        });
    };
}

export const test = base.extend({
    // Offline lane only: false opens the lane's browser as a visible window (set per project or file with `test.use`); worker option, so it applies before the browser launches.
    offlineHeadless: [true, { scope: 'worker', option: true }],

    // Offline lane only: the delay of a real server added to the replayed history and session-create answers, in milliseconds; 0 answers at once. Opt in with `test.use({ replayLatency: { history: 400 } })`.
    // Observed: with an instant history answer the overlay of the extension shows before the binding of the opened conversation is resolved; an instant create answer arrives before the page-world hook of the extension is installed.
    replayLatency: [{ history: 0, create: 0 }, { option: true }],

    // Human-like pause before each test (D-105; the first test of the worker starts at once). Auto with no dependencies, so it runs before `settings` and `page`; its own timeout is off, and the pause extends the test budget.
    humanPacing: [async ({}, use) => {
        await pauseBetweenTests();
        await use();
    }, { auto: true, timeout: 0 }],

    // The offline lane of this worker (browser, request guard); null in the live lane.
    offlineLane: [async ({ offlineHeadless }, use) => {
        if (!IS_OFFLINE_LANE) {
            await use(null);
            return;
        }
        const lane = await launchOfflineLane(REPO_ROOT, { headless: offlineHeadless });
        try {
            await use(lane);
        } finally {
            await lane.close();
        }
    }, { scope: 'worker' }],

    // Offline lane only: the recorded DeepSeek session replayed in the lane's browser (helpers/har-replay.js), installed when the first test asks for it; null in the live lane.
    // It throws, naming tools/recordings/, when the repository holds no recording.
    deepseekReplay: [async ({ offlineLane }, use) => {
        if (!offlineLane) {
            await use(null);
            return;
        }
        await use(await installHarReplay(offlineLane.context, { repoRoot: REPO_ROOT, workDir: offlineLane.workDir, misses: offlineLane.replayMisses }));
    }, { scope: 'worker' }],

    // Offline lane only: applies `replayLatency` to the replay for the length of the test and clears it after, so the next test starts without delay.
    replayLatencyScope: async ({ deepseekReplay, replayLatency }, use) => {
        deepseekReplay?.setLatency({ historyMs: replayLatency.history, createMs: replayLatency.create });
        try {
            await use();
        } finally {
            deepseekReplay?.setLatency({});
        }
    },

    // Offline lane only: after the test and every fixture it used have been torn down, no request may have escaped the context. The count goes to the report as an annotation.
    // The requests the HAR replay aborted because the recording holds no answer (never sent to the network) go to the report as a second annotation and fail nothing.
    escapedRequestGuard: [async ({ offlineLane }, use, testInfo) => {
        await use();
        if (!offlineLane) return;
        testInfo.annotations.push({ type: REPLAY_MISSES_ANNOTATION, description: JSON.stringify(summarizeMisses(offlineLane.replayMisses.take())) });
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

    // `await openRecorded(role)` opens the main-recording conversation filling `role` (a key of `deepseekReplay.picks`), waits for its messages and resolves its summary.
    openRecorded: opensConversationOf((replay, role) => replay.requireConversation(role)),

    // `await openPurpose(role)` does the same for a purpose-recording conversation (`longThread`, `withCodeBlocks`).
    openPurpose: opensConversationOf((replay, role) => replay.requirePurposeConversation(role)),

    // `await openConversation(uuid)` loads a kept conversation in `page` and waits for its messages.
    openConversation: async ({ page }, use) => {
        await use((uuid) => openConversation(page, uuid));
    },

    // Depends on `settings` so Playwright closes the page before `settings` restores storage: its content script can no longer rewrite restored keys.
    // In the offline lane the page is served from the recording (`deepseekReplay`); the live lane loads the real site.
    page: async ({ context, settings, deepseekReplay, replayLatencyScope }, use) => {
        const page = await context.newPage();
        await page.goto(`${DEEPSEEK_ORIGIN}/`);
        await use(page);
        await page.close();
    },
});

export { expect };
