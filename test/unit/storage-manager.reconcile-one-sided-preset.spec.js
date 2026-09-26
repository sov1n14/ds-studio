import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

/**
 * Kills mutant: storage-manager.rw.js line 109
 * Original: if (localPreset === undefined || syncPreset === undefined) continue;
 * Mutant:   if (false) continue;  /  || → &&
 *
 * When a preset key exists on only one side (local or sync), the reconciliation
 * must skip it gracefully — not attempt to compare updatedAt on undefined.
 */
describe('StorageManager._reconcileRemoteWins — one-sided preset skip guard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('does not throw when a preset exists in local but not in sync', async () => {
        const preset = { id: 'p1', name: 'LocalOnly', content: 'c', createdAt: 1, updatedAt: 100 };
        await chrome.storage.local.set({ dsPreset_p1: preset });
        // sync has NO dsPreset_p1

        // _get merges local+sync and calls _reconcileRemoteWins internally.
        // With the guard removed, _pickNewerPreset(preset, undefined) would throw.
        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1).toEqual(preset);
    });

    it('does not throw when a preset exists in sync but not in local', async () => {
        const preset = { id: 'p2', name: 'SyncOnly', content: 'c', createdAt: 1, updatedAt: 200 };
        await chrome.storage.sync.set({ dsPreset_p2: preset });
        // local has NO dsPreset_p2

        const result = await StorageManager._get(['dsPreset_p2']);
        expect(result.dsPreset_p2).toEqual(preset);
    });

    it('still compares correctly when both sides have the preset', async () => {
        const localPreset = { id: 'p3', name: 'Local', content: 'old', createdAt: 1, updatedAt: 100 };
        const syncPreset = { id: 'p3', name: 'Sync', content: 'new', createdAt: 1, updatedAt: 500 };
        await chrome.storage.local.set({ dsPreset_p3: localPreset });
        await chrome.storage.sync.set({ dsPreset_p3: syncPreset });

        const result = await StorageManager._get(['dsPreset_p3']);
        // Sync is newer, should win
        expect(result.dsPreset_p3.name).toBe('Sync');
        expect(result.dsPreset_p3.updatedAt).toBe(500);
    });
});
