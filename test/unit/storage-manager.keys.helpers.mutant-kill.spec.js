/**
 * Pure helpers of utils/storage-manager.keys.js, observed through return values and through the public resolveSyncConflict() path.
 *
 * Requirements:
 * - _buildNextMeta(prevMeta, { chunkCount, chunkSizes }): the single helper every chat-map commit uses to build the next chatPresetMapMeta `{ version, chunkCount, chunkSizes[] }`. docs/architecture/STORAGE.md:153 and docs/spec/05-data-storage.md:88 document one rule of it: the version goes up by exactly 1 on every committed write.
 * - _buildNextMeta override contract: the helper JSDoc names the second argument only as "選擇性覆寫" (optional override), and no doc states the rules below; they are the helper's own optional-override contract. An override that is passed replaces the field, including 0 and an empty array (a map trimmed to no chunks); a field that is not passed keeps the previous value as a copy, so editing the next meta never alters the previous snapshot.
 * - Presets read from raw storage: dsPresetIndex lists the ids, each preset lives under dsPreset_<id>. An index id with no stored preset (a dangling id, e.g. a preset key removed on one device before the index caught up) is skipped, so resolveSyncConflict() still completes and the dangling id leaves the index.
 *
 * Only chrome.storage (the in-memory trust-boundary double from the setup file) is faked; every StorageManager bundle is the real module.
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

describe('_buildNextMeta', () => {
    it('increments the version by 1 and keeps chunkCount and a copy of chunkSizes when no override is passed', () => {
        const prevMeta = { version: 3, chunkCount: 2, chunkSizes: [10, 20] };

        const next = StorageManager._buildNextMeta(prevMeta, {});

        expect(next).toStrictEqual({ version: 4, chunkCount: 2, chunkSizes: [10, 20] });
        next.chunkSizes.push(30);
        expect(prevMeta.chunkSizes, 'previous meta must not change when the next meta is edited').toEqual([10, 20]);
    });

    it('uses an override of chunkCount 0 and chunkSizes [] instead of the previous values', () => {
        const prevMeta = { version: 7, chunkCount: 2, chunkSizes: [10, 20] };

        const next = StorageManager._buildNextMeta(prevMeta, { chunkCount: 0, chunkSizes: [] });

        expect(next).toStrictEqual({ version: 8, chunkCount: 0, chunkSizes: [] });
    });

    it('uses non-empty overrides of chunkCount and chunkSizes', () => {
        const prevMeta = { version: 1, chunkCount: 1, chunkSizes: [5] };

        const next = StorageManager._buildNextMeta(prevMeta, { chunkCount: 3, chunkSizes: [7, 8, 9] });

        expect(next).toStrictEqual({ version: 2, chunkCount: 3, chunkSizes: [7, 8, 9] });
    });
});

describe('dangling index id during resolveSyncConflict()', () => {
    it('completes and drops an index id that has no stored preset, keeping the stored preset', async () => {
        const kept = { id: 'kept', name: 'Kept', content: 'c', createdAt: 1, updatedAt: 1 };
        const seed = { dsPresetIndex: ['kept', 'ghost'], dsPreset_kept: kept };
        await chrome.storage.local.set(seed);
        await chrome.storage.sync.set(seed);

        await StorageManager.resolveSyncConflict();

        const sync = await chrome.storage.sync.get(null);
        const local = await chrome.storage.local.get(null);
        expect(sync.dsPresetIndex, 'sync dsPresetIndex').toEqual(['kept']);
        expect(local.dsPresetIndex, 'local dsPresetIndex').toEqual(['kept']);
        expect(sync.dsPreset_kept, 'stored preset').toEqual(kept);
        expect(local.syncConflictPending, 'local syncConflictPending').toBe(false);
    });
});
