import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('retrySync — pull after push & stale-push prevention', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('returns success when there are no pending keys', async () => {
        await chrome.storage.local.set({ [K.LOCAL_AUTHORITATIVE]: [] });
        const result = await StorageManager.retrySync();
        expect(result.success).toBe(true);
        expect(result.remainingUnsyncedCount).toBe(0);
    });

    it('does NOT push local preset when cloud version is newer', async () => {
        // Local has stale preset, cloud has newer version
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'StaleLocal', content: 'stale', createdAt: 1, updatedAt: 50 },
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'NewCloud', content: 'new', createdAt: 1, updatedAt: 200 },
        });

        await StorageManager.retrySync();

        // Cloud should still have the newer value (local stale data must NOT overwrite it)
        const syncAfter = await chrome.storage.sync.get(['dsPreset_p1']);
        expect(syncAfter.dsPreset_p1.name).toBe('NewCloud');
    });

    it('does NOT push local PRESET_INDEX when cloud order is newer', async () => {
        const localTs = 100;
        const syncTs  = 500;
        // Both sides have the same two presets; only the order differs
        const presetA = { id: 'a', name: 'A', content: 'a', createdAt: 1, updatedAt: 1 };
        const presetB = { id: 'b', name: 'B', content: 'b', createdAt: 2, updatedAt: 2 };
        await chrome.storage.local.set({
            [K.PRESET_INDEX]: ['a', 'b'],
            [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: localTs },
            [K.LOCAL_AUTHORITATIVE]: [K.PRESET_INDEX],
            dsPreset_a: presetA,
            dsPreset_b: presetB,
        });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['b', 'a'],
            [K.PRESET_ORDER_META]: { order: ['b', 'a'], orderUpdatedAt: syncTs },
            dsPreset_a: presetA,
            dsPreset_b: presetB,
        });

        await StorageManager.retrySync();

        // Cloud order should remain intact — local stale order must NOT overwrite it
        // (After retrySync triggers auto-resolve, sync order from the winner meta ['b','a'] applies)
        const syncAfter = await chrome.storage.sync.get([K.PRESET_INDEX]);
        expect(syncAfter[K.PRESET_INDEX]).toEqual(['b', 'a']);
    });

    it('pushes local preset when local version is at least as new as cloud', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'NewLocal', content: 'new', createdAt: 1, updatedAt: 300 },
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'OldCloud', content: 'old', createdAt: 1, updatedAt: 100 },
        });

        await StorageManager.retrySync();

        const syncAfter = await chrome.storage.sync.get(['dsPreset_p1']);
        expect(syncAfter.dsPreset_p1.name).toBe('NewLocal');
    });
});
