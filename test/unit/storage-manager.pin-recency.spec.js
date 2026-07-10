/**
 * StorageManager — pin-on-read removal (sync refactor Step 2, report.md §4.2)
 *
 * `_shouldPinLocalPreset()` has been deleted (dead code, zero callers) as part
 * of removing the dsLocalAuth pin-on-read override layer from `_get()`.
 * `_get()` now follows pure per-item `updatedAt` recency (via `_pickNewerPreset`)
 * regardless of whether a key is parked in dsLocalAuth. Parking only matters to
 * `_set()`'s retry-queue path (see storage-manager.sync-conflict.spec.js).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

function makePreset(overrides = {}) {
    return {
        id: 'p1',
        name: 'Helper',
        content: 'helpful content',
        createdAt: 1000,
        updatedAt: 2000,
        ...overrides,
    };
}

describe('StorageManager._get() — dsPreset recency is independent of dsLocalAuth parking', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        delete chrome.runtime.lastError;
    });

    it('accepts newer sync content even when the key is parked in dsLocalAuth', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'StaleLocal', content: 'stale', updatedAt: 50 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: makePreset({ name: 'NewerSync', content: 'newer', updatedAt: 999 }),
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1.name).toBe('NewerSync');
    });

    it('parked + equal-ts + differing content → earlier-createdAt copy wins (pure recency, no pin)', async () => {
        // Local has LATER createdAt than sync. A pin-on-read layer would have
        // ignored this and kept local just because it's parked; pure recency
        // (via _pickNewerPreset's createdAt tiebreak) picks sync instead.
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'Local', content: 'local', updatedAt: 100, createdAt: 5 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: makePreset({ name: 'Sync', content: 'sync', updatedAt: 100, createdAt: 1 }),
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        // sync createdAt (1) is earlier → sync wins per _pickNewerPreset contract
        expect(result.dsPreset_p1.name).toBe('Sync');
    });

    it('parked + sync missing → local is returned (nothing to compare against, not a pin)', async () => {
        // _get() only reconciles a key when BOTH local and sync have a value
        // for it (`if (localPreset === undefined || syncPreset === undefined) continue;`).
        // With no sync copy at all, merged already equals local — this passes
        // because there's nothing to override it with, not because of any pin.
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'OnlyLocal', content: 'local-only', updatedAt: 10 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        // No sync copy at all

        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1.name).toBe('OnlyLocal');
    });
});
