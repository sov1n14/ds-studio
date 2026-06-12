/**
 * StorageManager — Sync Write Quota Fix: new method tests
 *
 * Covers:
 *   - saveOnePromptPreset(preset)
 *   - isSyncedWithCloud()
 *   - retrySync()
 *   - savePromptPresets() conditional PRESET_INDEX write
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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
// saveOnePromptPreset
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager.saveOnePromptPreset()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calls _set with exactly the key dsPreset_{id} and the preset value', async () => {
        const spy = vi.spyOn(StorageManager, '_set');
        const preset = makePreset({ id: 'abc123' });

        await StorageManager.saveOnePromptPreset(preset);

        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith({ 'dsPreset_abc123': preset });
    });

    it('does NOT write the PRESET_INDEX key', async () => {
        const spy = vi.spyOn(StorageManager, '_set');
        const preset = makePreset({ id: 'xyz' });

        await StorageManager.saveOnePromptPreset(preset);

        const callArg = spy.mock.calls[0][0];
        expect(Object.keys(callArg)).not.toContain(K.PRESET_INDEX);
    });

    it('returns the result of _set (propagates its resolved value)', async () => {
        const sentinel = Symbol('resolved');
        vi.spyOn(StorageManager, '_set').mockResolvedValue(sentinel);

        const result = await StorageManager.saveOnePromptPreset(makePreset());

        expect(result).toBe(sentinel);
    });

    it('persists the preset data into sync storage', async () => {
        const preset = makePreset({ id: 'p99', content: 'my content' });

        await StorageManager.saveOnePromptPreset(preset);

        const syncData = await chrome.storage.sync.get(['dsPreset_p99']);
        expect(syncData['dsPreset_p99']).toEqual(preset);
    });

    it('does not persist a PRESET_INDEX entry into sync storage', async () => {
        const preset = makePreset({ id: 'noindex' });

        await StorageManager.saveOnePromptPreset(preset);

        const syncData = await chrome.storage.sync.get([K.PRESET_INDEX]);
        expect(syncData[K.PRESET_INDEX]).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// isSyncedWithCloud
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager.isSyncedWithCloud()', () => {
    it('returns true when dsLocalAuth is absent from local storage', async () => {
        // Storage is cleared by beforeEach in vitest.setup.js — nothing in local
        const result = await StorageManager.isSyncedWithCloud();
        expect(result).toBe(true);
    });

    it('returns true when dsLocalAuth is an empty array', async () => {
        await chrome.storage.local.set({ [K.LOCAL_AUTHORITATIVE]: [] });

        const result = await StorageManager.isSyncedWithCloud();
        expect(result).toBe(true);
    });

    it('returns false when dsLocalAuth contains at least one key', async () => {
        await chrome.storage.local.set({ [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'] });

        const result = await StorageManager.isSyncedWithCloud();
        expect(result).toBe(false);
    });

    it('returns false when dsLocalAuth contains multiple keys', async () => {
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: [K.PRESET_INDEX, 'dsPreset_p1', 'dsPreset_p2'],
        });

        const result = await StorageManager.isSyncedWithCloud();
        expect(result).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// retrySync
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager.retrySync()', () => {
    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('returns { success: true, remainingUnsyncedCount: 0 } when dsLocalAuth is empty', async () => {
        const result = await StorageManager.retrySync();

        expect(result).toEqual({ success: true, remainingUnsyncedCount: 0 });
    });

    it('retries each pending key by calling _set, clears dsLocalAuth on success', async () => {
        // Seed local with a pending key
        const preset = makePreset({ id: 'pending1' });
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_pending1'],
            'dsPreset_pending1': preset,
        });

        const setSpy = vi.spyOn(StorageManager, '_set');

        const result = await StorageManager.retrySync();

        expect(setSpy).toHaveBeenCalledWith({ 'dsPreset_pending1': preset });
        expect(result.success).toBe(true);
        expect(result.remainingUnsyncedCount).toBe(0);
    });

    it('calls _set for each key listed in dsLocalAuth', async () => {
        const presetA = makePreset({ id: 'a1' });
        const presetB = makePreset({ id: 'b2' });
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_a1', 'dsPreset_b2'],
            'dsPreset_a1': presetA,
            'dsPreset_b2': presetB,
        });

        const setSpy = vi.spyOn(StorageManager, '_set');

        await StorageManager.retrySync();

        const calledKeys = setSpy.mock.calls.map(c => Object.keys(c[0])[0]);
        expect(calledKeys).toContain('dsPreset_a1');
        expect(calledKeys).toContain('dsPreset_b2');
    });

    it('returns { success: false, remainingUnsyncedCount: N } if sync still fails after retry', async () => {
        chrome.storage.sync.setQuotaError(true);

        const preset = makePreset({ id: 'failkey' });
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_failkey'],
            'dsPreset_failkey': preset,
        });

        const result = await StorageManager.retrySync();

        expect(result.success).toBe(false);
        expect(result.remainingUnsyncedCount).toBeGreaterThan(0);
    });

    it('calls _safeRemove on sync for a key missing from local (edge case: deleted while offline)', async () => {
        // Key is listed in dsLocalAuth but does not exist in local storage
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_ghost'],
            // 'dsPreset_ghost' intentionally absent
        });

        const removeSpy = vi.spyOn(StorageManager, '_safeRemove');

        const result = await StorageManager.retrySync();

        expect(removeSpy).toHaveBeenCalledWith('sync', ['dsPreset_ghost']);
        // The ghost key should have been removed from dsLocalAuth
        expect(result.remainingUnsyncedCount).toBe(0);
    });

    it('removes the missing key from dsLocalAuth after _safeRemove', async () => {
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_ghost'],
        });

        await StorageManager.retrySync();

        const localData = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        const auth = localData[K.LOCAL_AUTHORITATIVE] || [];
        expect(auth).not.toContain('dsPreset_ghost');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// savePromptPresets — conditional PRESET_INDEX write
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager.savePromptPresets() — conditional PRESET_INDEX write', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does NOT call _set with PRESET_INDEX when IDs are identical and in same order', async () => {
        const presets = [
            makePreset({ id: 'p1' }),
            makePreset({ id: 'p2', name: 'Second' }),
        ];
        // Pre-populate existing index so it matches the incoming list
        await chrome.storage.sync.set({ [K.PRESET_INDEX]: ['p1', 'p2'] });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['p1', 'p2'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        await StorageManager.savePromptPresets(presets);

        const indexCalls = setSpy.mock.calls.filter(
            c => K.PRESET_INDEX in c[0]
        );
        expect(indexCalls).toHaveLength(0);
    });

    it('DOES call _set with PRESET_INDEX when a new preset is added (IDs differ)', async () => {
        const oldPresets = [makePreset({ id: 'p1' })];
        const newPresets = [makePreset({ id: 'p1' }), makePreset({ id: 'p2', name: 'New' })];

        // Seed old index
        await chrome.storage.sync.set({ [K.PRESET_INDEX]: ['p1'] });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['p1'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        await StorageManager.savePromptPresets(newPresets);

        const indexCalls = setSpy.mock.calls.filter(c => K.PRESET_INDEX in c[0]);
        expect(indexCalls.length).toBeGreaterThan(0);
        expect(indexCalls[0][0][K.PRESET_INDEX]).toEqual(['p1', 'p2']);
    });

    it('DOES call _set with PRESET_INDEX when a preset is removed (IDs differ)', async () => {
        await chrome.storage.sync.set({ [K.PRESET_INDEX]: ['p1', 'p2'] });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['p1', 'p2'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        await StorageManager.savePromptPresets([makePreset({ id: 'p1' })]);

        const indexCalls = setSpy.mock.calls.filter(c => K.PRESET_INDEX in c[0]);
        expect(indexCalls.length).toBeGreaterThan(0);
        expect(indexCalls[0][0][K.PRESET_INDEX]).toEqual(['p1']);
    });

    it('DOES call _set with PRESET_INDEX when order changes (reorder)', async () => {
        await chrome.storage.sync.set({ [K.PRESET_INDEX]: ['p1', 'p2'] });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['p1', 'p2'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        // Same IDs but reversed order
        await StorageManager.savePromptPresets([
            makePreset({ id: 'p2', name: 'Second' }),
            makePreset({ id: 'p1' }),
        ]);

        const indexCalls = setSpy.mock.calls.filter(c => K.PRESET_INDEX in c[0]);
        expect(indexCalls.length).toBeGreaterThan(0);
        expect(indexCalls[0][0][K.PRESET_INDEX]).toEqual(['p2', 'p1']);
    });

    it('always writes each preset individually regardless of index change', async () => {
        const presets = [
            makePreset({ id: 'p1' }),
            makePreset({ id: 'p2', name: 'Second' }),
        ];
        await chrome.storage.sync.set({ [K.PRESET_INDEX]: ['p1', 'p2'] });
        await chrome.storage.local.set({ [K.PRESET_INDEX]: ['p1', 'p2'] });

        const setSpy = vi.spyOn(StorageManager, '_set');

        await StorageManager.savePromptPresets(presets);

        const presetCalls = setSpy.mock.calls.filter(c => {
            const k = Object.keys(c[0])[0];
            return k && k.startsWith('dsPreset_');
        });
        const writtenKeys = presetCalls.map(c => Object.keys(c[0])[0]);
        expect(writtenKeys).toContain('dsPreset_p1');
        expect(writtenKeys).toContain('dsPreset_p2');
    });

    it('writes each preset individually even when IDs change', async () => {
        const presets = [makePreset({ id: 'newpreset' })];

        const setSpy = vi.spyOn(StorageManager, '_set');

        await StorageManager.savePromptPresets(presets);

        const presetCalls = setSpy.mock.calls.filter(
            c => 'dsPreset_newpreset' in c[0]
        );
        expect(presetCalls).toHaveLength(1);
    });
});
