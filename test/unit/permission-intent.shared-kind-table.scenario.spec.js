/**
 * Permission intent - the popup's open-time cleanup and the service worker's onAdded completion give the same answer for each intent (scenario: popup/popup.toggles.js and background/permission-intent-routes.js both look up an intent's permission kind through StorageManager.PERMISSION_INTENT_PERMISSIONS and check it through the permission wrappers).
 *
 * Contract: for each mix of granted optional permissions, the popup keeps exactly the pending intents whose permission is granted (it clears the rest as refused), and the service worker turns on exactly the settings of those same intents. Clipboard intents (autoCopyReply, autoCopyCode) follow the clipboard permissions (clipboardWrite + offscreen); replyNotification follows the notifications permission. A mixed grant (only one kind held) catches either side checking the wrong wrapper for a kind.
 *
 * Regression guard for the shared kind table refactor: both sides gave these answers before the refactor, so this spec is expected to pass on pre-refactor code.
 *
 * Scenario rules (CLAUDE.md "Scenario Unit Tests", cross-module mutable state): the real popup toggle manager, the real permission wrappers, the real StorageManager and the real routes module share the suite in-memory chrome.storage; only chrome.permissions is faked (test/helpers/permission-intent-harness.js). Assertions read StorageManager.getSettings() and StorageManager.getPendingPermissionIntents(), never a spy.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
    StorageManager, TARGETS, CLIPBOARD, NOTIFICATIONS,
    createPermissionWorld, loadPopupModules, loadPermissionIntentRoutes, reopenPopup, settle, readGatedSettings,
} from '../helpers/permission-intent-harness.js';

const INTENT_NAMES = TARGETS.map(({ field }) => field);
const sorted = (list) => [...list].sort();

const world = createPermissionWorld();
const saved = {};
let consoleErrorSpy;

beforeAll(() => {
    saved.hadPermissions = 'permissions' in chrome;
    saved.permissions = chrome.permissions;
    saved.StorageManager = globalThis.StorageManager;
    chrome.permissions = world.api;
    globalThis.StorageManager = StorageManager;
    loadPopupModules();
    loadPermissionIntentRoutes().install();
});

afterAll(() => {
    if (saved.hadPermissions) chrome.permissions = saved.permissions;
    else delete chrome.permissions;
    globalThis.StorageManager = saved.StorageManager;
});

beforeEach(() => {
    world.reset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
});

async function seedAllIntents() {
    for (const intentName of INTENT_NAMES) await StorageManager.savePermissionIntent(intentName);
    expect(sorted(await StorageManager.getPendingPermissionIntents()), 'precondition: every intent is pending').toEqual(sorted(INTENT_NAMES));
}

describe('the popup and the service worker agree on which intents have their permission', () => {
    it.each([
        ['clipboard only', CLIPBOARD, ['autoCopyReply', 'autoCopyCode']],
        ['notifications only', NOTIFICATIONS, ['replyNotification']],
        ['clipboard and notifications', [...CLIPBOARD, ...NOTIFICATIONS], ['autoCopyReply', 'autoCopyCode', 'replyNotification']],
    ])('%s granted: the service worker turns on, and the reopened popup keeps pending, exactly the intents of that permission', async (_label, grantedPermissions, expectedIntents) => {
        await seedAllIntents();
        await settle(() => world.grant(grantedPermissions));
        const settings = await readGatedSettings();
        const turnedOnByWorker = INTENT_NAMES.filter((name) => settings[name] === true);

        await seedAllIntents();
        await reopenPopup();
        const keptByPopup = await StorageManager.getPendingPermissionIntents();

        expect(sorted(turnedOnByWorker), 'settings the service worker turned on after the grant').toEqual(sorted(expectedIntents));
        expect(sorted(keptByPopup), 'intents the reopened popup kept pending').toEqual(sorted(expectedIntents));
        expect(sorted(keptByPopup), 'popup and service worker give the same answer per intent').toEqual(sorted(turnedOnByWorker));
        expect(consoleErrorSpy, 'no [DSS] error was logged on either side').not.toHaveBeenCalled();
    });
});
