/**
 * StorageManager — structural write guard (resilience fix)
 *
 * Covers:
 *   - _shouldPushPreset() pure matrix
 *   - savePromptPresets() no longer unconditionally re-pushes unchanged
 *     preset bodies on structural operations (reorder / delete / add / rename)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
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

// ─────────────────────────────────────────────────────────────────────────────
// _shouldPushPreset — pure matrix
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager._shouldPushPreset (pure helper)', () => {
    it('returns true when syncPreset is undefined (never pushed before)', () => {
        const local = makePreset();
        expect(StorageManager._shouldPushPreset(local, undefined)).toBe(true);
    });

    it('returns false when local and sync are byte-identical', () => {
        const local = makePreset();
        const sync = makePreset();
        expect(StorageManager._shouldPushPreset(local, sync)).toBe(false);
    });

    it('returns true when local is strictly newer than sync', () => {
        const local = makePreset({ updatedAt: 300, content: 'new' });
        const sync = makePreset({ updatedAt: 100, content: 'old' });
        expect(StorageManager._shouldPushPreset(local, sync)).toBe(true);
    });

    it('returns false when sync is strictly newer than local', () => {
        const local = makePreset({ updatedAt: 100, content: 'old' });
        const sync = makePreset({ updatedAt: 300, content: 'new' });
        expect(StorageManager._shouldPushPreset(local, sync)).toBe(false);
    });

    it('equal updatedAt, identical content → false (redundant push skipped)', () => {
        const local = makePreset({ updatedAt: 100, createdAt: 5, content: 'same' });
        const sync = makePreset({ updatedAt: 100, createdAt: 1, content: 'same' });
        expect(StorageManager._shouldPushPreset(local, sync)).toBe(false);
    });

    it('equal updatedAt, differing content, local createdAt earlier → true (local wins tiebreak)', () => {
        const local = makePreset({ updatedAt: 100, createdAt: 1, content: 'l' });
        const sync = makePreset({ updatedAt: 100, createdAt: 5, content: 's' });
        expect(StorageManager._shouldPushPreset(local, sync)).toBe(true);
    });

    it('equal updatedAt, differing content, sync createdAt earlier → false (sync wins tiebreak)', () => {
        const local = makePreset({ updatedAt: 100, createdAt: 5, content: 'l' });
        const sync = makePreset({ updatedAt: 100, createdAt: 1, content: 's' });
        expect(StorageManager._shouldPushPreset(local, sync)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// savePromptPresets — structural-operation write guard
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager.savePromptPresets() — structural write guard', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function presetCallsOf(setSpy) {
        return setSpy.mock.calls.filter(c => {
            const k = Object.keys(c[0])[0];
            return k && k.startsWith('dsPreset_');
        });
    }

    it('reorder with identical bodies in sync → zero dsPreset_* writes, but index+meta written', async () => {
        const presetA = makePreset({ id: 'a', name: 'A', content: 'a' });
        const presetB = makePreset({ id: 'b', name: 'B', content: 'b' });

        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['a', 'b'],
            dsPreset_a: presetA,
            dsPreset_b: presetB,
        });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['a', 'b'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        // Reordered: b, a — bodies unchanged
        await StorageManager.savePromptPresets([presetB, presetA]);

        expect(presetCallsOf(setSpy)).toHaveLength(0);

        const indexCalls = setSpy.mock.calls.filter(c => K.PRESET_INDEX in c[0]);
        const metaCalls = setSpy.mock.calls.filter(c => K.PRESET_ORDER_META in c[0]);
        expect(indexCalls.length).toBeGreaterThan(0);
        expect(metaCalls.length).toBeGreaterThan(0);
        expect(indexCalls[0][0][K.PRESET_INDEX]).toEqual(['b', 'a']);
    });

    it('rename: bump one body updatedAt → only that dsPreset_<id> is pushed', async () => {
        const presetA = makePreset({ id: 'a', name: 'A', content: 'a', updatedAt: 100 });
        const presetB = makePreset({ id: 'b', name: 'B', content: 'b', updatedAt: 100 });

        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['a', 'b'],
            dsPreset_a: presetA,
            dsPreset_b: presetB,
        });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['a', 'b'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        const renamedA = { ...presetA, name: 'A Renamed', updatedAt: 999 };
        await StorageManager.savePromptPresets([renamedA, presetB]);

        const pushed = presetCallsOf(setSpy).map(c => Object.keys(c[0])[0]);
        expect(pushed).toEqual(['dsPreset_a']);
    });

    it('delete: removed id is removed from sync, remaining unchanged bodies are NOT re-pushed', async () => {
        const presetA = makePreset({ id: 'a', name: 'A', content: 'a' });
        const presetB = makePreset({ id: 'b', name: 'B', content: 'b' });

        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['a', 'b'],
            dsPreset_a: presetA,
            dsPreset_b: presetB,
        });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['a', 'b'] });

        const setSpy = vi.spyOn(StorageManager, '_set');
        const removeSpy = vi.spyOn(StorageManager, '_safeRemove');

        // Delete 'b'
        await StorageManager.savePromptPresets([presetA]);

        expect(presetCallsOf(setSpy)).toHaveLength(0);
        expect(removeSpy).toHaveBeenCalledWith('sync', ['dsPreset_b']);
        expect(removeSpy).toHaveBeenCalledWith('local', ['dsPreset_b']);

        const indexCalls = setSpy.mock.calls.filter(c => K.PRESET_INDEX in c[0]);
        const metaCalls = setSpy.mock.calls.filter(c => K.PRESET_ORDER_META in c[0]);
        expect(indexCalls.length).toBeGreaterThan(0);
        expect(metaCalls.length).toBeGreaterThan(0);

        // Tombstone-aware deletion sync fix (v4.8.x): a tombstone for the
        // deleted id must be recorded to both storages, otherwise a stale
        // local index on another device would resurrect it on next merge.
        const tombstoneCalls = setSpy.mock.calls.filter(c => K.PRESET_TOMBSTONES in c[0]);
        expect(tombstoneCalls.length).toBeGreaterThan(0);
        const localTombstones = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
        const syncTombstones = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
        expect(localTombstones[K.PRESET_TOMBSTONES]).toHaveProperty('b');
        expect(syncTombstones[K.PRESET_TOMBSTONES]).toHaveProperty('b');
    });

    it('add: new id absent from sync → its body is pushed', async () => {
        const presetA = makePreset({ id: 'a', name: 'A', content: 'a' });

        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['a'],
            dsPreset_a: presetA,
        });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['a'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        const presetB = makePreset({ id: 'b', name: 'B', content: 'b' });
        await StorageManager.savePromptPresets([presetA, presetB]);

        const pushed = presetCallsOf(setSpy).map(c => Object.keys(c[0])[0]);
        expect(pushed).toEqual(['dsPreset_b']);
    });

    it('downgrade protection: local body older than strictly-newer sync body → NOT pushed, sync intact', async () => {
        const syncNewer = makePreset({ id: 'a', name: 'CloudNewer', content: 'cloud', updatedAt: 500 });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['a'],
            dsPreset_a: syncNewer,
        });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['a'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        const staleLocal = makePreset({ id: 'a', name: 'StaleLocal', content: 'stale', updatedAt: 100 });
        await StorageManager.savePromptPresets([staleLocal]);

        expect(presetCallsOf(setSpy)).toHaveLength(0);

        const syncAfter = await chrome.storage.sync.get(['dsPreset_a']);
        expect(syncAfter.dsPreset_a).toEqual(syncNewer);
    });
});
