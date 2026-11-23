import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

/**
 * Sync conflict resolution versus the dsLocalAuth retry queue (ISSUES I-43, DECISIONS D-157). Real StorageManager modules share the in-memory chrome.storage double from test/setup/vitest.setup.js; only chrome.storage is stubbed, and only to fail a sync write.
 *
 * docs/architecture/STORAGE.md: dsLocalAuth is the write-failure retry queue of keys whose sync write failed and fell back to local, and retrySync() pushes such a plain setting unconditionally, because the parked local value is the newer edit of the user. The lead ruled that resolveSyncConflict() keeps the local value of a queued key for every caller (first-run initialize(), syncNow() on an installed profile, the popup "Merge Sync" call), and that an unqueued owned setting still takes the cloud value.
 *
 * Base seed: local dsChatWidth 90 queued in dsLocalAuth, sync dsChatWidth 70; unqueued dsInputWidth local 50, sync 60; an auto-resolvable divergence (prompt group p2 exists in sync only, and the sync dsPresetOrderMeta is newer), so a conflict resolution runs. Every test asserts storage contents only.
 */

const K = StorageManager.KEYS;

const P1 = { id: 'p1', name: 'Both', content: 'same', createdAt: 1, updatedAt: 100 };
const P2 = { id: 'p2', name: 'SyncOnly', content: 'cloud only', createdAt: 1, updatedAt: 300 };

const QUEUED_LOCAL = 90;
const QUEUED_CLOUD = 70;
const UNQUEUED_LOCAL = 50;
const UNQUEUED_CLOUD = 60;

function baseSeed({ isDivergent = true } = {}) {
    const local = {
        [K.PRESET_INDEX]: ['p1'],
        dsPreset_p1: P1,
        [K.PRESET_ORDER_META]: { order: ['p1'], orderUpdatedAt: 100 },
        [K.CHAT_WIDTH]: QUEUED_LOCAL,
        [K.INPUT_WIDTH]: UNQUEUED_LOCAL,
        [K.LOCAL_AUTHORITATIVE]: [K.CHAT_WIDTH],
    };
    const sync = isDivergent
        ? {
            [K.PRESET_INDEX]: ['p1', 'p2'],
            dsPreset_p1: P1,
            dsPreset_p2: P2,
            [K.PRESET_ORDER_META]: { order: ['p1', 'p2'], orderUpdatedAt: 200 },
            [K.CHAT_WIDTH]: QUEUED_CLOUD,
            [K.INPUT_WIDTH]: UNQUEUED_CLOUD,
        }
        : {
            [K.PRESET_INDEX]: ['p1'],
            dsPreset_p1: P1,
            [K.PRESET_ORDER_META]: { order: ['p1'], orderUpdatedAt: 100 },
            [K.CHAT_WIDTH]: QUEUED_CLOUD,
            [K.INPUT_WIDTH]: UNQUEUED_CLOUD,
        };
    return { local, sync };
}

// Same pattern as seedFirstRun in storage-manager.first-run-sync-conflict.scenario.spec.js: first-run storage holds content keys only, never the sync flag keys.
async function seedFirstRun({ local, sync }) {
    for (const area of [local, sync]) {
        expect(area).not.toHaveProperty(K.SYNC_INITIALIZED);
        expect(area).not.toHaveProperty(K.SYNC_CONFLICT_PENDING);
    }
    if (Object.keys(local).length > 0) await chrome.storage.local.set(local);
    if (Object.keys(sync).length > 0) await chrome.storage.sync.set(sync);
}

async function seedInstalled({ local, sync }) {
    const flags = { [K.SYNC_INITIALIZED]: true, [K.SYNC_CONFLICT_PENDING]: false };
    await chrome.storage.local.set({ ...flags, ...local });
    await chrome.storage.sync.set({ ...flags, ...sync });
}

async function readLocal() {
    return chrome.storage.local.get([K.CHAT_WIDTH, K.INPUT_WIDTH, K.LOCAL_AUTHORITATIVE, K.PRESET_INDEX]);
}

/**
 * Makes chrome.storage.sync.set fail the way the real API reports a quota error (the promise form rejects, the callback form exposes lastError inside its callback, nothing is stored) whenever the batch carries the queued local value 90; every other sync write succeeds.
 */
function failSyncWritesOfQueuedValue() {
    const area = chrome.storage.sync;
    const realSet = area.set;
    const attempts = [];
    const spy = vi.spyOn(area, 'set').mockImplementation(function (items, callback) {
        const isQueuedValue = items?.[K.CHAT_WIDTH] === QUEUED_LOCAL;
        if (isQueuedValue) attempts.push(structuredClone(items));
        area.setQuotaError(isQueuedValue);
        try {
            return realSet.call(area, items, callback);
        } finally {
            area.setQuotaError(false);
        }
    });
    return { spy, attempts };
}

function throwOnEverySyncWrite() {
    const thrown = [];
    const spy = vi.spyOn(chrome.storage.sync, 'set').mockImplementation((items) => {
        thrown.push(structuredClone(items));
        throw new Error('sync set threw synchronously');
    });
    return { spy, thrown };
}

async function expectQueuedKeyKept(stage) {
    const local = await readLocal();
    expect(local[K.CHAT_WIDTH], `local dsChatWidth (queued user edit) ${stage}`).toBe(QUEUED_LOCAL);
    expect(local[K.LOCAL_AUTHORITATIVE] ?? [], `local dsLocalAuth ${stage}`).toContain(K.CHAT_WIDTH);
}

async function expectResolutionRan(stage) {
    const local = await readLocal();
    expect(local[K.PRESET_INDEX], `local dsPresetIndex ${stage} (proves the conflict resolution merged p2 in)`).toContain('p2');
}

async function expectWorkingSyncNowPushesQueuedValue() {
    await StorageManager.syncNow();
    const sync = await chrome.storage.sync.get([K.CHAT_WIDTH]);
    const local = await readLocal();
    expect(sync[K.CHAT_WIDTH], 'sync dsChatWidth after a later syncNow() with a working sync').toBe(QUEUED_LOCAL);
    expect(local[K.CHAT_WIDTH], 'local dsChatWidth after a later syncNow() with a working sync').toBe(QUEUED_LOCAL);
    expect(local[K.LOCAL_AUTHORITATIVE] ?? [], 'local dsLocalAuth after the queued value reached sync').not.toContain(K.CHAT_WIDTH);
}

describe('sync conflict resolution keeps a key queued in dsLocalAuth', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        delete chrome.runtime.lastError;
    });

    describe('T1 first run: initialize() resolves the auto divergence', () => {
        beforeEach(async () => {
            await seedFirstRun(baseSeed());
        });

        it('keeps local dsChatWidth 90 queued, and a later working syncNow() pushes 90 to sync', async () => {
            await StorageManager.initialize();

            await expectResolutionRan('after first-run initialize()');
            await expectQueuedKeyKept('after first-run initialize()');
            await expectWorkingSyncNowPushesQueuedValue();
        });

        it('control: the unqueued dsInputWidth takes the cloud value', async () => {
            await StorageManager.initialize();

            await expectResolutionRan('after first-run initialize()');
            const local = await readLocal();
            expect(local[K.INPUT_WIDTH], 'local dsInputWidth (unqueued) after first-run initialize()').toBe(UNQUEUED_CLOUD);
        });
    });

    describe('T2 installed profile: syncNow() while the queued value still cannot reach sync', () => {
        it('keeps local dsChatWidth 90 queued through the failed push, and a later working syncNow() pushes 90 to sync', async () => {
            await seedInstalled(baseSeed());
            const { spy, attempts } = failSyncWritesOfQueuedValue();

            await StorageManager.syncNow();

            expect(attempts.length, 'sync writes carrying dsChatWidth 90 that the stub rejected').toBeGreaterThan(0);
            await expectResolutionRan('after syncNow() on an installed profile');
            await expectQueuedKeyKept('after syncNow() with the queued push failing');

            spy.mockRestore();
            await expectWorkingSyncNowPushesQueuedValue();
        });

        it('control: the unqueued dsInputWidth takes the cloud value', async () => {
            await seedInstalled(baseSeed());
            failSyncWritesOfQueuedValue();

            await StorageManager.syncNow();

            await expectResolutionRan('after syncNow() on an installed profile');
            const local = await readLocal();
            expect(local[K.INPUT_WIDTH], 'local dsInputWidth (unqueued) after syncNow()').toBe(UNQUEUED_CLOUD);
        });

        it('control: without a divergence the failed push alone keeps local dsChatWidth 90 queued', async () => {
            // Separates the conflict resolution from the failing stub: with no prompt group divergence, a rejected push of the queued value leaves it parked.
            await seedInstalled(baseSeed({ isDivergent: false }));
            const { attempts } = failSyncWritesOfQueuedValue();

            await StorageManager.syncNow();

            expect(attempts.length, 'sync writes carrying dsChatWidth 90 that the stub rejected').toBeGreaterThan(0);
            await expectQueuedKeyKept('after syncNow() with the queued push failing and no divergence');
        });
    });

    describe('T4 popup "Merge Sync": resolveSyncConflict() called directly', () => {
        beforeEach(async () => {
            const { local, sync } = baseSeed();
            // The popup offers Merge Sync while the local conflict flag is set; initialize() writes the flags to local only.
            await chrome.storage.local.set({ ...local, [K.SYNC_INITIALIZED]: false, [K.SYNC_CONFLICT_PENDING]: true });
            await chrome.storage.sync.set(sync);
        });

        it('keeps local dsChatWidth 90 queued', async () => {
            await StorageManager.resolveSyncConflict();

            await expectResolutionRan('after resolveSyncConflict()');
            await expectQueuedKeyKept('after resolveSyncConflict()');
        });

        it('control: the unqueued dsInputWidth takes the cloud value', async () => {
            await StorageManager.resolveSyncConflict();

            await expectResolutionRan('after resolveSyncConflict()');
            const local = await readLocal();
            expect(local[K.INPUT_WIDTH], 'local dsInputWidth (unqueued) after resolveSyncConflict()').toBe(UNQUEUED_CLOUD);
        });

        it('failure mode: a sync set that throws synchronously during resolve keeps local dsChatWidth 90 queued', async () => {
            const { thrown } = throwOnEverySyncWrite();

            // Whether resolveSyncConflict() rejects on a throwing boundary is outside this requirement; only the storage it leaves is asserted.
            await StorageManager.resolveSyncConflict().catch(() => {});

            expect(thrown.length, 'sync writes that threw during resolveSyncConflict()').toBeGreaterThan(0);
            await expectQueuedKeyKept('after resolveSyncConflict() with a throwing sync set');
        });
    });
});
