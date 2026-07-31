/**
 * StorageManager.retrySync() — dsPresetOrderMeta push guard
 *
 * retrySync() must apply the same "newer wins" comparison to a directly
 * pending dsPresetOrderMeta entry that it applies to dsPreset_* items: a
 * stale local order metadata must never clobber a newer cloud copy, while a
 * genuinely newer local copy must still be pushed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

describe('retrySync — order meta push guard', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('Requirement 1: stale local order meta must NOT overwrite newer cloud order meta', async () => {
        await chrome.storage.local.set({
            dsPresetOrderMeta: { order: ['a', 'b', 'c'], orderUpdatedAt: 1000 },
            dsLocalAuth: ['dsPresetOrderMeta'],
        });
        await chrome.storage.sync.set({
            dsPresetOrderMeta: { order: ['c', 'b', 'a'], orderUpdatedAt: 5000 },
        });

        await StorageManager.retrySync();

        const syncAfter = await chrome.storage.sync.get(['dsPresetOrderMeta']);
        expect(syncAfter.dsPresetOrderMeta.orderUpdatedAt).toBe(5000);
        expect(syncAfter.dsPresetOrderMeta.order).toEqual(['c', 'b', 'a']);
    });

    it('Requirement 2: genuinely newer local order meta MUST still be pushed to cloud', async () => {
        await chrome.storage.local.set({
            dsPresetOrderMeta: { order: ['a', 'b', 'c'], orderUpdatedAt: 5000 },
            dsLocalAuth: ['dsPresetOrderMeta'],
        });
        await chrome.storage.sync.set({
            dsPresetOrderMeta: { order: ['c', 'b', 'a'], orderUpdatedAt: 1000 },
        });

        await StorageManager.retrySync();

        const syncAfter = await chrome.storage.sync.get(['dsPresetOrderMeta']);
        expect(syncAfter.dsPresetOrderMeta.orderUpdatedAt).toBe(5000);
        expect(syncAfter.dsPresetOrderMeta.order).toEqual(['a', 'b', 'c']);
    });

    it('Requirement 3: guard holds when dsPresetOrderMeta pends ALONE (dsPresetIndex absent from the pending list)', async () => {
        // No existing test isolates this: storage-manager.retry-sync-pull.spec.js's
        // "does NOT push local PRESET_INDEX when cloud order is newer" test pends
        // dsLocalAuth: [PRESET_INDEX] (not PRESET_ORDER_META itself) and relies on
        // the trailing whole-store resolveSyncConflict() pass to reconcile order
        // meta. Here dsPresetIndex is deliberately absent from dsLocalAuth entirely
        // and dsPresetOrderMeta is the ONLY pending key, exercising the direct
        // per-key push decision for dsPresetOrderMeta on its own.
        await chrome.storage.local.set({
            dsPresetOrderMeta: { order: ['a', 'b', 'c'], orderUpdatedAt: 1000 },
            dsLocalAuth: ['dsPresetOrderMeta'],
        });
        await chrome.storage.sync.set({
            dsPresetOrderMeta: { order: ['c', 'b', 'a'], orderUpdatedAt: 5000 },
        });

        await StorageManager.retrySync();

        const syncAfter = await chrome.storage.sync.get(['dsPresetOrderMeta']);
        expect(syncAfter.dsPresetOrderMeta.orderUpdatedAt).toBe(5000);
        expect(syncAfter.dsPresetOrderMeta.order).toEqual(['c', 'b', 'a']);
    });
});
