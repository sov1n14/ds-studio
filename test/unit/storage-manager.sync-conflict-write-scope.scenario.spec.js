/**
 * Scenario: what a sync conflict resolution writes, removes and logs, beyond reaching a converged state.
 *
 * Requirement (docs/architecture/STORAGE.md Sync Conflict Logic, docs/spec/05-data-storage.md Resolution Writes and Resolution Failure):
 * - Each merged preset goes to both areas when the cloud copy is missing or older, and to local only when the cloud holds it but local differs; a preset both areas already hold identically is written to neither area.
 * - A preset listed in either area index but absent from the merged result is removed from both areas, and nothing else is removed, including when one area holds no index at all.
 * - When the merge sync read fails, retrySync() (inside syncNow()) and initialize() catch the rejection and log `[DSS] storage-manager retrySync: resolveSyncConflict failed:` or `[DSS] storage-manager initialize: resolveSyncConflict failed:` with the error, which carries the Chrome read-failure reason; initialize() leaves syncInitialized unset.
 *
 * Real StorageManager bundles share the in-memory chrome.storage double from test/setup/vitest.setup.js; only chrome.storage is stubbed. Assertions read storage contents, the keys passed to chrome.storage set/remove, and the logged diagnostic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

const preset = (id, updatedAt) => ({ id, name: `Name-${id}`, content: `content-${id}`, createdAt: 1, updatedAt });

const isPresetKey = (key) => key.startsWith('dsPreset_') && key !== K.PRESET_INDEX && key !== K.PRESET_ORDER_META && key !== K.PRESET_TOMBSTONES;

let warnSpy;

beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete chrome.runtime.lastError;
});

afterEach(() => {
    chrome.storage.sync.setQuotaError(false);
    delete chrome.runtime.lastError;
    vi.restoreAllMocks();
});

/** Spy on set() and remove() of both areas; returns readers for the unique sorted preset keys each area received, and for the raw key argument of every remove() call. */
function recordStorageWrites() {
    const spies = {
        syncSet: vi.spyOn(chrome.storage.sync, 'set'),
        localSet: vi.spyOn(chrome.storage.local, 'set'),
        syncRemove: vi.spyOn(chrome.storage.sync, 'remove'),
        localRemove: vi.spyOn(chrome.storage.local, 'remove'),
    };
    const setKeys = (spy) => [...new Set(spy.mock.calls.flatMap(([items]) => Object.keys(items)).filter(isPresetKey))].sort();
    const removedKeys = (spy) => [...new Set(spy.mock.calls.flatMap(([keys]) => (Array.isArray(keys) ? keys : [keys])))].sort();
    return {
        presetKeysSetIn: (area) => setKeys(area === 'sync' ? spies.syncSet : spies.localSet),
        keysRemovedFrom: (area) => removedKeys(area === 'sync' ? spies.syncRemove : spies.localRemove),
        removeCallsTo: (area) => (area === 'sync' ? spies.syncRemove : spies.localRemove).mock.calls.map(([keys]) => keys),
    };
}

// p1: both areas hold the same copy. p2: only the cloud holds it. p3: only this device holds it. The cloud order is newer.
async function seedMixedPresets() {
    await chrome.storage.local.set({
        [K.PRESET_INDEX]: ['p1', 'p3'],
        dsPreset_p1: preset('p1', 10),
        dsPreset_p3: preset('p3', 30),
        [K.PRESET_ORDER_META]: { order: ['p1', 'p3'], orderUpdatedAt: 100 },
    });
    await chrome.storage.sync.set({
        [K.PRESET_INDEX]: ['p1', 'p2'],
        dsPreset_p1: preset('p1', 10),
        dsPreset_p2: preset('p2', 20),
        [K.PRESET_ORDER_META]: { order: ['p1', 'p2'], orderUpdatedAt: 200 },
    });
}

describe('resolveSyncConflict() writes each preset only to the area that lacks or differs from the merged copy', () => {
    it('writes the cloud-only preset to local only, the device-only preset to both areas, and the shared identical preset to neither', async () => {
        await seedMixedPresets();
        const writes = recordStorageWrites();

        await StorageManager.resolveSyncConflict();

        expect.soft(writes.presetKeysSetIn('sync'), 'preset keys written to chrome.storage.sync').toEqual(['dsPreset_p3']);
        expect.soft(writes.presetKeysSetIn('local'), 'preset keys written to chrome.storage.local').toEqual(['dsPreset_p2', 'dsPreset_p3']);

        const local = await chrome.storage.local.get(['dsPreset_p1', 'dsPreset_p2', 'dsPreset_p3']);
        const sync = await chrome.storage.sync.get(['dsPreset_p1', 'dsPreset_p2', 'dsPreset_p3']);
        expect.soft(local, 'control: local holds all three merged presets').toEqual({ dsPreset_p1: preset('p1', 10), dsPreset_p2: preset('p2', 20), dsPreset_p3: preset('p3', 30) });
        expect.soft(sync, 'control: sync holds all three merged presets').toEqual({ dsPreset_p1: preset('p1', 10), dsPreset_p2: preset('p2', 20), dsPreset_p3: preset('p3', 30) });
    });

    it('parks only the preset the cloud lacks in dsLocalAuth when sync rejects writes', async () => {
        await seedMixedPresets();
        chrome.storage.sync.setQuotaError(true);

        await StorageManager.resolveSyncConflict();

        const parked = (await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]))[K.LOCAL_AUTHORITATIVE] || [];
        const parkedPresets = parked.filter(isPresetKey).sort();
        expect(parkedPresets, 'preset keys parked in dsLocalAuth while sync rejects writes (the cloud already holds p1 and p2)').toEqual(['dsPreset_p3']);
    });
});

describe('resolveSyncConflict() removes exactly the presets an index lists and the merge drops', () => {
    // Every remove() call crosses the chrome.storage boundary and counts against the sync write-operation quota, even with an empty key list, so a merge that drops nothing must make no remove() call at all.
    it('makes no remove() call on either area when every indexed preset survives the merge', async () => {
        await seedMixedPresets();
        const writes = recordStorageWrites();

        await StorageManager.resolveSyncConflict();

        expect.soft(writes.removeCallsTo('sync'), 'key arguments of chrome.storage.sync.remove() calls during resolution').toEqual([]);
        expect.soft(writes.removeCallsTo('local'), 'key arguments of chrome.storage.local.remove() calls during resolution').toEqual([]);
        const local = await chrome.storage.local.get(['dsPreset_p1', 'dsPreset_p2', 'dsPreset_p3']);
        const sync = await chrome.storage.sync.get(['dsPreset_p1', 'dsPreset_p2', 'dsPreset_p3']);
        expect.soft(Object.keys(local).sort(), 'control: local holds all three merged presets').toEqual(['dsPreset_p1', 'dsPreset_p2', 'dsPreset_p3']);
        expect.soft(Object.keys(sync).sort(), 'control: sync holds all three merged presets').toEqual(['dsPreset_p1', 'dsPreset_p2', 'dsPreset_p3']);
    });

    it('deletes a preset that a local tombstone removed from the cloud copy as well', async () => {
        await chrome.storage.local.set({
            [K.PRESET_INDEX]: ['p1'],
            dsPreset_p1: preset('p1', 10),
            [K.PRESET_ORDER_META]: { order: ['p1'], orderUpdatedAt: 300 },
            [K.PRESET_TOMBSTONES]: { p2: { ts: Date.now(), deleted: true } },
        });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['p1', 'p2'],
            dsPreset_p1: preset('p1', 10),
            dsPreset_p2: preset('p2', 20),
            [K.PRESET_ORDER_META]: { order: ['p1', 'p2'], orderUpdatedAt: 200 },
        });

        await StorageManager.resolveSyncConflict();

        const sync = await chrome.storage.sync.get(['dsPreset_p1', 'dsPreset_p2']);
        const local = await chrome.storage.local.get(['dsPreset_p1', 'dsPreset_p2']);
        expect.soft(sync, 'sync presets after resolving: the tombstoned p2 is gone, p1 stays').toEqual({ dsPreset_p1: preset('p1', 10) });
        expect.soft(local, 'local presets after resolving: the tombstoned p2 is absent, p1 stays').toEqual({ dsPreset_p1: preset('p1', 10) });
    });

    it('removes only the listed-without-body preset when local holds no index', async () => {
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['p1', 'p2'],
            dsPreset_p1: preset('p1', 10),
            [K.PRESET_ORDER_META]: { order: ['p1', 'p2'], orderUpdatedAt: 200 },
        });
        const writes = recordStorageWrites();

        await StorageManager.resolveSyncConflict();

        expect.soft(writes.keysRemovedFrom('sync'), 'keys removed from chrome.storage.sync').toEqual(['dsPreset_p2']);
        expect.soft(writes.keysRemovedFrom('local'), 'keys removed from chrome.storage.local').toEqual(['dsPreset_p2']);
        const local = await chrome.storage.local.get(['dsPreset_p1', K.PRESET_INDEX]);
        expect.soft(local.dsPreset_p1, 'control: local receives the cloud preset p1').toEqual(preset('p1', 10));
        expect.soft(local[K.PRESET_INDEX], 'control: local index lists the merged presets').toEqual(['p1']);
    });

    it('removes only the listed-without-body preset when sync holds no index', async () => {
        await chrome.storage.local.set({
            [K.PRESET_INDEX]: ['p1', 'p2'],
            dsPreset_p1: preset('p1', 10),
            [K.PRESET_ORDER_META]: { order: ['p1', 'p2'], orderUpdatedAt: 100 },
        });
        const writes = recordStorageWrites();

        await StorageManager.resolveSyncConflict();

        expect.soft(writes.keysRemovedFrom('sync'), 'keys removed from chrome.storage.sync').toEqual(['dsPreset_p2']);
        expect.soft(writes.keysRemovedFrom('local'), 'keys removed from chrome.storage.local').toEqual(['dsPreset_p2']);
        const sync = await chrome.storage.sync.get(['dsPreset_p1', K.PRESET_INDEX]);
        expect.soft(sync.dsPreset_p1, 'control: sync receives the device preset p1').toEqual(preset('p1', 10));
        expect.soft(sync[K.PRESET_INDEX], 'control: sync index lists the merged presets').toEqual(['p1']);
    });
});

/**
 * The conflict check and the merge each read the whole sync area (chrome.storage.sync.get(null)); the double lets the 1st full-area read through and fails the 2nd the way Chrome reports a read failure: chrome.runtime.lastError, a plain object with a message, set only while the callback runs.
 */
const MERGE_READ_FAILURE = 'Simulated sync read failure during the merge';

function failMergeSyncRead() {
    const realGet = chrome.storage.sync.get.bind(chrome.storage.sync);
    const stats = { fullReads: 0, failedHits: 0 };
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation((keys, callback) => {
        if (typeof keys === 'function') { callback = keys; keys = null; }
        if (keys === null || keys === undefined) {
            stats.fullReads += 1;
            if (stats.fullReads === 2) {
                stats.failedHits += 1;
                if (!callback) return new Promise((_, reject) => setTimeout(() => reject(new Error(MERGE_READ_FAILURE)), 0));
                setTimeout(() => {
                    chrome.runtime.lastError = { message: MERGE_READ_FAILURE };
                    try { callback({}); } finally { delete chrome.runtime.lastError; }
                }, 0);
                return undefined;
            }
        }
        return callback ? realGet(keys, callback) : realGet(keys);
    });
    return stats;
}

// An auto-resolvable divergence: the cloud holds p2 this device never cached, and the cloud order is newer.
async function seedSyncOnlyPreset() {
    await chrome.storage.local.set({
        [K.PRESET_INDEX]: ['p1'],
        dsPreset_p1: preset('p1', 10),
        [K.PRESET_ORDER_META]: { order: ['p1'], orderUpdatedAt: 100 },
    });
    await chrome.storage.sync.set({
        [K.PRESET_INDEX]: ['p1', 'p2'],
        dsPreset_p1: preset('p1', 10),
        dsPreset_p2: preset('p2', 20),
        [K.PRESET_ORDER_META]: { order: ['p1', 'p2'], orderUpdatedAt: 200 },
    });
}

/** Return the arguments of the console.warn call whose first argument is exactly the given prefix, or undefined. */
function warnCallWith(prefix) {
    return warnSpy.mock.calls.find(([first]) => first === prefix);
}

describe('callers log a failed merge with the Chrome read-failure reason', () => {
    it('initialize() logs the documented diagnostic with the read error and leaves syncInitialized unset', async () => {
        await seedSyncOnlyPreset();
        const stats = failMergeSyncRead();

        await StorageManager.initialize();

        expect(stats.failedHits, 'guard: the failing merge sync read was hit during initialize()').toBe(1);
        const call = warnCallWith('[DSS] storage-manager initialize: resolveSyncConflict failed:');
        expect(call, 'console.warn call with the documented initialize() diagnostic').toBeDefined();
        expect(call[1], 'logged value is an Error').toBeInstanceOf(Error);
        expect(call[1].message, 'logged error message carries the chrome.runtime.lastError message').toContain(MERGE_READ_FAILURE);
        const flags = await chrome.storage.local.get([K.SYNC_INITIALIZED]);
        expect(flags[K.SYNC_INITIALIZED], 'local syncInitialized after the failed merge').not.toBe(true);
    });

    it('syncNow() logs the documented retrySync() diagnostic with the read error', async () => {
        await seedSyncOnlyPreset();
        const stats = failMergeSyncRead();

        await StorageManager.syncNow();

        expect(stats.failedHits, 'guard: the failing merge sync read was hit during syncNow()').toBe(1);
        const call = warnCallWith('[DSS] storage-manager retrySync: resolveSyncConflict failed:');
        expect(call, 'console.warn call with the documented retrySync() diagnostic').toBeDefined();
        expect(call[1], 'logged value is an Error').toBeInstanceOf(Error);
        expect(call[1].message, 'logged error message carries the chrome.runtime.lastError message').toContain(MERGE_READ_FAILURE);
    });
});
