import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

/**
 * First-run sync conflict scenario: a first run is a profile where neither storage area holds the
 * sync flag keys (`syncInitialized`, `syncConflictPending`); only content keys exist. Real StorageManager
 * modules share the in-memory chrome.storage double from test/setup/vitest.setup.js; nothing else is mocked.
 *
 * Requirements:
 * 1. Manual conflict (same preset id, equal updatedAt, different content): after initialize() the local area
 *    holds syncConflictPending true, so the popup shows the merge prompt, and the local preset is unchanged.
 * 2. After a first initialize() in the none, auto and fresh cases, the local area holds syncInitialized true.
 * 3. Auto conflict with no dsPresetOrderMeta in either area: after initialize() the local dsPresetOrderMeta holds
 *    the resolved merge order, not the empty default `{ order: [], orderUpdatedAt: 0 }`.
 * 4. No divergence (none): a local setting queued for sync retry keeps its local value through initialize() and
 *    the popup's syncNow(), which pushes it to sync.
 * 5. A profile whose local syncInitialized is already true never gets the merge prompt from initialize(), even when
 *    local and cloud hold different content under an equal updatedAt.
 */

const K = StorageManager.KEYS;

const LOCAL_P1 = { id: 'p1', name: 'LocalName', content: 'local content', createdAt: 1, updatedAt: 100 };
const SYNC_P1 = { id: 'p1', name: 'SyncName', content: 'sync content', createdAt: 1, updatedAt: 100 };

async function readLocal(keys) {
    return chrome.storage.local.get(keys);
}

async function seedFirstRun({ local, sync }) {
    // First-run storage: content keys only, never the sync flag keys.
    for (const area of [local, sync]) {
        expect(area).not.toHaveProperty(K.SYNC_INITIALIZED);
        expect(area).not.toHaveProperty(K.SYNC_CONFLICT_PENDING);
    }
    if (Object.keys(local).length > 0) await chrome.storage.local.set(local);
    if (Object.keys(sync).length > 0) await chrome.storage.sync.set(sync);
}

describe('StorageManager.initialize() on a first run (no sync flag keys in either area)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        delete chrome.runtime.lastError;
    });

    describe('manual conflict: same preset id, equal updatedAt, different content', () => {
        beforeEach(async () => {
            await seedFirstRun({
                local: { [K.PRESET_INDEX]: ['p1'], dsPreset_p1: LOCAL_P1 },
                sync: { [K.PRESET_INDEX]: ['p1'], dsPreset_p1: SYNC_P1 },
            });
        });

        it('leaves syncConflictPending true in local, so the popup shows the merge prompt', async () => {
            await StorageManager.initialize();

            const local = await readLocal([K.SYNC_CONFLICT_PENDING]);
            expect(local[K.SYNC_CONFLICT_PENDING], 'local syncConflictPending after first init').toBe(true);
            expect(await StorageManager.checkSyncConflictPending(), 'checkSyncConflictPending() read by popup.js').toBe(true);
        });

        it('keeps the local preset content unchanged through the popup open sequence until the user chooses', async () => {
            await StorageManager.initialize();

            const afterInit = await readLocal(['dsPreset_p1']);
            expect(afterInit.dsPreset_p1, 'local dsPreset_p1 right after first init').toEqual(LOCAL_P1);

            // popup/popup.js open sequence: with a pending conflict it awaits the merge prompt (the user's
            // choice); without one it goes straight on to syncNow(). Model the steps that run before any choice.
            if (!(await StorageManager.checkSyncConflictPending())) {
                await StorageManager.syncNow();
            }

            const beforeChoice = await readLocal(['dsPreset_p1']);
            expect(beforeChoice.dsPreset_p1, 'local dsPreset_p1 while the merge prompt awaits the user').toEqual(LOCAL_P1);
        });

        it('control: still reports the conflict when the popup is reopened before the user chooses', async () => {
            await StorageManager.initialize();
            await StorageManager.initialize();

            expect(await StorageManager.checkSyncConflictPending(), 'checkSyncConflictPending() on second popup open').toBe(true);
            const local = await readLocal(['dsPreset_p1']);
            expect(local.dsPreset_p1, 'local dsPreset_p1 after second init').toEqual(LOCAL_P1);
        });
    });

    describe('syncInitialized is true after the first init', () => {
        it('none: cloud holds the same prompt groups as local', async () => {
            await seedFirstRun({
                local: { [K.PRESET_INDEX]: ['p1'], dsPreset_p1: LOCAL_P1 },
                sync: { [K.PRESET_INDEX]: ['p1'], dsPreset_p1: LOCAL_P1 },
            });

            await StorageManager.initialize();

            const local = await readLocal([K.SYNC_INITIALIZED]);
            expect(local[K.SYNC_INITIALIZED], 'local syncInitialized after first init (none)').toBe(true);
        });

        it('auto: cloud and local diverge with strictly different updatedAt', async () => {
            await seedFirstRun({
                local: {
                    [K.PRESET_INDEX]: ['p1', 'p2'],
                    dsPreset_p1: { id: 'p1', name: 'LocalOnly', content: 'l1', createdAt: 1, updatedAt: 1 },
                    dsPreset_p2: { id: 'p2', name: 'Both', content: 'old', createdAt: 1, updatedAt: 50 },
                },
                sync: {
                    [K.PRESET_INDEX]: ['p2', 'p3'],
                    dsPreset_p2: { id: 'p2', name: 'Both', content: 'new', createdAt: 1, updatedAt: 200 },
                    dsPreset_p3: { id: 'p3', name: 'SyncOnly', content: 's3', createdAt: 1, updatedAt: 300 },
                },
            });

            await StorageManager.initialize();

            const local = await readLocal([K.SYNC_INITIALIZED, K.SYNC_CONFLICT_PENDING]);
            expect(local[K.SYNC_INITIALIZED], 'local syncInitialized after first init (auto)').toBe(true);
            expect(local[K.SYNC_CONFLICT_PENDING], 'auto case never asks the user').not.toBe(true);
        });

        it('fresh: brand-new install, both areas empty', async () => {
            await seedFirstRun({ local: {}, sync: {} });

            await StorageManager.initialize();

            const local = await readLocal([K.SYNC_INITIALIZED]);
            expect(local[K.SYNC_INITIALIZED], 'local syncInitialized after first init (fresh)').toBe(true);
        });
    });

    describe('none: prompt groups agree while a local setting still waits for its sync retry', () => {
        it('keeps the unsynced local setting through the popup open sequence', async () => {
            // A sync-quota fallback left the user's dsChatWidth change in local only, queued in dsLocalAuth for
            // retrySync() (docs/architecture/STORAGE.md). The first-sync detection compares prompt groups and their
            // order only, so this profile has no divergence: initialize() just marks sync as initialized
            // (Sync Conflict Logic step 5), and the popup's syncNow() then pushes the queued local value.
            await seedFirstRun({
                local: { [K.PRESET_INDEX]: ['p1'], dsPreset_p1: LOCAL_P1, [K.CHAT_WIDTH]: 90, [K.LOCAL_AUTHORITATIVE]: [K.CHAT_WIDTH] },
                sync: { [K.PRESET_INDEX]: ['p1'], dsPreset_p1: LOCAL_P1, [K.CHAT_WIDTH]: 70 },
            });

            await StorageManager.initialize();

            const local = await readLocal([K.SYNC_INITIALIZED, K.SYNC_CONFLICT_PENDING, K.CHAT_WIDTH, K.LOCAL_AUTHORITATIVE]);
            expect(local[K.SYNC_INITIALIZED], 'local syncInitialized after first init (none)').toBe(true);
            expect(local[K.SYNC_CONFLICT_PENDING], 'none case never asks the user').not.toBe(true);
            expect(local[K.CHAT_WIDTH], 'local dsChatWidth after first init (none)').toBe(90);
            expect(local[K.LOCAL_AUTHORITATIVE], 'local dsLocalAuth after first init (none)').toEqual([K.CHAT_WIDTH]);

            // popup/popup.js open sequence without a pending conflict.
            const settings = await StorageManager.syncNow();

            expect(settings.chatWidth, 'chatWidth returned by syncNow()').toBe(90);
            const sync = await chrome.storage.sync.get([K.CHAT_WIDTH]);
            expect(sync[K.CHAT_WIDTH], 'sync dsChatWidth after syncNow()').toBe(90);
        });
    });

    describe('auto conflict with no dsPresetOrderMeta in either area', () => {
        it('leaves the resolved merge order in local dsPresetOrderMeta, not the empty default', async () => {
            // Neither area holds an order meta, so per docs/spec/05-data-storage.md Sort Arbitration the merge keeps
            // Map insertion order: locally cached groups first (p1, p2), then the cloud-only group (p3). Local alone
            // would give [p1, p2] and cloud alone [p2, p3]; the default fill of initialize() must not overwrite the
            // meta the conflict resolution wrote with { order: [], orderUpdatedAt: 0 }.
            await seedFirstRun({
                local: {
                    [K.PRESET_INDEX]: ['p1', 'p2'],
                    dsPreset_p1: { id: 'p1', name: 'LocalOnly', content: 'l1', createdAt: 1, updatedAt: 1 },
                    dsPreset_p2: { id: 'p2', name: 'Both', content: 'old', createdAt: 1, updatedAt: 50 },
                },
                sync: {
                    [K.PRESET_INDEX]: ['p2', 'p3'],
                    dsPreset_p2: { id: 'p2', name: 'Both', content: 'new', createdAt: 1, updatedAt: 200 },
                    dsPreset_p3: { id: 'p3', name: 'SyncOnly', content: 's3', createdAt: 1, updatedAt: 300 },
                },
            });
            expect(await chrome.storage.local.get(K.PRESET_ORDER_META)).not.toHaveProperty(K.PRESET_ORDER_META);
            expect(await chrome.storage.sync.get(K.PRESET_ORDER_META)).not.toHaveProperty(K.PRESET_ORDER_META);

            await StorageManager.initialize();

            const local = await readLocal([K.PRESET_ORDER_META, K.PRESET_INDEX, K.SYNC_CONFLICT_PENDING]);
            // Controls: the auto branch ran and wrote the merged index to local.
            expect(local[K.SYNC_CONFLICT_PENDING], 'auto case never asks the user').not.toBe(true);
            expect(local[K.PRESET_INDEX], 'local dsPresetIndex after auto resolution').toEqual(['p1', 'p2', 'p3']);

            expect(local[K.PRESET_ORDER_META]?.order, 'local dsPresetOrderMeta.order after first auto init').toEqual(['p1', 'p2', 'p3']);
        });
    });

    describe('control: upgraded profile that already holds the flag keys as false', () => {
        it('reports the manual conflict (proves the fixture reaches the manual branch)', async () => {
            const flags = { [K.SYNC_INITIALIZED]: false, [K.SYNC_CONFLICT_PENDING]: false };
            await chrome.storage.local.set({ ...flags, [K.PRESET_INDEX]: ['p1'], dsPreset_p1: LOCAL_P1 });
            await chrome.storage.sync.set({ ...flags, [K.PRESET_INDEX]: ['p1'], dsPreset_p1: SYNC_P1 });

            await StorageManager.initialize();

            expect(await StorageManager.checkSyncConflictPending()).toBe(true);
        });
    });

    describe('profile already sync-initialized: the first-sync detection does not run again', () => {
        it('raises no merge prompt although local and cloud hold different content under an equal updatedAt', async () => {
            // The same divergence raises the merge prompt on a first run (see the manual conflict tests above); once
            // local syncInitialized is true, initialize() must leave it to the regular sync paths and never ask again.
            const flags = { [K.SYNC_INITIALIZED]: true, [K.SYNC_CONFLICT_PENDING]: false };
            await chrome.storage.local.set({ ...flags, [K.PRESET_INDEX]: ['p1'], dsPreset_p1: LOCAL_P1 });
            await chrome.storage.sync.set({ ...flags, [K.PRESET_INDEX]: ['p1'], dsPreset_p1: SYNC_P1 });

            await StorageManager.initialize();

            const local = await readLocal([K.SYNC_INITIALIZED, K.SYNC_CONFLICT_PENDING]);
            expect(local[K.SYNC_CONFLICT_PENDING], 'local syncConflictPending after init of a sync-initialized profile').not.toBe(true);
            expect(await StorageManager.checkSyncConflictPending(), 'checkSyncConflictPending() read by popup.js').toBe(false);
            expect(local[K.SYNC_INITIALIZED], 'local syncInitialized stays true').toBe(true);
        });
    });
});
