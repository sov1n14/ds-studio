// The offline E2E lane: a disposable bundled Chromium with the extension loaded and no way to reach a real network host (stage 1 of moving E2E off the live site).
// Per worker: a temp user-data-dir, a copy of the extension whose optional permissions are granted (offline-manifest.js), a resolver rule that fails every DNS lookup, and the catch-all request guard (request-guard.js).

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { grantOptionalPermissions } from './offline-manifest.js';
import { createReplayMissLog } from './replay-misses.js';
import { createRequestGuard } from './request-guard.js';

// Directories and files the packed extension contains (pack-for-chrome.ps1 `$includeDirs`); the copy holds the same set.
const EXTENSION_DIRS = ['_locales', 'assets', 'background', 'content', 'offscreen', 'popup', 'utils'];

/** Copies the extension of `repoRoot` into `destination`, with the optional permissions of its manifest granted. */
export function buildOfflineExtension(repoRoot, destination) {
    for (const dir of EXTENSION_DIRS) {
        cpSync(path.join(repoRoot, dir), path.join(destination, dir), { recursive: true });
    }
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
    writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(grantOptionalPermissions(manifest), null, 2));
}

/**
 * Launches the offline lane for one Playwright worker and resolves `{ context, guard, replayMisses, extensionDir, workDir, close }`.
 * `channel: 'chromium'` selects the bundled Chromium in its new headless mode: branded Chrome ignores `--load-extension`.
 * `--host-resolver-rules` makes every host fail DNS, so a request that bypasses the route guard (an extension service worker fetch) still cannot connect.
 * Playwright's default `serviceWorkers: 'allow'` stays: blocking them would break the extension service worker.
 * `replayMisses` collects the requests an installed HAR replay (har-replay.js) aborts, and `workDir` is the temp directory it may write to.
 * `close()` closes the browser and removes both temp directories.
 */
export async function launchOfflineLane(repoRoot) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dss-e2e-offline-'));
    const extensionDir = path.join(root, 'extension');
    const userDataDir = path.join(root, 'profile');
    mkdirSync(extensionDir);
    let context;
    try {
        buildOfflineExtension(repoRoot, extensionDir);
        context = await chromium.launchPersistentContext(userDataDir, {
            channel: 'chromium',
            headless: true,
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
                `--disable-extensions-except=${extensionDir}`,
                `--load-extension=${extensionDir}`,
                '--host-resolver-rules=MAP * ~NOTFOUND',
            ],
        });
        const guard = createRequestGuard();
        // Registered before every other route, so it runs last: it sees what no test-installed route handled.
        await context.route(/.*/, guard.handle);
        return {
            context,
            guard,
            replayMisses: createReplayMissLog(),
            extensionDir,
            workDir: root,
            async close() {
                await context.close();
                rmSync(root, { recursive: true, force: true });
            },
        };
    } catch (error) {
        await context?.close();
        rmSync(root, { recursive: true, force: true });
        throw error;
    }
}
