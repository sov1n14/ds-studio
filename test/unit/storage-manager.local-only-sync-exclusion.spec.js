import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { populateDefaults } from '../helpers/storage-manager-defaults.js';

const K = StorageManager.KEYS;

/**
 * Requirement (user decision): the device bookkeeping keys dsLocalAuth and dsOversizedKeys, and the restore records restored_messages, are local only (docs/spec/05-data-storage.md, docs/architecture/STORAGE.md). No StorageManager write path that copies local keys into chrome.storage.sync may write them there: neither the initialize() default fill and migration push, nor the resolveSyncConflict() write-back. Their local values stay as they were. Stale copies already in sync are out of scope.
 *
 * Keys are spelled as the documented storage names, so the test does not depend on how the implementation names its constants.
 */
const LOCAL_AUTH = 'dsLocalAuth';
const OVERSIZED = 'dsOversizedKeys';
const RESTORED = 'restored_messages';

/** Make INCLUDE_THINKING a non-excluded key that local holds and sync lacks, so the migration push has one ordinary key to push. */
async function arrangeProbeMissingInSync() {
    await chrome.storage.local.set({ [K.INCLUDE_THINKING]: false });
    await chrome.storage.sync.remove(K.INCLUDE_THINKING);
}

/** Drive a real quota fallback: a sync write that fails lands in local and is queued in dsLocalAuth. */
async function arrangeQuotaFallback() {
    await populateDefaults();
    await arrangeProbeMissingInSync();
    chrome.storage.sync.setQuotaError(true);
    await StorageManager.savePinnedPresetId('p1');
    chrome.storage.sync.setQuotaError(false);
    delete chrome.runtime.lastError;
    const local = await chrome.storage.local.get(LOCAL_AUTH);
    expect(local[LOCAL_AUTH], 'precondition: the quota fallback queued pinnedPresetId in local dsLocalAuth').toEqual([K.PINNED_PRESET_ID]);
    const sync = await chrome.storage.sync.get(LOCAL_AUTH);
    expect(sync, 'precondition: sync holds no dsLocalAuth before initialize()').not.toHaveProperty(LOCAL_AUTH);
}

describe('StorageManager: local-only keys never reach chrome.storage.sync', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
        chrome.runtime.sendMessage.mockResolvedValue({ ok: true, map: {} });
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    describe('initialize() migration push', () => {
        it('does not push dsLocalAuth to sync after a quota fallback, and keeps the local queue', async () => {
            await arrangeQuotaFallback();

            await expect(StorageManager.initialize()).resolves.toBeUndefined();

            const syncAfter = await chrome.storage.sync.get(null);
            const localAfter = await chrome.storage.local.get(null);
            expect.soft(syncAfter, 'sync after initialize()').not.toHaveProperty(LOCAL_AUTH);
            expect.soft(localAfter[LOCAL_AUTH], 'local dsLocalAuth after initialize()').toEqual([K.PINNED_PRESET_ID]);
        });

        it('does not push dsOversizedKeys to sync, and keeps the local list', async () => {
            await populateDefaults();
            await arrangeProbeMissingInSync();
            await chrome.storage.local.set({ [OVERSIZED]: ['dsPreset_big'] });

            await expect(StorageManager.initialize()).resolves.toBeUndefined();

            const syncAfter = await chrome.storage.sync.get(null);
            const localAfter = await chrome.storage.local.get(null);
            expect.soft(syncAfter, 'sync after initialize()').not.toHaveProperty(OVERSIZED);
            expect.soft(localAfter[OVERSIZED], 'local dsOversizedKeys after initialize()').toEqual(['dsPreset_big']);
        });

        it('guard: still pushes an ordinary setting that sync lacks, in the same quota-fallback run', async () => {
            await arrangeQuotaFallback();

            await expect(StorageManager.initialize()).resolves.toBeUndefined();

            const syncAfter = await chrome.storage.sync.get(K.INCLUDE_THINKING);
            expect(syncAfter[K.INCLUDE_THINKING], 'INCLUDE_THINKING pushed to sync, so the migration push ran').toBe(false);
        });
    });

    describe('initialize() default fill', () => {
        it('does not write restored_messages to sync when local lacks it, and still fills it locally', async () => {
            await populateDefaults();
            await chrome.storage.local.remove(RESTORED);

            await expect(StorageManager.initialize()).resolves.toBeUndefined();

            const syncAfter = await chrome.storage.sync.get(null);
            const localAfter = await chrome.storage.local.get(null);
            expect.soft(syncAfter, 'sync after initialize()').not.toHaveProperty(RESTORED);
            expect.soft(localAfter[RESTORED], 'local restored_messages after initialize()').toEqual({});
        });
    });

    describe('resolveSyncConflict() write-back', () => {
        // Local dsLocalAuth is not asserted here: the write-back pushes pinnedPresetId to sync, and a successful sync write removes its keys from dsLocalAuth (docs/architecture/STORAGE.md, Write path, On Success).
        it('writes neither dsLocalAuth nor dsOversizedKeys to sync, and keeps the local dsOversizedKeys list', async () => {
            await populateDefaults();
            await chrome.storage.local.set({
                [K.SYNC_CONFLICT_PENDING]: true,
                [LOCAL_AUTH]: [K.PINNED_PRESET_ID],
                [OVERSIZED]: ['dsPreset_big'],
                [K.PRESET_INDEX]: ['a'],
                dsPreset_a: { id: 'a', name: 'A', content: 'OLD-LOCAL', createdAt: 1, updatedAt: 100 },
            });
            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['a'],
                dsPreset_a: { id: 'a', name: 'A', content: 'NEW-CLOUD', createdAt: 1, updatedAt: 200 },
            });

            await expect(StorageManager.resolveSyncConflict()).resolves.toBeUndefined();

            const syncAfter = await chrome.storage.sync.get(null);
            const localAfter = await chrome.storage.local.get(null);
            expect.soft(syncAfter, 'sync after resolveSyncConflict()').not.toHaveProperty(LOCAL_AUTH);
            expect.soft(syncAfter, 'sync after resolveSyncConflict()').not.toHaveProperty(OVERSIZED);
            expect.soft(localAfter[OVERSIZED], 'local dsOversizedKeys after resolveSyncConflict()').toEqual(['dsPreset_big']);
        });
    });
});
