/**
 * StorageManager.retrySync() — tombstone merge guard (red-phase test)
 *
 * Requirement: pushing local dsPresetTombstones during retrySync() must UNION
 * with whatever tombstones already exist in chrome.storage.sync, never
 * replace them wholesale. Two devices can each delete a different preset
 * while offline; a wholesale-replace push would silently resurrect whichever
 * preset the other device deleted.
 *
 * Tombstone entry shape learned from test/unit/storage-manager.tombstones.spec.js:1-4
 *   { [id]: { ts: number, deleted: boolean } }
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('StorageManager.retrySync() — tombstone merge guard (no resurrection)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('REQUIREMENT 1: pushing local tombstones must not erase cloud tombstones for a different id', async () => {
        const now = Date.now();
        await chrome.storage.local.set({
            [K.PRESET_TOMBSTONES]: { 'local-deleted': { ts: now, deleted: true } },
            [K.LOCAL_AUTHORITATIVE]: [K.PRESET_TOMBSTONES],
        });
        await chrome.storage.sync.set({
            [K.PRESET_TOMBSTONES]: { 'cloud-deleted': { ts: now - 1000, deleted: true } },
        });

        await StorageManager.retrySync();

        const syncAfter = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
        const ids = Object.keys(syncAfter[K.PRESET_TOMBSTONES] || {});
        expect(ids).toContain('local-deleted');
        expect(ids).toContain('cloud-deleted'); // the defect: this is the one that goes missing
    });

    it('REQUIREMENT 2: when the same deletion id exists on both sides with different timestamps, the merged cloud entry must keep the NEWER timestamp', async () => {
        // A tombstone's `ts` decides whether a later edit is allowed to resurrect the preset.
        // If two devices recorded the same deletion at different times, keeping the newer
        // `ts` reflects the most recent user intent to delete; keeping the older one would
        // let an intervening edit wrongly resurrect it. The newer timestamp is deliberately
        // placed on the CLOUD side here — a "local value replaces cloud wholesale"
        // implementation would clobber it down to the older local `ts`, which is exactly
        // the defect this case must catch.
        await chrome.storage.local.set({
            [K.PRESET_TOMBSTONES]: { 'shared-deleted': { ts: 1000, deleted: true } },
            [K.LOCAL_AUTHORITATIVE]: [K.PRESET_TOMBSTONES],
        });
        await chrome.storage.sync.set({
            [K.PRESET_TOMBSTONES]: { 'shared-deleted': { ts: 5000, deleted: true } },
        });

        await StorageManager.retrySync();

        const syncAfter = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
        expect(syncAfter[K.PRESET_TOMBSTONES]['shared-deleted'].ts).toBe(5000);
    });

    it('REQUIREMENT 3: an empty local tombstone set must not wipe out cloud-only tombstones', async () => {
        const now = Date.now();
        await chrome.storage.local.set({
            [K.PRESET_TOMBSTONES]: {},
            [K.LOCAL_AUTHORITATIVE]: [K.PRESET_TOMBSTONES],
        });
        await chrome.storage.sync.set({
            [K.PRESET_TOMBSTONES]: { 'cloud-deleted': { ts: now, deleted: true } },
        });

        await StorageManager.retrySync();

        const syncAfter = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
        const ids = Object.keys(syncAfter[K.PRESET_TOMBSTONES] || {});
        expect(ids).toContain('cloud-deleted');
    });
});
