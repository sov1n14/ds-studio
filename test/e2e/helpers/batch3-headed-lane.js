// A headed variant of the offline lane for a spec whose behavior depends on real window focus: headless Chromium reports every window as focused, so a focus change is invisible to `chrome.windows`.
// launchOfflineLane (offline-lane.js) fixes `headless: true`, so this wrapper forces `headless: false` for the one launch it makes and leaves everything else of the lane as it is (extension copy, resolver rule, request guard).

import { chromium } from '@playwright/test';
import { launchOfflineLane } from './offline-lane.js';

/** Launches the offline lane of `repoRoot` in a visible browser window; resolves the same lane object as `launchOfflineLane`. */
export async function launchHeadedOfflineLane(repoRoot) {
    const launchPersistentContext = chromium.launchPersistentContext;
    chromium.launchPersistentContext = (userDataDir, options) => launchPersistentContext.call(chromium, userDataDir, { ...options, headless: false });
    try {
        return await launchOfflineLane(repoRoot);
    } finally {
        chromium.launchPersistentContext = launchPersistentContext;
    }
}
