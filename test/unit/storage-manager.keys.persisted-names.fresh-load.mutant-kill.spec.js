/**
 * Persisted storage key names and the dsPresetOrderMeta default, observed through the public StorageManager API on a StorageManager whose keys bundle (utils/storage-manager.keys.js) is evaluated INSIDE each test.
 *
 * Requirement (docs/spec/05-data-storage.md storage table, mirrored in docs/architecture/STORAGE.md): existing user data lives in chrome.storage under fixed key names: `promptPresets` (v1.6.x legacy array, migrated by initialize()), `dsOversizedKeys`, `dsPresetOrderMeta` (default `{ order: [], orderUpdatedAt: 0 }`), `dsPresetTombstones`, `restored_messages`, and `dsPermissionIntent_<name>` for the intent names `autoCopyReply`, `autoCopyCode`, `replyNotification`. Data written through the API must land under that exact name, and data already stored under that name must be read back, or an upgrade silently loses the stored user data.
 *
 * Why the fresh load: the setup file preloads storage-manager.keys.js once, so its KEYS / DEFAULTS / PERMISSION_INTENTS literals execute before any test runs. test/stryker.config.json sets "ignoreStatic": true, under which Stryker runs a mutant of a load-time literal only against tests that evaluate the file inside the test. vi.resetModules() + a dynamic import re-evaluates the literals within the test body (same pattern as storage-manager.keys.defaults-runtime.spec.js).
 *
 * Only chrome.storage (the in-memory trust-boundary double from the setup file) is faked; every StorageManager bundle is the real module. Every expected key name is a literal from the docs, never read from StorageManager.KEYS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const INTENT_NAMES = ['autoCopyReply', 'autoCopyCode', 'replyNotification'];

let preloadedKeysBundle;
let preloadedWindowStorageManager;

/** Re-evaluate storage-manager.keys.js and the storage-manager.js entry inside the calling test; static specifiers keep Vite's resolver in charge (testing-pitfalls red-for-the-right-reason). */
async function loadFreshStorageManager() {
    vi.resetModules();
    const keysBundle = (await import('../../utils/storage-manager.keys.js')).default;
    const StorageManager = (await import('../../utils/storage-manager.js')).default;
    return { keysBundle, StorageManager };
}

const rawLocal = () => chrome.storage.local.get(null);
const rawSync = () => chrome.storage.sync.get(null);

beforeEach(() => {
    preloadedKeysBundle = globalThis.__DS_StorageManager_keys;
    preloadedWindowStorageManager = globalThis.window?.StorageManager;
});

afterEach(() => {
    globalThis.__DS_StorageManager_keys = preloadedKeysBundle;
    if (globalThis.window) globalThis.window.StorageManager = preloadedWindowStorageManager;
});

describe('fresh keys bundle: the load is really fresh', () => {
    it('re-evaluates the keys bundle inside the test instead of reusing the setup-time copy', async () => {
        const { keysBundle, StorageManager } = await loadFreshStorageManager();

        expect(keysBundle, 'keys bundle must be a fresh evaluation, not the setup preload').not.toBe(preloadedKeysBundle);
        expect(StorageManager.KEYS, 'fresh StorageManager must carry the fresh KEYS').toBe(keysBundle.KEYS);
    });
});

describe('legacy promptPresets migration (initialize)', () => {
    it('migrates a v1.6.x promptPresets array stored in sync into dsPresetIndex + dsPreset_<id> and removes promptPresets from both areas', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        const legacy = { id: 'legacy-1', name: 'Old group', content: 'old content', createdAt: 1000, updatedAt: 1000 };
        await chrome.storage.sync.set({ promptPresets: [legacy] });

        await StorageManager.initialize();

        const sync = await rawSync();
        const local = await rawLocal();
        expect(sync.dsPresetIndex, 'sync dsPresetIndex after migration').toEqual(['legacy-1']);
        expect(sync['dsPreset_legacy-1'], 'sync dsPreset_legacy-1 after migration').toEqual(legacy);
        expect('promptPresets' in sync, 'legacy promptPresets key left in sync').toBe(false);
        expect('promptPresets' in local, 'legacy promptPresets key left in local').toBe(false);
    });
});

describe('dsOversizedKeys', () => {
    it('hasOversizedItems() reports true for a dsOversizedKeys list already stored in local', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        await chrome.storage.local.set({ dsOversizedKeys: ['dsPreset_big'] });

        await expect(StorageManager.hasOversizedItems()).resolves.toBe(true);
    });

    it('records a preset over the 8KB sync item quota in local dsOversizedKeys', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        const big = { id: 'big', name: 'Big', content: 'x'.repeat(9000), createdAt: 1, updatedAt: 1 };

        await StorageManager.saveOnePromptPreset(big);

        const local = await rawLocal();
        expect(local.dsOversizedKeys, 'local dsOversizedKeys after an oversized write').toEqual(['dsPreset_big']);
    });
});

describe('dsPresetOrderMeta', () => {
    it('savePromptPresets() stores the new order under dsPresetOrderMeta', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        const presets = ['p1', 'p2'].map(id => ({ id, name: id, content: id, createdAt: 1, updatedAt: 1 }));

        await StorageManager.savePromptPresets(presets);

        const sync = await rawSync();
        expect(sync.dsPresetOrderMeta?.order, 'sync dsPresetOrderMeta.order').toEqual(['p1', 'p2']);
        expect(typeof sync.dsPresetOrderMeta?.orderUpdatedAt, 'sync dsPresetOrderMeta.orderUpdatedAt type').toBe('number');
    });

    it('initialize() on empty storage stores the documented default { order: [], orderUpdatedAt: 0 } under dsPresetOrderMeta', async () => {
        const { StorageManager } = await loadFreshStorageManager();

        await StorageManager.initialize();

        const sync = await rawSync();
        expect(sync.dsPresetOrderMeta, 'sync dsPresetOrderMeta after initialize on empty storage').toStrictEqual({ order: [], orderUpdatedAt: 0 });
    });
});

describe('dsPresetTombstones', () => {
    it('recordPresetTombstones() keeps the tombstone already stored under dsPresetTombstones and adds the new one there', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        const existing = { ts: Date.now() - 60000, deleted: true };
        await chrome.storage.sync.set({ dsPresetTombstones: { old: existing } });
        await chrome.storage.local.set({ dsPresetTombstones: { old: existing } });

        await StorageManager.recordPresetTombstones(['gone']);

        const stored = (await rawSync()).dsPresetTombstones || {};
        expect(Object.keys(stored).sort(), 'tombstone ids under sync dsPresetTombstones').toEqual(['gone', 'old']);
        expect(stored.old, 'pre-existing tombstone').toEqual(existing);
        expect(stored.gone.deleted, 'new tombstone deleted flag').toBe(true);
    });
});

describe('restored_messages', () => {
    it('getRestoredMessages() returns the records already stored in local restored_messages', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        const records = { 'msg-1': { message_id: 'msg-1', fragments: ['a'] } };
        await chrome.storage.local.set({ restored_messages: records });

        await expect(StorageManager.getRestoredMessages()).resolves.toEqual(records);
    });

    it('saveRestoredMessages() stores the records under local restored_messages', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        const records = { 'msg-2': { message_id: 'msg-2', fragments: ['b'] } };

        await StorageManager.saveRestoredMessages(records);

        expect((await rawLocal()).restored_messages, 'local restored_messages').toEqual(records);
    });
});

// Expected names come from docs/architecture/STORAGE.md ("Keys that never go to sync"), which lists them in the frozen StorageManager.SYNC_EXCLUDED_KEYS; they are not read from the implementation.
describe('SYNC_EXCLUDED_KEYS: local-only keys never go to sync', () => {
    const DOCUMENTED_LOCAL_ONLY = ['dsLocalAuth', 'dsOversizedKeys', 'restored_messages'];

    it('the freshly loaded StorageManager exposes a frozen list of exactly the three documented local-only keys', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        const excluded = StorageManager.SYNC_EXCLUDED_KEYS;

        expect(Array.isArray(excluded), 'SYNC_EXCLUDED_KEYS must be an array').toBe(true);
        expect([...excluded].sort(), 'SYNC_EXCLUDED_KEYS names').toEqual([...DOCUMENTED_LOCAL_ONLY].sort());
        expect(Object.isFrozen(excluded), 'SYNC_EXCLUDED_KEYS must be frozen').toBe(true);
    });

    it('initialize() on empty storage fills restored_messages in local only, never in sync', async () => {
        const { StorageManager } = await loadFreshStorageManager();

        await StorageManager.initialize();

        expect((await rawLocal()).restored_messages, 'local restored_messages after initialize on empty storage').toEqual({});
        expect(await rawSync(), 'sync area after initialize on empty storage').not.toHaveProperty('restored_messages');
    });
});

describe('dsPermissionIntent_<name>', () => {
    it.each(INTENT_NAMES)('savePermissionIntent(%s) stores true under local dsPermissionIntent_<name> only', async (name) => {
        const { StorageManager } = await loadFreshStorageManager();

        await StorageManager.savePermissionIntent(name);

        expect(await rawLocal(), 'local area after savePermissionIntent').toEqual({ ['dsPermissionIntent_' + name]: true });
        expect(await rawSync(), 'sync area after savePermissionIntent').toEqual({});
    });

    it('getPendingPermissionIntents() returns every documented intent name whose dsPermissionIntent_<name> key is stored in local', async () => {
        const { StorageManager } = await loadFreshStorageManager();
        await chrome.storage.local.set(Object.fromEntries(INTENT_NAMES.map(name => ['dsPermissionIntent_' + name, true])));

        const pending = await StorageManager.getPendingPermissionIntents();

        expect([...pending].sort()).toEqual([...INTENT_NAMES].sort());
    });

    it.each([
        ['AUTO_COPY_REPLY', 'autoCopyReply'],
        ['AUTO_COPY_CODE', 'autoCopyCode'],
        ['REPLY_NOTIFICATION', 'replyNotification'],
    ])('PERMISSION_INTENTS.%s, the constant popup and service worker pass in, writes dsPermissionIntent_%s', async (constantName, intentName) => {
        const { StorageManager } = await loadFreshStorageManager();

        await StorageManager.savePermissionIntent(StorageManager.PERMISSION_INTENTS[constantName]);

        expect(await rawLocal()).toEqual({ ['dsPermissionIntent_' + intentName]: true });
    });
});
