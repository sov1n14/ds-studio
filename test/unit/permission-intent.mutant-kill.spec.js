/**
 * Permission intent (v4.39.3) — targeted tests for behaviors that test/unit/permission-intent.scenario.spec.js leaves unpinned (surviving Stryker mutants in utils/storage-manager.keys.js, background/permission-intent-routes.js and popup/popup.toggles.js).
 *
 * Requirements asserted (docs/architecture/STORAGE.md row `dsPermissionIntent_<name>`, docs/ARCHITECTURE.md "Permission Intent Route", docs/architecture/POPUP.md):
 *   A. Each of the three intents autoCopyReply, autoCopyCode and replyNotification lives in its own chrome.storage.local key, named exactly `dsPermissionIntent_<name>`; the three keys are distinct, nothing reaches chrome.storage.sync, clearing one removes exactly that key, and the pending-intents read returns the names whose key is set.
 *   B. A failure while the service worker completes intents on chrome.permissions.onAdded is logged as console.error("[DSS] permission-intent-routes onAdded:", err), escapes nowhere, and keeps the intent pending.
 *   C. A failure of the open-time cleanup of refused intents in the popup is logged as console.error("[DSS] popup.toggles clearRefusedPermissionIntents:", err), escapes nowhere, and the toggles stay bound.
 *
 * A evaluates utils/storage-manager.keys.js and utils/storage-manager.local.js afresh inside each test body: their literals are fixed when the file loads, and the copy test/setup/vitest.setup.js preloads before any test would never observe a change to them.
 *
 * Mocked: only chrome.permissions (test/helpers/permission-intent-harness.js) and the suite in-memory chrome.storage. One exception in C: the real StorageManager swallows every chrome.storage failure on the read and remove paths of the cleanup, and the real permission wrappers swallow chrome.permissions failures, so no chrome.* failure can reach the catch of the cleanup; C therefore hands the toggle manager (through its ctx.StorageManager parameter) a StorageManager whose getPendingPermissionIntents() rejects, every other method being the real one.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
    StorageManager, CLIPBOARD, targetOf, createPermissionWorld, loadPopupModules, loadPermissionIntentRoutes, openPopup, settle,
} from '../helpers/permission-intent-harness.js';
import { readProjectFile } from '../helpers/popup-script-loader.js';
import { captureUncaught } from '../helpers/reply-notification-harness.js';

const NAMES = ['autoCopyReply', 'autoCopyCode', 'replyNotification'];
const KEY_OF = {
    autoCopyReply: 'dsPermissionIntent_autoCopyReply',
    autoCopyCode: 'dsPermissionIntent_autoCopyCode',
    replyNotification: 'dsPermissionIntent_replyNotification',
};
const ROUTES_PREFIX = '[DSS] permission-intent-routes onAdded:';
const CLEANUP_PREFIX = '[DSS] popup.toggles clearRefusedPermissionIntents:';
const readArea = (area) => chrome.storage[area].get(null);
const sorted = (list) => [...list].sort();

/** Evaluates one storage-manager part file on a fresh global and returns the bundle it publishes there. */
function evalFreshPart(relPath, globalName) {
    const root = {};
    new Function('globalThis', 'module', readProjectFile(relPath))(root, undefined);
    const bundle = root[globalName];
    if (typeof bundle !== 'object' || bundle === null) throw new Error(relPath + ' did not publish globalThis.' + globalName);
    return bundle;
}

/** A StorageManager whose constants and permission-intent methods come from freshly evaluated keys.js and local.js; the storage primitives are the loaded ones. */
function freshIntentStore() {
    const keys = evalFreshPart('utils/storage-manager.keys.js', '__DS_StorageManager_keys');
    const local = evalFreshPart('utils/storage-manager.local.js', '__DS_StorageManager_local');
    return Object.assign(Object.create(StorageManager), keys, local);
}

const errorsWithPrefix = (spy, prefix) => spy.mock.calls.filter(([first]) => first === prefix);
const firstArgs = (spy) => JSON.stringify(spy.mock.calls.map(([first]) => first));

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
    chrome.storage.local.setQuotaError(false);
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
});

describe('A - one chrome.storage.local key per intent, named dsPermissionIntent_<name> (freshly evaluated keys.js + local.js)', () => {
    it.each(NAMES)('%s: recording it writes only its own key, true, to local and nothing to sync; the pending read returns exactly it', async (name) => {
        const store = freshIntentStore();
        await store.savePermissionIntent(name);
        expect(await readArea('local'), 'chrome.storage.local after savePermissionIntent(' + name + ')').toEqual({ [KEY_OF[name]]: true });
        expect(await readArea('sync'), 'chrome.storage.sync after savePermissionIntent(' + name + ')').toEqual({});
        expect(await store.getPendingPermissionIntents()).toEqual([name]);
    });

    it('recording all three yields three distinct keys and the pending read returns all three names', async () => {
        const store = freshIntentStore();
        for (const name of NAMES) await store.savePermissionIntent(name);
        expect(await readArea('local')).toEqual({
            dsPermissionIntent_autoCopyReply: true,
            dsPermissionIntent_autoCopyCode: true,
            dsPermissionIntent_replyNotification: true,
        });
        expect(sorted(await store.getPendingPermissionIntents())).toEqual(sorted(NAMES));
    });

    it.each(NAMES)('%s: clearing it removes exactly its key; the other two stay recorded and pending', async (name) => {
        const store = freshIntentStore();
        for (const other of NAMES) await store.savePermissionIntent(other);
        await store.clearPermissionIntent(name);
        const others = NAMES.filter((other) => other !== name);
        expect(await readArea('local')).toEqual(Object.fromEntries(others.map((other) => [KEY_OF[other], true])));
        expect(sorted(await store.getPendingPermissionIntents())).toEqual(sorted(others));
    });

    it.each(NAMES)('%s: the pending read reports an intent stored under the literal key dsPermissionIntent_<name>', async (name) => {
        await chrome.storage.local.set({ [KEY_OF[name]]: true });
        expect(await freshIntentStore().getPendingPermissionIntents()).toEqual([name]);
    });
});

describe('B - the service worker logs a failed onAdded completion', () => {
    it('storage rejects while autoCopyReply is turned on: console.error gets the routes prefix and the error, nothing escapes, the intent stays pending', async () => {
        await StorageManager.savePermissionIntent('autoCopyReply');
        chrome.storage.local.setQuotaError(true);
        const uncaught = await captureUncaught(() => settle(() => world.grant(CLIPBOARD)));
        chrome.storage.local.setQuotaError(false);

        const routeErrors = errorsWithPrefix(consoleErrorSpy, ROUTES_PREFIX);
        expect(routeErrors, 'console.error calls with the routes prefix; first arguments of all calls: ' + firstArgs(consoleErrorSpy)).toHaveLength(1);
        expect(routeErrors[0][1], 'the logged error is the storage failure').toEqual(expect.objectContaining({ message: 'QUOTA_BYTES_PER_ITEM quota exceeded' }));
        expect(uncaught, 'unhandled rejections or uncaught errors').toEqual([]);
        expect(await StorageManager.getPendingPermissionIntents(), 'a failed completion keeps the intent for the next grant').toEqual(['autoCopyReply']);
    });
});

describe('C - the popup logs a failed open-time cleanup and stays usable', () => {
    it('getPendingPermissionIntents() rejects at popup opening: console.error gets the toggles prefix and that error, nothing escapes, #autoCopyReplyToggle still prompts', async () => {
        const failure = new Error('storage read failed');
        const failingStore = Object.create(StorageManager);
        failingStore.getPendingPermissionIntents = () => Promise.reject(failure);
        let dom;
        const uncaught = await captureUncaught(() => settle(() => { dom = openPopup({ storageManager: failingStore }); }));

        const cleanupErrors = errorsWithPrefix(consoleErrorSpy, CLEANUP_PREFIX);
        expect(cleanupErrors, 'console.error calls with the cleanup prefix; first arguments of all calls: ' + firstArgs(consoleErrorSpy)).toHaveLength(1);
        expect(cleanupErrors[0][1], 'the logged error is the rejection reason').toBe(failure);
        expect(uncaught, 'unhandled rejections or uncaught errors').toEqual([]);

        await targetOf('autoCopyReply').turnOn(dom);
        expect(world.api.request, 'the toggle bound after the failed cleanup still asks for the clipboard permissions').toHaveBeenCalledTimes(1);
        expect(sorted(world.api.request.mock.calls[0][0].permissions)).toEqual(sorted(CLIPBOARD));
    });
});
