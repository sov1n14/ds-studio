/**
 * StorageManager sync module — mutant killer tests
 *
 * Targeted tests to kill survived mutants in utils/storage-manager.sync.js.
 * Each test asserts observable behavior that a specific class of mutant
 * (ConditionalExpression, EqualityOperator, ObjectLiteral, ArrayDeclaration,
 *  StringLiteral, BooleanLiteral) would break.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

function makePreset(id, updatedAt, overrides = {}) {
    return { id, name: `name-${id}`, content: `content-${id}`, createdAt: 1, updatedAt, ...overrides };
}

async function seedDefaults(extra = {}) {
    const all = {};
    Object.keys(StorageManager.DEFAULTS).forEach(k => { all[k] = StorageManager.DEFAULTS[k]; });
    Object.assign(all, extra);
    await chrome.storage.local.set(all);
    await chrome.storage.sync.set(all);
}

// ─────────────────────────────────────────────────────────────────────────────
// _detectSyncConflict — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe('_detectSyncConflict — direct invocation', () => {
    it('returns "none" when sync has no PRESET_INDEX at all', () => {
        const result = StorageManager._detectSyncConflict({}, { [K.PRESET_INDEX]: ['p1'] });
        expect(result).toBe('none');
    });

    it('returns "none" when sync PRESET_INDEX is undefined', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: undefined },
            { [K.PRESET_INDEX]: ['p1'] }
        );
        expect(result).toBe('none');
    });

    it('returns "none" when both sides have identical presets (no divergence)', () => {
        const p = makePreset('p1', 100);
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: p },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: p }
        );
        expect(result).toBe('none');
    });

    it('returns "auto" when sync has a preset not in local (one-sided)', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: makePreset('p1', 100) },
            { [K.PRESET_INDEX]: [] }
        );
        expect(result).toBe('auto');
    });

    it('returns "auto" when local has a preset not in sync (one-sided)', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: [] },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: makePreset('p1', 100) }
        );
        expect(result).toBe('auto');
    });

    it('returns "auto" when both sides have preset but with different updatedAt', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: makePreset('p1', 200) },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: makePreset('p1', 100) }
        );
        expect(result).toBe('auto');
    });

    it('returns "manual" when same updatedAt but different content', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: { ...makePreset('p1', 100), content: 'sync-content' } },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: { ...makePreset('p1', 100), content: 'local-content' } }
        );
        expect(result).toBe('manual');
    });

    it('returns "auto" when orderUpdatedAt differs between sides', () => {
        const p = makePreset('p1', 100);
        const result = StorageManager._detectSyncConflict(
            {
                [K.PRESET_INDEX]: ['p1'],
                [StorageManager._presetKey('p1')]: p,
                [K.PRESET_ORDER_META]: { order: ['p1'], orderUpdatedAt: 200 },
            },
            {
                [K.PRESET_INDEX]: ['p1'],
                [StorageManager._presetKey('p1')]: p,
                [K.PRESET_ORDER_META]: { order: ['p1'], orderUpdatedAt: 100 },
            }
        );
        expect(result).toBe('auto');
    });

    it('returns "auto" when PRESET_INDEX arrays differ (even if presets identical)', () => {
        const p = makePreset('p1', 100);
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1', 'p2'], [StorageManager._presetKey('p1')]: p },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: p }
        );
        expect(result).toBe('auto');
    });

    it('handles missing PRESET_ORDER_META gracefully (defaults to orderUpdatedAt: 0)', () => {
        const p = makePreset('p1', 100);
        // Both sides have no PRESET_ORDER_META — default { orderUpdatedAt: 0 } on both = equal = no divergence from meta
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: p },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: p }
        );
        expect(result).toBe('none');
    });

    it('handles empty PRESET_INDEX on sync side (hasCloudData but empty list)', () => {
        // sync has PRESET_INDEX = [] (defined but empty), local has presets
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: [] },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: makePreset('p1', 100) }
        );
        // local has p1 that sync doesn't → one-sided divergence → auto
        expect(result).toBe('auto');
    });

    it('returns "none" when both sides empty and index is defined', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: [] },
            { [K.PRESET_INDEX]: [] }
        );
        expect(result).toBe('none');
    });

    it('detects divergence when syncPreset exists but localPreset is missing', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: makePreset('p1', 100) },
            { [K.PRESET_INDEX]: ['p1'] } // p1 in index but no actual preset data
        );
        expect(result).toBe('auto');
    });

    it('detects divergence when localPreset exists but syncPreset is missing', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'] }, // p1 in index but no actual preset data
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: makePreset('p1', 100) }
        );
        expect(result).toBe('auto');
    });
    it('treats updatedAt fallback 0 correctly when preset has no updatedAt', () => {
        const p = { id: 'p1', name: 'a', content: 'a', createdAt: 1 };
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: p },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: p }
        );
        expect(result).toBe('none');
    });

    it('treats updatedAt fallback 0 vs explicit value as divergence', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: { id: 'p1', name: 'a', content: 'a', createdAt: 1, updatedAt: 100 } },
            { [K.PRESET_INDEX]: ['p1'], [StorageManager._presetKey('p1')]: { id: 'p1', name: 'a', content: 'a', createdAt: 1 } }
        );
        expect(result).toBe('auto');
    });

    it('skips comparison when neither side has data for an id', () => {
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1'] },
            { [K.PRESET_INDEX]: ['p1'] }
        );
        expect(result).toBe('none');
    });

    it('returns auto when PRESET_INDEX order differs', () => {
        const p1 = makePreset('p1', 100);
        const p2 = makePreset('p2', 200);
        const result = StorageManager._detectSyncConflict(
            { [K.PRESET_INDEX]: ['p1', 'p2'], [StorageManager._presetKey('p1')]: p1, [StorageManager._presetKey('p2')]: p2 },
            { [K.PRESET_INDEX]: ['p2', 'p1'], [StorageManager._presetKey('p1')]: p1, [StorageManager._presetKey('p2')]: p2 }
        );
        expect(result).toBe('auto');
    });
});

describe('checkSyncConflictPending strict true check', () => {
    it('returns false when absent', async () => {
        expect(await StorageManager.checkSyncConflictPending()).toBe(false);
    });

    it('returns false when false', async () => {
        await chrome.storage.local.set({ [K.SYNC_CONFLICT_PENDING]: false });
        expect(await StorageManager.checkSyncConflictPending()).toBe(false);
    });

    it('returns true when true', async () => {
        await chrome.storage.local.set({ [K.SYNC_CONFLICT_PENDING]: true });
        expect(await StorageManager.checkSyncConflictPending()).toBe(true);
    });

    it('returns false when truthy but not strictly true', async () => {
        await chrome.storage.local.set({ [K.SYNC_CONFLICT_PENDING]: 1 });
        expect(await StorageManager.checkSyncConflictPending()).toBe(false);
    });
});

describe('hasOversizedItems', () => {
    it('returns false when OVERSIZED_KEYS absent', async () => {
        expect(await StorageManager.hasOversizedItems()).toBe(false);
    });

    it('returns false when OVERSIZED_KEYS is empty', async () => {
        await chrome.storage.local.set({ [K.OVERSIZED_KEYS]: [] });
        expect(await StorageManager.hasOversizedItems()).toBe(false);
    });

    it('returns true when OVERSIZED_KEYS has one entry', async () => {
        await chrome.storage.local.set({ [K.OVERSIZED_KEYS]: ['dsPreset_big'] });
        expect(await StorageManager.hasOversizedItems()).toBe(true);
    });

    it('returns true when OVERSIZED_KEYS has multiple entries', async () => {
        await chrome.storage.local.set({ [K.OVERSIZED_KEYS]: ['a', 'b'] });
        expect(await StorageManager.hasOversizedItems()).toBe(true);
    });
});

describe('resolveSyncConflict mutant killers', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('sets SYNC_INITIALIZED to true after resolve', async () => {
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        await StorageManager.resolveSyncConflict();
        const data = await chrome.storage.local.get([K.SYNC_INITIALIZED]);
        expect(data[K.SYNC_INITIALIZED]).toBe(true);
    });

    it('sets SYNC_CONFLICT_PENDING to exactly false', async () => {
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        await StorageManager.resolveSyncConflict();
        const data = await chrome.storage.local.get([K.SYNC_CONFLICT_PENDING]);
        expect(data[K.SYNC_CONFLICT_PENDING]).toBe(false);
    });

    it('excludes isEnabled from sync updates', async () => {
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        await chrome.storage.local.set({ [K.IS_ENABLED]: true });
        await chrome.storage.sync.set({ [K.IS_ENABLED]: false });
        await StorageManager.resolveSyncConflict();
        const local = await chrome.storage.local.get([K.IS_ENABLED]);
        expect(local[K.IS_ENABLED]).toBe(true);
    });

    it('excludes globalPromptEnabled from sync updates', async () => {
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        await chrome.storage.local.set({ [K.GLOBAL_PROMPT_ENABLED]: true });
        await chrome.storage.sync.set({ [K.GLOBAL_PROMPT_ENABLED]: false });
        await StorageManager.resolveSyncConflict();
        const local = await chrome.storage.local.get([K.GLOBAL_PROMPT_ENABLED]);
        expect(local[K.GLOBAL_PROMPT_ENABLED]).toBe(true);
    });

    it('persists merged tombstones', async () => {
        const now = Date.now();
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        await chrome.storage.local.set({
            [K.PRESET_TOMBSTONES]: { 'local-del': { ts: now, deleted: true } },
        });
        await chrome.storage.sync.set({
            [K.PRESET_TOMBSTONES]: { 'sync-del': { ts: now - 500, deleted: true } },
        });
        await StorageManager.resolveSyncConflict();
        const syncAfter = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
        const tombstones = syncAfter[K.PRESET_TOMBSTONES] || {};
        expect(Object.keys(tombstones)).toContain('local-del');
        expect(Object.keys(tombstones)).toContain('sync-del');
    });

    it('mergedMeta.order reflects merged preset ids', async () => {
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        await chrome.storage.local.set({
            [K.PRESET_INDEX]: ['p1'],
            [StorageManager._presetKey('p1')]: makePreset('p1', 100),
        });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['p2'],
            [StorageManager._presetKey('p2')]: makePreset('p2', 200),
        });
        await StorageManager.resolveSyncConflict();
        const settings = await StorageManager.getSettings();
        const ids = settings.promptPresets.map(p => p.id);
        expect(ids).toContain('p1');
        expect(ids).toContain('p2');
    });
    });

    it('handles missing PRESET_ORDER_META without error', async () => {
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        await chrome.storage.local.remove(K.PRESET_ORDER_META);
        await chrome.storage.sync.remove(K.PRESET_ORDER_META);
        await expect(StorageManager.resolveSyncConflict()).resolves.not.toThrow();
    });

    it('handles missing PRESET_TOMBSTONES without error', async () => {
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        await chrome.storage.local.remove(K.PRESET_TOMBSTONES);
        await chrome.storage.sync.remove(K.PRESET_TOMBSTONES);
        await expect(StorageManager.resolveSyncConflict()).resolves.not.toThrow();
    });

    it('strips all dsPreset_ keys from final updates', async () => {
        await seedDefaults({ [K.SYNC_CONFLICT_PENDING]: true });
        const pA = makePreset('a', 100);
        await chrome.storage.local.set({
            [K.PRESET_INDEX]: ['a'],
            [StorageManager._presetKey('a')]: pA,
        });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['a'],
            [StorageManager._presetKey('a')]: pA,
            [StorageManager._presetKey('orphan')]: makePreset('orphan', 50),
        });
        await StorageManager.resolveSyncConflict();
        const settings = await StorageManager.getSettings();
        expect(settings.promptPresets.map(p => p.id)).toContain('a');
    });

describe('retrySync mutant killers', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('pushes PRESET_INDEX when local orderUpdatedAt equals sync', async () => {
        const ts = 500;
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: [K.PRESET_INDEX],
            [K.PRESET_INDEX]: ['a', 'b'],
            [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: ts },
        });
        await chrome.storage.sync.set({
            [K.PRESET_INDEX]: ['b', 'a'],
            [K.PRESET_ORDER_META]: { order: ['b', 'a'], orderUpdatedAt: ts },
        });
        await StorageManager.retrySync();
        const syncAfter = await chrome.storage.sync.get([K.PRESET_INDEX]);
        expect(syncAfter[K.PRESET_INDEX]).toEqual(['a', 'b']);
    });

    it('pushes PRESET_ORDER_META when local orderUpdatedAt equals sync', async () => {
        const ts = 500;
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: [K.PRESET_ORDER_META],
            [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: ts },
        });
        await chrome.storage.sync.set({
            [K.PRESET_ORDER_META]: { order: ['b', 'a'], orderUpdatedAt: ts },
        });
        await StorageManager.retrySync();
        const syncAfter = await chrome.storage.sync.get([K.PRESET_ORDER_META]);
        expect(syncAfter[K.PRESET_ORDER_META].order).toEqual(['a', 'b']);
    });

    it('does NOT push PRESET_ORDER_META when cloud strictly newer', async () => {
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: [K.PRESET_ORDER_META],
            [K.PRESET_ORDER_META]: { order: ['a', 'b'], orderUpdatedAt: 100 },
        });
        await chrome.storage.sync.set({
            [K.PRESET_ORDER_META]: { order: ['b', 'a'], orderUpdatedAt: 500 },
        });
        await StorageManager.retrySync();
        const syncAfter = await chrome.storage.sync.get([K.PRESET_ORDER_META]);
        expect(syncAfter[K.PRESET_ORDER_META].order).toEqual(['b', 'a']);
    });

    it('handles empty pendingKeys correctly', async () => {
        await chrome.storage.local.set({ [K.LOCAL_AUTHORITATIVE]: [] });
        const result = await StorageManager.retrySync();
        expect(result.success).toBe(true);
        expect(result.remainingUnsyncedCount).toBe(0);
    });

    it('removes reconciled cloud-wins keys from dsLocalAuth', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: makePreset('p1', 50),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: makePreset('p1', 500),
        });
        await StorageManager.retrySync();
        const data = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        expect(data[K.LOCAL_AUTHORITATIVE] || []).not.toContain('dsPreset_p1');
    });

    it('pushes non-preset non-special keys directly', async () => {
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: [K.CHAT_WIDTH],
            [K.CHAT_WIDTH]: 90,
        });
        const setSpy = vi.spyOn(StorageManager, '_set');
        await StorageManager.retrySync();
        const widthCalls = setSpy.mock.calls.filter(c => K.CHAT_WIDTH in c[0]);
        expect(widthCalls.length).toBeGreaterThan(0);
        expect(widthCalls[0][0][K.CHAT_WIDTH]).toBe(90);
    });

    it('remainingUnsyncedCount reflects actual remaining on failure', async () => {
        chrome.storage.sync.setQuotaError(true);
        await chrome.storage.local.set({
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_a', 'dsPreset_b'],
            dsPreset_a: makePreset('a', 100),
            dsPreset_b: makePreset('b', 200),
        });
        const result = await StorageManager.retrySync();
        expect(result.remainingUnsyncedCount).toBe(2);
        expect(result.success).toBe(false);
    });

    it('defaults pendingKeys when LOCAL_AUTHORITATIVE absent', async () => {
        const result = await StorageManager.retrySync();
        expect(result.success).toBe(true);
        expect(result.remainingUnsyncedCount).toBe(0);
    });
});

describe('syncNow returns getSettings result', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns an object with expected settings shape', async () => {
        const result = await StorageManager.syncNow();
        expect(result).toHaveProperty('isEnabled');
        expect(result).toHaveProperty('promptPresets');
    });
});
