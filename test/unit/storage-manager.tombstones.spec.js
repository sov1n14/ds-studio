/**
 * StorageManager — tombstone-based deletion sync (v4.8.x fix)
 *
 * Covers:
 *   - Pure helpers: _mergeTombstones, _pruneTombstones, _isTombstonedAway
 *   - mergePresets() tombstone-aware exclusion (stale local / stale sync / symmetric)
 *   - Newer edit surviving a tombstone (no over-deletion)
 *   - 30-day retention pruning
 *   - savePromptPresets() writing tombstones to both local + sync on delete
 *   - resolveSyncConflict() end-to-end tombstone resolution
 *   - Regression: original cross-device resurrection bug scenario
 *   - _get() persisting a sync-wins PRESET_INDEX/PRESET_ORDER_META to local storage
 *   - Delete-vs-newer-edit race: genuine conflict must not be auto-resolved as a safe deletion
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;
const DAY_MS = 24 * 60 * 60 * 1000;

function makePreset(overrides = {}) {
    return {
        id: 'p1',
        name: 'Preset',
        content: 'content',
        createdAt: 1000,
        updatedAt: 2000,
        ...overrides,
    };
}

describe('StorageManager._mergeTombstones (pure helper)', () => {
    it('unions ids from both sides', () => {
        const local = { a: 100 };
        const sync = { b: 200 };
        const merged = StorageManager._mergeTombstones(local, sync);
        expect(merged).toEqual({ a: 100, b: 200 });
    });

    it('picks the newer deletedAt when the same id exists on both sides', () => {
        const local = { a: 100 };
        const sync = { a: 300 };
        expect(StorageManager._mergeTombstones(local, sync)).toEqual({ a: 300 });

        const local2 = { a: 300 };
        const sync2 = { a: 100 };
        expect(StorageManager._mergeTombstones(local2, sync2)).toEqual({ a: 300 });
    });

    it('handles undefined/null/empty inputs', () => {
        expect(StorageManager._mergeTombstones(undefined, undefined)).toEqual({});
        expect(StorageManager._mergeTombstones(null, null)).toEqual({});
        expect(StorageManager._mergeTombstones({ a: 1 }, null)).toEqual({ a: 1 });
        expect(StorageManager._mergeTombstones(null, { b: 2 })).toEqual({ b: 2 });
    });

    it('does not mutate the input objects', () => {
        const local = { a: 100 };
        const sync = { a: 300 };
        StorageManager._mergeTombstones(local, sync);
        expect(local).toEqual({ a: 100 });
        expect(sync).toEqual({ a: 300 });
    });
});

describe('StorageManager._pruneTombstones (pure helper)', () => {
    it('keeps entries within the 30-day retention window', () => {
        const now = 1_000_000_000_000;
        const tombstones = { a: now - (29 * DAY_MS) };
        expect(StorageManager._pruneTombstones(tombstones, now)).toEqual({ a: now - (29 * DAY_MS) });
    });

    it('prunes entries strictly older than the 30-day retention window', () => {
        const now = 1_000_000_000_000;
        const tombstones = { a: now - (31 * DAY_MS) };
        expect(StorageManager._pruneTombstones(tombstones, now)).toEqual({});
    });

    it('keeps an entry exactly at the retention boundary (now - deletedAt === 30 days)', () => {
        const now = 1_000_000_000_000;
        const tombstones = { a: now - (30 * DAY_MS) };
        expect(StorageManager._pruneTombstones(tombstones, now)).toEqual({ a: now - (30 * DAY_MS) });
    });

    it('handles a mix of expired and live entries', () => {
        const now = 1_000_000_000_000;
        const tombstones = {
            live: now - (1 * DAY_MS),
            expired: now - (40 * DAY_MS),
        };
        expect(StorageManager._pruneTombstones(tombstones, now)).toEqual({ live: now - (1 * DAY_MS) });
    });

    it('handles undefined/null/empty input', () => {
        expect(StorageManager._pruneTombstones(undefined)).toEqual({});
        expect(StorageManager._pruneTombstones(null)).toEqual({});
        expect(StorageManager._pruneTombstones({})).toEqual({});
    });
});

describe('StorageManager._isTombstonedAway (pure decision fn)', () => {
    it('returns false when no tombstone exists for the id', () => {
        expect(StorageManager._isTombstonedAway({}, 'a', 100)).toBe(false);
        expect(StorageManager._isTombstonedAway({ b: 100 }, 'a', 100)).toBe(false);
    });

    it('returns true when deletedAt >= referenceUpdatedAt (stale content, deletion wins)', () => {
        expect(StorageManager._isTombstonedAway({ a: 500 }, 'a', 100)).toBe(true);
        expect(StorageManager._isTombstonedAway({ a: 500 }, 'a', 500)).toBe(true); // equal → still tombstoned
    });

    it('returns false when referenceUpdatedAt is strictly newer than deletedAt (later edit survives)', () => {
        expect(StorageManager._isTombstonedAway({ a: 100 }, 'a', 500)).toBe(false);
    });

    it('treats a missing/undefined referenceUpdatedAt as 0', () => {
        expect(StorageManager._isTombstonedAway({ a: 1 }, 'a', undefined)).toBe(true);
        expect(StorageManager._isTombstonedAway({ a: 0 }, 'a', undefined)).toBe(true);
    });
});

describe('StorageManager.mergePresets() — tombstone-aware exclusion', () => {
    it('tombstone wins over stale local data (older updatedAt than deletion time)', () => {
        const base = [makePreset({ id: 'a', updatedAt: 100 })]; // stale local copy
        const incoming = []; // sync no longer has it
        const tombstones = { a: 200 }; // deleted after the local copy's last edit
        const result = StorageManager.mergePresets(base, incoming, undefined, undefined, tombstones);
        expect(result.map(p => p.id)).not.toContain('a');
        expect(result).toHaveLength(0);
    });

    it('tombstone wins over stale sync data (symmetric case)', () => {
        const base = []; // local no longer has it
        const incoming = [makePreset({ id: 'a', updatedAt: 100 })]; // stale sync copy
        const tombstones = { a: 200 };
        const result = StorageManager.mergePresets(base, incoming, undefined, undefined, tombstones);
        expect(result.map(p => p.id)).not.toContain('a');
        expect(result).toHaveLength(0);
    });

    it('excludes a tombstoned id even when one side still carries the full preset body', () => {
        // Base still has the full body for 'a'; incoming does not mention it at all.
        const base = [
            makePreset({ id: 'a', updatedAt: 100 }),
            makePreset({ id: 'b', updatedAt: 100 }),
        ];
        const incoming = [makePreset({ id: 'b', updatedAt: 100 })];
        const tombstones = { a: 999 };
        const result = StorageManager.mergePresets(base, incoming, undefined, undefined, tombstones);
        expect(result.map(p => p.id)).toEqual(['b']);
    });

    it('a later edit with a NEWER updatedAt than the tombstone survives (no over-deletion)', () => {
        // 'a' was deleted at t=100, but then re-edited (or recreated) on the other
        // side at t=500 — the newer content must NOT be dropped by the tombstone.
        const base = [];
        const incoming = [makePreset({ id: 'a', updatedAt: 500, name: 'Revived' })];
        const tombstones = { a: 100 };
        const result = StorageManager.mergePresets(base, incoming, undefined, undefined, tombstones);
        expect(result.map(p => p.id)).toEqual(['a']);
        expect(result[0].name).toBe('Revived');
    });

    it('a later edit on the base side with a newer updatedAt than the tombstone also survives', () => {
        const base = [makePreset({ id: 'a', updatedAt: 500, name: 'EditedLocally' })];
        const incoming = [];
        const tombstones = { a: 100 };
        const result = StorageManager.mergePresets(base, incoming, undefined, undefined, tombstones);
        expect(result.map(p => p.id)).toEqual(['a']);
        expect(result[0].name).toBe('EditedLocally');
    });

    it('works with no tombstones param (backward compatible, defaults to {})', () => {
        const base = [makePreset({ id: 'a', updatedAt: 100 })];
        const incoming = [];
        const result = StorageManager.mergePresets(base, incoming);
        expect(result.map(p => p.id)).toEqual(['a']);
    });
});

describe('StorageManager.recordPresetTombstones()', () => {
    beforeEach(() => {
        delete chrome.runtime.lastError;
    });

    it('records a tombstone entry with the current timestamp for each deleted id', async () => {
        const before = Date.now();
        await StorageManager.recordPresetTombstones(['a', 'b']);
        const after = Date.now();

        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        const tombstones = localAfter[K.PRESET_TOMBSTONES];
        expect(tombstones.a).toBeGreaterThanOrEqual(before);
        expect(tombstones.a).toBeLessThanOrEqual(after);
        expect(tombstones.b).toBeGreaterThanOrEqual(before);
    });

    it('is a no-op when deletedIds is empty or undefined', async () => {
        await StorageManager.recordPresetTombstones([]);
        await StorageManager.recordPresetTombstones(undefined);
        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        expect(localAfter[K.PRESET_TOMBSTONES]).toBeUndefined();
    });

    it('merges with existing tombstones rather than overwriting them', async () => {
        const existingDeletedAt = Date.now() - (1 * DAY_MS); // within retention window
        await chrome.storage.local.set({ [K.PRESET_TOMBSTONES]: { existing: existingDeletedAt } });
        await StorageManager.recordPresetTombstones(['new-id']);
        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        expect(localAfter[K.PRESET_TOMBSTONES].existing).toBe(existingDeletedAt);
        expect(localAfter[K.PRESET_TOMBSTONES]['new-id']).toBeTypeOf('number');
    });

    it('prunes expired tombstones as a side effect while recording new ones', async () => {
        const now = Date.now();
        await chrome.storage.local.set({
            [K.PRESET_TOMBSTONES]: { stale: now - (40 * DAY_MS) },
        });
        await StorageManager.recordPresetTombstones(['fresh']);
        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        expect(localAfter[K.PRESET_TOMBSTONES]).not.toHaveProperty('stale');
        expect(localAfter[K.PRESET_TOMBSTONES]).toHaveProperty('fresh');
    });
});

describe('StorageManager.savePromptPresets() — tombstone write on delete', () => {
    beforeEach(() => {
        delete chrome.runtime.lastError;
    });

    it('writes a tombstone entry to both local and sync when deleting a preset', async () => {
        const presetA = makePreset({ id: 'a' });
        const presetB = makePreset({ id: 'b' });

        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['a', 'b'],
            dsPreset_a: presetA,
            dsPreset_b: presetB,
        });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['a', 'b'] });

        // Delete 'b'
        await StorageManager.savePromptPresets([presetA]);

        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        const syncAfter = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);

        expect(localAfter[K.PRESET_TOMBSTONES]).toHaveProperty('b');
        expect(syncAfter[K.PRESET_TOMBSTONES]).toHaveProperty('b');

        // Preset body itself is gone from both storages
        const syncPresetAfter = await chrome.storage.sync.get(['dsPreset_b']);
        const localPresetAfter = await chrome.storage.local.get(['dsPreset_b']);
        expect(syncPresetAfter.dsPreset_b).toBeUndefined();
        expect(localPresetAfter.dsPreset_b).toBeUndefined();
    });

    it('does not write a tombstone when no ids are deleted', async () => {
        const presetA = makePreset({ id: 'a' });
        await chrome.storage.sync.set({ [K.PRESET_INDEX]: ['a'], dsPreset_a: presetA });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['a'] });

        await StorageManager.savePromptPresets([presetA]);

        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        expect(localAfter[K.PRESET_TOMBSTONES]).toBeUndefined();
    });
});

describe('StorageManager.resolveSyncConflict() — tombstone end-to-end resolution', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('a tombstone newer than a stale preset copy on the other side removes the preset and does not resurrect it', async () => {
        const now = Date.now();
        const presetA = makePreset({ id: 'a', updatedAt: now - (2 * DAY_MS) });
        const presetB = makePreset({ id: 'b', updatedAt: now - (2 * DAY_MS) });

        // Device A: deleted 'a', recorded a tombstone (newer than presetA's updatedAt), no longer has it in its index.
        await chrome.storage.sync.set({
            [K.SYNC_CONFLICT_PENDING]: false,
            [K.PRESET_INDEX]: ['b'],
            dsPreset_b: presetB,
            [K.PRESET_TOMBSTONES]: { a: now - (1 * DAY_MS) },
            [K.PRESET_ORDER_META]: { order: ['b'], orderUpdatedAt: now - (1 * DAY_MS) },
        });

        // Device B: stale local snapshot still has 'a' and 'b' from before the deletion propagated.
        await chrome.storage.local.set({
            [K.SYNC_CONFLICT_PENDING]: true,
            [K.PRESET_INDEX]: ['a', 'b'],
            dsPreset_a: presetA,
            dsPreset_b: presetB,
            [K.PRESET_TOMBSTONES]: {},
            [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: now - (3 * DAY_MS) },
        });

        await StorageManager.resolveSyncConflict();

        const settings = await StorageManager.getSettings();
        expect(settings.promptPresets.map(p => p.id)).not.toContain('a');
        expect(settings.promptPresets.map(p => p.id)).toContain('b');

        // Not re-persisted/re-pushed to either storage
        const syncAfter = await chrome.storage.sync.get(['dsPreset_a']);
        const localAfter = await chrome.storage.local.get(['dsPreset_a']);
        expect(syncAfter.dsPreset_a).toBeUndefined();
        expect(localAfter.dsPreset_a).toBeUndefined();
    });

    it('REGRESSION: device A deletes presets; device B (stale local index) does not resurrect them after resolveSyncConflict()', async () => {
        const now = Date.now();
        const survivor = makePreset({ id: 'keep', updatedAt: now - (2 * DAY_MS) });
        const deletedOne = makePreset({ id: 'gone1', updatedAt: now - (2 * DAY_MS) });
        const deletedTwo = makePreset({ id: 'gone2', updatedAt: now - (2 * DAY_MS) });

        // Device A already deleted 'gone1' and 'gone2' and pushed tombstones + a shrunk index to sync.
        await chrome.storage.sync.set({
            [K.SYNC_CONFLICT_PENDING]: false,
            [K.PRESET_INDEX]: ['keep'],
            dsPreset_keep: survivor,
            [K.PRESET_TOMBSTONES]: {
                gone1: now - (1 * DAY_MS),
                gone2: now - (1 * DAY_MS),
            },
            [K.PRESET_ORDER_META]: { order: ['keep'], orderUpdatedAt: now - (1 * DAY_MS) },
        });

        // Device B reopens popup with its pre-deletion local snapshot still intact (this was the bug:
        // popup reopen would read this stale local index and treat gone1/gone2 as "still present").
        await chrome.storage.local.set({
            [K.SYNC_CONFLICT_PENDING]: true,
            [K.PRESET_INDEX]: ['keep', 'gone1', 'gone2'],
            dsPreset_keep: survivor,
            dsPreset_gone1: deletedOne,
            dsPreset_gone2: deletedTwo,
            [K.PRESET_TOMBSTONES]: {},
            [K.PRESET_ORDER_META]: { order: ['keep', 'gone1', 'gone2'], orderUpdatedAt: now - (3 * DAY_MS) },
        });

        await StorageManager.resolveSyncConflict();

        const settings = await StorageManager.getSettings();
        const ids = settings.promptPresets.map(p => p.id);
        expect(ids).toEqual(['keep']);
        expect(ids).not.toContain('gone1');
        expect(ids).not.toContain('gone2');
    });

    it('DELETE-VS-NEWER-EDIT RACE: a genuine conflict is not mishandled — content edited after deletion on the other device survives', async () => {
        // Device A deleted the preset at t = now-1day.
        const now = Date.now();
        const deletionTs = now - (1 * DAY_MS);
        // Device B edited the SAME preset AFTER the deletion timestamp (updatedAt newer than deletedAt).
        const editedPreset = makePreset({ id: 'a', updatedAt: now, name: 'Edited-After-Delete' });

        await chrome.storage.sync.set({
            [K.SYNC_CONFLICT_PENDING]: false,
            [K.PRESET_INDEX]: [],
            [K.PRESET_TOMBSTONES]: { a: deletionTs },
            [K.PRESET_ORDER_META]: { order: [], orderUpdatedAt: deletionTs },
        });

        await chrome.storage.local.set({
            [K.SYNC_CONFLICT_PENDING]: true,
            [K.PRESET_INDEX]: ['a'],
            dsPreset_a: editedPreset,
            [K.PRESET_TOMBSTONES]: {},
            [K.PRESET_ORDER_META]: { order: ['a'], orderUpdatedAt: now },
        });

        await StorageManager.resolveSyncConflict();

        const settings = await StorageManager.getSettings();
        const survivor = settings.promptPresets.find(p => p.id === 'a');
        expect(survivor).toBeDefined();
        expect(survivor.name).toBe('Edited-After-Delete');
    });
});

describe('StorageManager.clearPresetTombstones()', () => {
    beforeEach(() => {
        delete chrome.runtime.lastError;
    });

    it('removes tombstone entries for exact matching ids only, leaving other ids intact', async () => {
        const now = Date.now();
        await chrome.storage.local.set({ [K.PRESET_TOMBSTONES]: { a: now, b: now } });
        await chrome.storage.sync.set({ [K.PRESET_TOMBSTONES]: { a: now, b: now } });

        await StorageManager.clearPresetTombstones(['a']);

        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        const syncAfter = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
        expect(localAfter[K.PRESET_TOMBSTONES]).not.toHaveProperty('a');
        expect(localAfter[K.PRESET_TOMBSTONES]).toHaveProperty('b');
        expect(syncAfter[K.PRESET_TOMBSTONES]).not.toHaveProperty('a');
        expect(syncAfter[K.PRESET_TOMBSTONES]).toHaveProperty('b');
    });

    it('silently no-ops for ids not present in the tombstone map', async () => {
        const now = Date.now();
        await chrome.storage.local.set({ [K.PRESET_TOMBSTONES]: { a: now } });
        await chrome.storage.sync.set({ [K.PRESET_TOMBSTONES]: { a: now } });

        await expect(StorageManager.clearPresetTombstones(['not-there'])).resolves.not.toThrow();

        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        const syncAfter = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
        expect(localAfter[K.PRESET_TOMBSTONES]).toEqual({ a: now });
        expect(syncAfter[K.PRESET_TOMBSTONES]).toEqual({ a: now });
    });

    it('does not write to storage at all when no ids match (no unintended writes)', async () => {
        const now = Date.now();
        await chrome.storage.local.set({ [K.PRESET_TOMBSTONES]: { a: now } });

        const setSpy = vi.spyOn(chrome.storage.local, 'set');
        await StorageManager.clearPresetTombstones(['not-there']);
        expect(setSpy).not.toHaveBeenCalled();
        setSpy.mockRestore();
    });

    it('persists the update to both chrome.storage.local and chrome.storage.sync', async () => {
        const now = Date.now();
        await chrome.storage.local.set({ [K.PRESET_TOMBSTONES]: { a: now } });
        await chrome.storage.sync.set({ [K.PRESET_TOMBSTONES]: { a: now } });

        await StorageManager.clearPresetTombstones(['a']);

        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        const syncAfter = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
        expect(localAfter[K.PRESET_TOMBSTONES]).toEqual({});
        expect(syncAfter[K.PRESET_TOMBSTONES]).toEqual({});
    });

    it('is a safe no-op for empty or undefined ids array', async () => {
        const now = Date.now();
        await chrome.storage.local.set({ [K.PRESET_TOMBSTONES]: { a: now } });

        await expect(StorageManager.clearPresetTombstones([])).resolves.not.toThrow();
        await expect(StorageManager.clearPresetTombstones(undefined)).resolves.not.toThrow();

        const localAfter = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        expect(localAfter[K.PRESET_TOMBSTONES]).toEqual({ a: now });
    });
});

describe('StorageManager._get() — sync-wins PRESET_INDEX/PRESET_ORDER_META persisted to local', () => {
    beforeEach(() => {
        delete chrome.runtime.lastError;
    });

    it('persists the winning sync index+meta to chrome.storage.local, not just in-memory', async () => {
        const now = Date.now();
        await chrome.storage.local.set({
            [K.PRESET_INDEX]: ['a', 'b'],
            [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: now - (1 * DAY_MS) },
        });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['b'],
            [K.PRESET_ORDER_META]: { order: ['b'], orderUpdatedAt: now },
        });

        const result = await StorageManager._get([K.PRESET_INDEX]);
        expect(result[K.PRESET_INDEX]).toEqual(['b']);

        // The fix: the sync-side winner must be persisted to local storage,
        // not just returned in-memory by this call.
        const localAfter = await chrome.storage.local.get([K.PRESET_INDEX, K.PRESET_ORDER_META]);
        expect(localAfter[K.PRESET_INDEX]).toEqual(['b']);
        expect(localAfter[K.PRESET_ORDER_META]).toEqual({ order: ['b'], orderUpdatedAt: now });
    });

    it('does NOT persist to local when local already wins (no unnecessary write)', async () => {
        const now = Date.now();
        await chrome.storage.local.set({
            [K.PRESET_INDEX]: ['a'],
            [K.PRESET_ORDER_META]: { order: ['a'], orderUpdatedAt: now },
        });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['b'],
            [K.PRESET_ORDER_META]: { order: ['b'], orderUpdatedAt: now - (1 * DAY_MS) },
        });

        const setSpy = vi.spyOn(StorageManager, '_safeSet');
        await StorageManager._get([K.PRESET_INDEX]);

        const indexPersistCalls = setSpy.mock.calls.filter(c => c[0] === 'local' && K.PRESET_INDEX in c[1]);
        expect(indexPersistCalls).toHaveLength(0);
    });
});
