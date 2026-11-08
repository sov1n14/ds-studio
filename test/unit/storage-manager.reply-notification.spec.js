/**
 * Reply-complete notification toggle: a device-local boolean setting.
 *
 * Requirement (DECISIONS U6-10): the storage key is `isReplyNotificationEnabled`, default false; it lives in chrome.storage.local only, is read back through getSettings().replyNotification, written through saveReplyNotification(), and never reaches chrome.storage.sync — sync contents are ignored on read.
 *
 * Arrange steps use the literal storage key so they stay honest while KEYS.REPLY_NOTIFICATION does not exist yet (red phase).
 *
 * The schema cases evaluate utils/storage-manager.keys.js and utils/storage-manager.settings-read.js afresh inside the test body: their KEYS / DEFAULTS / settings-whitelist literals are fixed when the file loads, and the copy vitest.setup.js preloads before any test would never see a change to them.
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { readProjectFile } from '../helpers/popup-script-loader.js';

const KEY = 'isReplyNotificationEnabled';
const readLocal = async () => (await chrome.storage.local.get(null))[KEY];
const readSync = async () => chrome.storage.sync.get(null);

/** Evaluates one storage-manager part file on a fresh global and returns the bundle it publishes there. */
function evalFreshPart(relPath, globalName) {
    const root = {};
    new Function('globalThis', 'module', readProjectFile(relPath))(root, undefined);
    const bundle = root[globalName];
    if (typeof bundle !== 'object' || bundle === null) throw new Error(relPath + ' did not publish globalThis.' + globalName);
    return bundle;
}

/** A StorageManager whose KEYS / DEFAULTS and getSettings() come from freshly evaluated part files; every other method is the loaded one. */
function freshSettingsReader() {
    const keys = evalFreshPart('utils/storage-manager.keys.js', '__DS_StorageManager_keys');
    const read = evalFreshPart('utils/storage-manager.settings-read.js', '__DS_StorageManager_settingsRead');
    return Object.assign(Object.create(StorageManager), keys, { getSettings: read.getSettings });
}

describe('StorageManager — reply notification (device-local)', () => {
    describe('schema', () => {
        it('KEYS.REPLY_NOTIFICATION is the storage key isReplyNotificationEnabled (freshly evaluated keys.js)', () => {
            expect(evalFreshPart('utils/storage-manager.keys.js', '__DS_StorageManager_keys').KEYS.REPLY_NOTIFICATION).toBe(KEY);
        });

        it('DEFAULTS.isReplyNotificationEnabled is false (freshly evaluated keys.js)', () => {
            expect(evalFreshPart('utils/storage-manager.keys.js', '__DS_StorageManager_keys').DEFAULTS).toHaveProperty(KEY, false);
        });

        it.each([
            { local: true, expected: true },
            { local: false, expected: false },
            { local: undefined, expected: false },
        ])('freshly evaluated keys.js + settings-read.js: local $local -> getSettings().replyNotification $expected', async ({ local, expected }) => {
            if (local !== undefined) await chrome.storage.local.set({ [KEY]: local });
            expect((await freshSettingsReader().getSettings()).replyNotification).toBe(expected);
        });
    });

    describe('getSettings().replyNotification reads chrome.storage.local only', () => {
        it('returns true when local holds true', async () => {
            await chrome.storage.local.set({ [KEY]: true });
            expect((await StorageManager.getSettings()).replyNotification).toBe(true);
        });

        it('returns false when local has no value', async () => {
            expect((await StorageManager.getSettings()).replyNotification).toBe(false);
        });

        it('returns false when sync holds true while local holds false (sync is ignored)', async () => {
            await chrome.storage.sync.set({ [KEY]: true });
            await chrome.storage.local.set({ [KEY]: false });
            expect((await StorageManager.getSettings()).replyNotification).toBe(false);
        });

        it('returns false when sync holds true while local has no value (sync is ignored)', async () => {
            await chrome.storage.sync.set({ [KEY]: true });
            expect((await StorageManager.getSettings()).replyNotification).toBe(false);
        });
    });

    describe('saveReplyNotification() writes chrome.storage.local only', () => {
        it('saveReplyNotification(true) stores true in local and nothing in sync', async () => {
            await StorageManager.saveReplyNotification(true);
            expect(await readLocal()).toBe(true);
            expect(await readSync()).not.toHaveProperty(KEY);
        });

        it('saveReplyNotification(false) stores false in local over a previous true and nothing in sync', async () => {
            await chrome.storage.local.set({ [KEY]: true });
            await StorageManager.saveReplyNotification(false);
            expect(await readLocal()).toBe(false);
            expect(await readSync()).not.toHaveProperty(KEY);
        });
    });

    describe('initialize() on empty storage', () => {
        it('fills local with false and leaves sync without the key', async () => {
            await StorageManager.initialize();
            expect(await readLocal()).toBe(false);
            expect(await readSync()).not.toHaveProperty(KEY);
        });

        it('writes the defaults of synced settings to sync while every local-only key stays out of sync', async () => {
            const { KEYS, DEFAULTS } = StorageManager;
            await StorageManager.initialize();
            const sync = await readSync();
            for (const key of [KEYS.WEBSEARCH_TOGGLE, KEYS.INCLUDE_THINKING, KEYS.AUTO_RETRY, KEYS.SHOW_SYSTEM_TIME]) {
                expect(sync, 'sync holds the default of synced key ' + key).toHaveProperty(key, DEFAULTS[key]);
            }
            for (const key of [KEYS.IS_ENABLED, KEYS.GLOBAL_PROMPT_ENABLED, KEYS.REPLY_NOTIFICATION]) {
                expect(sync, 'local-only key ' + key + ' stays out of sync').not.toHaveProperty(key);
            }
        });
    });
});
