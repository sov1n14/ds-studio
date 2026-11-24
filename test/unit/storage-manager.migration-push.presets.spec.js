import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { populateDefaults } from '../helpers/storage-manager-defaults.js';

const K = StorageManager.KEYS;

/**
 * Requirement (user decision): opening the popup runs StorageManager.initialize(), and its migration push writes a dsPreset_<id> to chrome.storage.sync only when sync lacks that preset or the local copy is newer (larger updatedAt). A newer cloud copy is never overwritten, and an identical preset is never rewritten.
 */

function preset(id, content, updatedAt) {
    return { id, name: `Preset ${id}`, content, createdAt: 1, updatedAt };
}

/**
 * Arrange both areas with the default settings, a two-preset index, and the given presets. INCLUDE_THINKING is missing from sync so the migration push has a known non-preset key to push; its arrival in sync proves the branch under test ran.
 */
async function arrangePresets({ local, sync }) {
    await populateDefaults();
    const index = { [K.PRESET_INDEX]: ['p1', 'p2'] };
    await chrome.storage.local.set({ ...index, ...local, [K.INCLUDE_THINKING]: false });
    await chrome.storage.sync.set({ ...index, ...sync });
    await chrome.storage.sync.remove(K.INCLUDE_THINKING);
}

/** Start recording chrome.storage.sync.set calls; returns a reader of the dsPreset_<id> keys written so far, deduplicated and sorted. */
function recordSyncPresetWrites() {
    const setSpy = vi.spyOn(chrome.storage.sync, 'set');
    return () => {
        const keys = setSpy.mock.calls.flatMap(([items]) => Object.keys(items || {}));
        return [...new Set(keys.filter((key) => key.startsWith('dsPreset_')))].sort();
    };
}

async function initializeAndAssertBranchRan() {
    await expect(StorageManager.initialize()).resolves.toBeUndefined();
    const syncAfter = await chrome.storage.sync.get(K.INCLUDE_THINKING);
    expect(syncAfter[K.INCLUDE_THINKING], 'probe key reached sync, so the migration push ran').toBe(false);
}

describe('StorageManager migration push: presets', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
        chrome.runtime.sendMessage.mockResolvedValue({ ok: true, map: {} });
    });

    afterEach(() => {
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('writes no dsPreset_* key to sync when both areas hold identical presets', async () => {
        const p1 = preset('p1', 'SAME-1', 3);
        const p2 = preset('p2', 'SAME-2', 4);
        await arrangePresets({ local: { dsPreset_p1: p1, dsPreset_p2: p2 }, sync: { dsPreset_p1: p1, dsPreset_p2: p2 } });
        const presetWrites = recordSyncPresetWrites();

        await initializeAndAssertBranchRan();

        expect(presetWrites(), 'dsPreset_* keys written to sync by initialize()').toEqual([]);
    });

    it('writes only the preset sync lacks, with the local content', async () => {
        const p1 = preset('p1', 'SAME-1', 3);
        const p2 = preset('p2', 'LOCAL-ONLY-2', 4);
        await arrangePresets({ local: { dsPreset_p1: p1, dsPreset_p2: p2 }, sync: { dsPreset_p1: p1 } });
        const presetWrites = recordSyncPresetWrites();

        await initializeAndAssertBranchRan();

        expect(presetWrites(), 'dsPreset_* keys written to sync by initialize()').toEqual(['dsPreset_p2']);
        const syncAfter = await chrome.storage.sync.get('dsPreset_p2');
        expect(syncAfter.dsPreset_p2, 'sync dsPreset_p2 after initialize()').toEqual(p2);
    });

    it('keeps a newer cloud preset instead of overwriting it with an older local copy', async () => {
        const p2 = preset('p2', 'SAME-2', 4);
        await arrangePresets({
            local: { dsPreset_p1: preset('p1', 'OLD-LOCAL', 1), dsPreset_p2: p2 },
            sync: { dsPreset_p1: preset('p1', 'NEW-CLOUD', 5), dsPreset_p2: p2 },
        });

        await initializeAndAssertBranchRan();

        const syncAfter = await chrome.storage.sync.get('dsPreset_p1');
        expect(syncAfter.dsPreset_p1?.content, 'sync dsPreset_p1 content after initialize()').toBe('NEW-CLOUD');
        expect(syncAfter.dsPreset_p1?.updatedAt, 'sync dsPreset_p1 updatedAt after initialize()').toBe(5);
    });

    it('pushes a newer local preset over an older cloud copy', async () => {
        const p2 = preset('p2', 'SAME-2', 4);
        await arrangePresets({
            local: { dsPreset_p1: preset('p1', 'NEW-LOCAL', 5), dsPreset_p2: p2 },
            sync: { dsPreset_p1: preset('p1', 'OLD-CLOUD', 1), dsPreset_p2: p2 },
        });

        await initializeAndAssertBranchRan();

        const syncAfter = await chrome.storage.sync.get('dsPreset_p1');
        expect(syncAfter.dsPreset_p1?.content, 'sync dsPreset_p1 content after initialize()').toBe('NEW-LOCAL');
        expect(syncAfter.dsPreset_p1?.updatedAt, 'sync dsPreset_p1 updatedAt after initialize()').toBe(5);
    });
});
