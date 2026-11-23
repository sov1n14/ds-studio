/**
 * Scenario: an auto-resolvable sync conflict converges after one syncNow().
 *
 * Requirement (docs/architecture/STORAGE.md Read path and Sync Conflict Logic, docs/spec/05-data-storage.md "only cloud winning converges"): after syncNow() resolves an auto conflict, both storage areas hold the merged result, so the next syncNow() finds no divergence and writes nothing to chrome.storage.sync. When the cloud side is newer, local receives the merged index, the order meta and every cloud-only prompt group, so an offline read still lists them. When the local reorder is newer, sync receives the local index and order meta.
 *
 * Real StorageManager bundles, real in-memory chrome.storage double (test/fixtures/chrome-storage-mock.js); only chrome.storage is stubbed. Assertions read storage contents and count chrome.storage.sync.set calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

const preset = (id, updatedAt) => ({ id, name: `Name-${id}`, content: `content-${id}`, createdAt: 1, updatedAt });

let setSpy;

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete chrome.runtime.lastError;
    setSpy = vi.spyOn(chrome.storage.sync, 'set');
});

afterEach(() => {
    chrome.storage.sync.setQuotaError(false);
    delete chrome.runtime.lastError;
    vi.restoreAllMocks();
});

/** Run one syncNow() and return the sorted key list of every chrome.storage.sync.set call it made. */
async function syncNowSyncWrites() {
    setSpy.mockClear();
    await StorageManager.syncNow();
    return setSpy.mock.calls.map(([items]) => Object.keys(items).sort());
}

/** Make every chrome.storage.sync.get fail the way Chrome reports it: lastError only inside the callback, rejection in promise form. */
function failSyncReads() {
    const message = 'Simulated sync read failure (offline)';
    return vi.spyOn(chrome.storage.sync, 'get').mockImplementation((keys, callback) => {
        if (typeof keys === 'function') callback = keys;
        if (!callback) return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));
        setTimeout(() => {
            chrome.runtime.lastError = { message };
            try { callback({}); } finally { delete chrome.runtime.lastError; }
        }, 0);
        return undefined;
    });
}

async function readArea(area, keys) {
    return chrome.storage[area].get(keys);
}

// S1: the cloud holds a prompt group this device never cached, and the cloud order is newer.
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

// S3: both areas hold the same groups; this device reordered them after the cloud order was written.
async function seedNewerLocalReorder() {
    await chrome.storage.local.set({
        [K.PRESET_INDEX]: ['b', 'a'],
        dsPreset_a: preset('a', 10),
        dsPreset_b: preset('b', 10),
        [K.PRESET_ORDER_META]: { order: ['b', 'a'], orderUpdatedAt: 500 },
    });
    await chrome.storage.sync.set({
        [K.PRESET_INDEX]: ['a', 'b'],
        dsPreset_a: preset('a', 10),
        dsPreset_b: preset('b', 10),
        [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: 100 },
    });
}

describe('S1 sync-only prompt group, cloud order newer', () => {
    it('writes the cloud-only group, the merged index and the order meta into local', async () => {
        await seedSyncOnlyPreset();
        for (let i = 0; i < 3; i++) await StorageManager.syncNow();

        const local = await readArea('local', ['dsPreset_p2', K.PRESET_INDEX, K.PRESET_ORDER_META]);
        const sync = await readArea('sync', ['dsPreset_p2', K.PRESET_ORDER_META]);
        expect.soft(local.dsPreset_p2, 'local dsPreset_p2 equals the sync copy after syncNow x3').toEqual(sync.dsPreset_p2);
        expect.soft(local.dsPreset_p2, 'local dsPreset_p2 keeps the cloud content').toEqual(preset('p2', 20));
        expect.soft(local[K.PRESET_INDEX], 'local dsPresetIndex after syncNow x3').toEqual(['p1', 'p2']);
        expect.soft(local[K.PRESET_ORDER_META]?.orderUpdatedAt, 'local orderUpdatedAt equals sync orderUpdatedAt')
            .toBe(sync[K.PRESET_ORDER_META]?.orderUpdatedAt);
        expect.soft(local[K.PRESET_ORDER_META]?.order, 'local order meta order').toEqual(['p1', 'p2']);
    });

    it('makes no sync write on the 2nd and 3rd syncNow()', async () => {
        await seedSyncOnlyPreset();
        await syncNowSyncWrites();
        const second = await syncNowSyncWrites();
        const third = await syncNowSyncWrites();

        expect(second, 'sync.set key lists during the 2nd syncNow()').toEqual([]);
        expect(third, 'sync.set key lists during the 3rd syncNow()').toEqual([]);
    });

    it('lists the cloud-only group in an offline read after convergence', async () => {
        await seedSyncOnlyPreset();
        for (let i = 0; i < 3; i++) await StorageManager.syncNow();

        const getSpy = failSyncReads();
        const settings = await StorageManager.getSettings();

        expect(getSpy, 'guard: the failing sync read stub was hit').toHaveBeenCalled();
        expect((settings.promptPresets || []).map(p => p.id), 'offline getSettings().promptPresets ids').toEqual(['p1', 'p2']);
    });
});

describe('S3 newer local reorder', () => {
    it('pushes the local index and order meta to sync', async () => {
        await seedNewerLocalReorder();
        await StorageManager.syncNow();

        const local = await readArea('local', [K.PRESET_INDEX, K.PRESET_ORDER_META]);
        const sync = await readArea('sync', [K.PRESET_INDEX, K.PRESET_ORDER_META]);
        expect(local[K.PRESET_INDEX], 'local dsPresetIndex keeps the local reorder').toEqual(['b', 'a']);
        expect(sync[K.PRESET_INDEX], 'sync dsPresetIndex after syncNow').toEqual(['b', 'a']);
        expect(sync[K.PRESET_ORDER_META], 'sync dsPresetOrderMeta equals local').toEqual(local[K.PRESET_ORDER_META]);
        expect(sync[K.PRESET_ORDER_META]?.order, 'sync order meta order').toEqual(['b', 'a']);
    });

    it('makes no sync write on the 2nd and 3rd syncNow()', async () => {
        await seedNewerLocalReorder();
        await syncNowSyncWrites();
        const second = await syncNowSyncWrites();
        const third = await syncNowSyncWrites();

        expect(second, 'sync.set key lists during the 2nd syncNow()').toEqual([]);
        expect(third, 'sync.set key lists during the 3rd syncNow()').toEqual([]);
    });
});

describe('sync quota failure during the convergence write', () => {
    it('parks the local reorder in dsLocalAuth, then converges once the quota clears', async () => {
        await seedNewerLocalReorder();
        chrome.storage.sync.setQuotaError(true);
        await StorageManager.syncNow();

        const parked = await readArea('local', [K.LOCAL_AUTHORITATIVE]);
        const syncDuring = await readArea('sync', [K.PRESET_ORDER_META]);
        expect(parked[K.LOCAL_AUTHORITATIVE] || [], 'dsLocalAuth while sync rejects writes')
            .toEqual(expect.arrayContaining([K.PRESET_INDEX, K.PRESET_ORDER_META]));
        expect(syncDuring[K.PRESET_ORDER_META]?.orderUpdatedAt, 'sync meta untouched while sync rejects writes').toBe(100);

        chrome.storage.sync.setQuotaError(false);
        await StorageManager.syncNow();

        const local = await readArea('local', [K.PRESET_INDEX, K.PRESET_ORDER_META, K.LOCAL_AUTHORITATIVE]);
        const sync = await readArea('sync', [K.PRESET_INDEX, K.PRESET_ORDER_META]);
        expect(sync[K.PRESET_INDEX], 'sync dsPresetIndex after the quota clears').toEqual(['b', 'a']);
        expect(sync[K.PRESET_ORDER_META], 'sync dsPresetOrderMeta equals local after the quota clears').toEqual(local[K.PRESET_ORDER_META]);
        expect(local[K.LOCAL_AUTHORITATIVE] || [], 'dsLocalAuth drained after the quota clears').toEqual([]);
        expect(await syncNowSyncWrites(), 'sync.set key lists during the next syncNow()').toEqual([]);
    });

    it('still writes the cloud-only group into local while sync rejects writes, then converges', async () => {
        await seedSyncOnlyPreset();
        chrome.storage.sync.setQuotaError(true);
        await StorageManager.syncNow();

        const localDuring = await readArea('local', ['dsPreset_p2', K.PRESET_INDEX]);
        expect(localDuring.dsPreset_p2, 'local dsPreset_p2 while sync rejects writes').toEqual(preset('p2', 20));
        expect(localDuring[K.PRESET_INDEX], 'local dsPresetIndex while sync rejects writes').toEqual(['p1', 'p2']);

        chrome.storage.sync.setQuotaError(false);
        await StorageManager.syncNow();

        expect(await syncNowSyncWrites(), 'sync.set key lists during the next syncNow()').toEqual([]);
    });
});

describe('tombstone guard on the convergence write', () => {
    it('writes a cloud-only group into local but never one a local tombstone deleted', async () => {
        await chrome.storage.local.set({
            [K.PRESET_INDEX]: ['p1'],
            dsPreset_p1: preset('p1', 10),
            [K.PRESET_ORDER_META]: { order: ['p1'], orderUpdatedAt: 100 },
            [K.PRESET_TOMBSTONES]: { p2: { ts: Date.now(), deleted: true } },
        });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['p1', 'p2', 'p3'],
            dsPreset_p1: preset('p1', 10),
            dsPreset_p2: preset('p2', 20),
            dsPreset_p3: preset('p3', 30),
            [K.PRESET_ORDER_META]: { order: ['p1', 'p2', 'p3'], orderUpdatedAt: 200 },
        });

        await StorageManager.syncNow();

        const local = await readArea('local', ['dsPreset_p2', 'dsPreset_p3']);
        expect(local.dsPreset_p3, 'control: local dsPreset_p3 (cloud-only, not tombstoned)').toEqual(preset('p3', 30));
        expect('dsPreset_p2' in local, 'local holds the tombstoned dsPreset_p2').toBe(false);
    });
});

/**
 * Scenario: resolveSyncConflict() called directly (popup merge button) while the sync read fails.
 *
 * Requirement (lead ruling on the D-156/D-157 regression): when resolveSyncConflict() runs and the sync read fails, it must not overwrite cloud data from the partial (local-only) view — neither by a sync write during the call nor by keys parked in dsLocalAuth for a later retry — and once reads work again a normal resolution converges with the cloud-only group in local.
 *
 * Fixture: S1 (sync index ['p1','p2'] with both bodies and a newer order meta; local holds only p1). The sync read fails only during the resolveSyncConflict() call, then works again.
 */
const S1_SYNC_INDEX = ['p1', 'p2'];
const S1_SYNC_META = { order: ['p1', 'p2'], orderUpdatedAt: 200 };

/** Make every chrome.storage.sync.get throw synchronously, in callback and promise form alike. */
function throwSyncReads() {
    return vi.spyOn(chrome.storage.sync, 'get').mockImplementation(() => {
        throw new Error('Simulated synchronous sync read throw');
    });
}

/** Run resolveSyncConflict() with the given sync-read failure double installed, then let reads work again. Returns the sorted key list of every chrome.storage.sync.set call made during the call. */
async function resolveWhileSyncReadsFail(installFailure) {
    const getSpy = installFailure();
    setSpy.mockClear();
    try {
        await StorageManager.resolveSyncConflict();
    } catch {
        // The requirement does not rule on whether the call rejects; only what it writes is asserted.
    }
    const hits = getSpy.mock.calls.length;
    getSpy.mockRestore();
    expect(hits, 'guard: the failing sync read stub was hit during resolveSyncConflict()').toBeGreaterThan(0);
    return setSpy.mock.calls.map(([items]) => Object.keys(items).sort());
}

async function expectCloudUntouched(label) {
    const sync = await readArea('sync', [K.PRESET_INDEX, K.PRESET_ORDER_META, 'dsPreset_p2']);
    expect.soft(sync[K.PRESET_INDEX], `${label}: sync dsPresetIndex still lists p2`).toEqual(S1_SYNC_INDEX);
    expect.soft(sync[K.PRESET_ORDER_META], `${label}: sync dsPresetOrderMeta not replaced by a local-only one`).toEqual(S1_SYNC_META);
    expect.soft(sync.dsPreset_p2, `${label}: sync dsPreset_p2 body kept`).toEqual(preset('p2', 20));
}

/** Assert the sync copy still lists p2 in its index and order meta and keeps the p2 body; a normal merge may restamp orderUpdatedAt, so only the order is checked. */
async function expectCloudStillListsP2(label) {
    const sync = await readArea('sync', [K.PRESET_INDEX, K.PRESET_ORDER_META, 'dsPreset_p2']);
    expect.soft(sync[K.PRESET_INDEX], `${label}: sync dsPresetIndex still lists p2, not the local-only [p1]`).toEqual(S1_SYNC_INDEX);
    expect.soft(sync[K.PRESET_ORDER_META]?.order, `${label}: sync dsPresetOrderMeta.order still lists p2, not the local-only [p1]`).toEqual(S1_SYNC_META.order);
    expect.soft(sync.dsPreset_p2, `${label}: sync dsPreset_p2 body kept`).toEqual(preset('p2', 20));
}

async function expectConvergedWithP2(label) {
    const local = await readArea('local', ['dsPreset_p2', K.PRESET_INDEX, K.PRESET_ORDER_META]);
    const sync = await readArea('sync', [K.PRESET_INDEX, K.PRESET_ORDER_META]);
    expect.soft(sync[K.PRESET_INDEX], `${label}: sync dsPresetIndex lists p2`).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect.soft(sync[K.PRESET_ORDER_META]?.order, `${label}: sync order meta lists p2`).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect.soft(local.dsPreset_p2, `${label}: local dsPreset_p2 holds the cloud body`).toEqual(preset('p2', 20));
    expect.soft(local[K.PRESET_INDEX], `${label}: local dsPresetIndex lists p2`).toEqual(expect.arrayContaining(['p1', 'p2']));
}

const INDEX_OR_META = (keys) => keys.filter(k => k === K.PRESET_INDEX || k === K.PRESET_ORDER_META);

describe('resolveSyncConflict() while the sync read fails (callback lastError / promise rejection)', () => {
    it('writes no dsPresetIndex or dsPresetOrderMeta to sync and leaves the cloud copy untouched', async () => {
        await seedSyncOnlyPreset();
        const writes = await resolveWhileSyncReadsFail(failSyncReads);

        expect.soft(writes.flatMap(INDEX_OR_META), 'index/meta keys in sync.set calls during the failed-read resolveSyncConflict()').toEqual([]);
        await expectCloudUntouched('after the failed-read resolveSyncConflict()');
    });

    it('converges with p2 in local on the next syncNow() once reads work', async () => {
        await seedSyncOnlyPreset();
        await resolveWhileSyncReadsFail(failSyncReads);

        await StorageManager.syncNow();

        await expectConvergedWithP2('after syncNow() with reads working');
    });

    it('parks no index or meta in dsLocalAuth when sync writes fail too, and a later retrySync() + syncNow() keeps p2', async () => {
        await seedSyncOnlyPreset();
        chrome.storage.sync.setQuotaError(true);
        await resolveWhileSyncReadsFail(failSyncReads);
        chrome.storage.sync.setQuotaError(false);

        const parked = await readArea('local', [K.LOCAL_AUTHORITATIVE]);
        expect.soft(INDEX_OR_META(parked[K.LOCAL_AUTHORITATIVE] || []), 'index/meta keys parked in dsLocalAuth by the failed-read resolveSyncConflict()').toEqual([]);

        // Once reads work, retrySync() detects the auto conflict and runs the normal full merge, which may write the merged index and a restamped order meta to sync; only a sync copy without p2 is the defect.
        await StorageManager.retrySync();
        await expectCloudStillListsP2('after the later retrySync()');

        await StorageManager.syncNow();
        await expectConvergedWithP2('after syncNow() with reads and writes working');
    });
});

describe('resolveSyncConflict() while the sync read throws synchronously', () => {
    it('leaves the cloud copy untouched, then converges with p2 in local once reads work', async () => {
        await seedSyncOnlyPreset();
        const writes = await resolveWhileSyncReadsFail(throwSyncReads);

        expect.soft(writes.flatMap(INDEX_OR_META), 'index/meta keys in sync.set calls during the throwing-read resolveSyncConflict()').toEqual([]);
        await expectCloudUntouched('after the throwing-read resolveSyncConflict()');

        await StorageManager.syncNow();
        await expectConvergedWithP2('after syncNow() with reads working');
    });
});

/**
 * Scenario: the merge that retrySync() (inside syncNow()) or a first-run initialize() starts hits a failing sync read after their own conflict check succeeded.
 *
 * Requirement (lead ruling 2 on D-156/D-157): resolveSyncConflict() rejects on a failed sync read, and its callers must contain that rejection: syncNow() and initialize() resolve, nothing from the partial (local-only) view reaches sync or is parked in dsLocalAuth, and the conflict stays pending, so a later syncNow() with reads working converges with p2 in both areas.
 *
 * Fixture: S1 (an auto-resolvable divergence). The conflict check and the merge each read the whole sync area (chrome.storage.sync.get(null)), so the double lets the 1st full-area read through (the caller's conflict check) and fails the 2nd (the merge's read) the way Chrome reports a read failure; every other sync read works. The stub records whether its failing call was hit.
 */
function failMergeSyncRead() {
    const message = 'Simulated sync read failure during the merge';
    const realGet = chrome.storage.sync.get.bind(chrome.storage.sync);
    const stats = { fullReads: 0, failedHits: 0 };
    const spy = vi.spyOn(chrome.storage.sync, 'get').mockImplementation((keys, callback) => {
        if (typeof keys === 'function') { callback = keys; keys = null; }
        if (keys === null || keys === undefined) {
            stats.fullReads += 1;
            if (stats.fullReads === 2) {
                stats.failedHits += 1;
                if (!callback) return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));
                setTimeout(() => {
                    chrome.runtime.lastError = { message };
                    try { callback({}); } finally { delete chrome.runtime.lastError; }
                }, 0);
                return undefined;
            }
        }
        return callback ? realGet(keys, callback) : realGet(keys);
    });
    return { spy, stats };
}

/** Run one caller with the merge-read failure installed; return how it settled, the sorted key list of every sync.set call it made, and the stub stats. Reads work again afterwards. */
async function runWithMergeReadFailure(caller) {
    const { spy, stats } = failMergeSyncRead();
    setSpy.mockClear();
    const outcome = await caller().then(() => 'resolved', (err) => `rejected: ${err?.message ?? err}`);
    const writes = setSpy.mock.calls.map(([items]) => Object.keys(items).sort());
    spy.mockRestore();
    return { outcome, writes, stats };
}

describe('callers of resolveSyncConflict() when the merge sync read fails after a successful conflict check', () => {
    it('syncNow() resolves, writes nothing to sync, parks nothing, and a later syncNow() converges with p2', async () => {
        await seedSyncOnlyPreset();

        const { outcome, writes, stats } = await runWithMergeReadFailure(() => StorageManager.syncNow());

        expect(stats.failedHits, 'guard: the failing merge sync read (2nd full-area read) was hit during syncNow()').toBe(1);
        expect.soft(outcome, 'syncNow() settles as resolved when the merge sync read fails').toBe('resolved');
        expect.soft(writes, 'sync.set key lists during the failed-merge syncNow()').toEqual([]);
        await expectCloudUntouched('after the failed-merge syncNow()');
        const parked = await readArea('local', [K.LOCAL_AUTHORITATIVE]);
        expect.soft(INDEX_OR_META(parked[K.LOCAL_AUTHORITATIVE] || []), 'index/meta keys parked in dsLocalAuth by the failed-merge syncNow()').toEqual([]);

        await StorageManager.syncNow();
        await expectConvergedWithP2('after a later syncNow() with reads working');
    });

    it('first-run initialize() resolves, writes no index/meta to sync, parks nothing, and a later syncNow() converges with p2', async () => {
        await seedSyncOnlyPreset();
        const flags = await readArea('local', [K.SYNC_INITIALIZED, K.SYNC_CONFLICT_PENDING]);
        expect(flags, 'precondition: a first run holds no sync flag keys in local').toEqual({});

        const { outcome, writes, stats } = await runWithMergeReadFailure(() => StorageManager.initialize());

        expect(stats.failedHits, 'guard: the failing merge sync read (2nd full-area read) was hit during initialize()').toBe(1);
        expect.soft(outcome, 'initialize() settles as resolved when the merge sync read fails').toBe('resolved');
        // initialize() may legitimately push defaults and keys missing from sync, so only the index and order meta, which sync already holds, are checked.
        expect.soft(writes.flatMap(INDEX_OR_META), 'index/meta keys in sync.set calls during the failed-merge initialize()').toEqual([]);
        await expectCloudUntouched('after the failed-merge initialize()');
        const parked = await readArea('local', [K.LOCAL_AUTHORITATIVE]);
        expect.soft(INDEX_OR_META(parked[K.LOCAL_AUTHORITATIVE] || []), 'index/meta keys parked in dsLocalAuth by the failed-merge initialize()').toEqual([]);

        await StorageManager.syncNow();
        await expectConvergedWithP2('after a later syncNow() with reads working');
    });
});
