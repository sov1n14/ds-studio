/**
 * StorageManager — retrySync unparking regression (resilience fix)
 *
 * Covers:
 *   - retrySync() dsPreset push decisions now use _pickNewerPreset (no bare
 *     strict `>`), and equal-ts differing-content cases resolve via the
 *     createdAt tiebreak.
 *   - When a parked dsPreset key's cloud copy already wins, it is NOT
 *     re-pushed and IS removed from dsLocalAuth.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('StorageManager.retrySync() — parked dsPreset clearing', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('cloud strictly newer → NOT pushed, sync copy unchanged, key removed from dsLocalAuth', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'StaleLocal', content: 'stale', updatedAt: 50 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: makePreset({ name: 'NewCloud', content: 'new', updatedAt: 500 }),
        });

        const setSpy = vi.spyOn(StorageManager, '_set');

        await StorageManager.retrySync();

        const presetPushCalls = setSpy.mock.calls.filter(c => 'dsPreset_p1' in c[0]);
        expect(presetPushCalls).toHaveLength(0);

        const syncAfter = await chrome.storage.sync.get(['dsPreset_p1']);
        expect(syncAfter.dsPreset_p1.name).toBe('NewCloud');

        const localAfter = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        expect(localAfter[K.LOCAL_AUTHORITATIVE] || []).not.toContain('dsPreset_p1');
    });

    it('equal-ts differing content, cloud wins by createdAt → not pushed, unparked', async () => {
        // Cloud has the earlier createdAt → per _pickNewerPreset contract, cloud wins.
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'Local', content: 'local', updatedAt: 100, createdAt: 9 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: makePreset({ name: 'Cloud', content: 'cloud', updatedAt: 100, createdAt: 1 }),
        });

        const setSpy = vi.spyOn(StorageManager, '_set');

        await StorageManager.retrySync();

        const presetPushCalls = setSpy.mock.calls.filter(c => 'dsPreset_p1' in c[0]);
        expect(presetPushCalls).toHaveLength(0);

        const syncAfter = await chrome.storage.sync.get(['dsPreset_p1']);
        expect(syncAfter.dsPreset_p1.name).toBe('Cloud');

        const localAfter = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        expect(localAfter[K.LOCAL_AUTHORITATIVE] || []).not.toContain('dsPreset_p1');
    });

    it('local strictly newer → pushed AND unparked (regression guard)', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'NewLocal', content: 'new', updatedAt: 900 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: makePreset({ name: 'OldCloud', content: 'old', updatedAt: 100 }),
        });

        const setSpy = vi.spyOn(StorageManager, '_set');

        const result = await StorageManager.retrySync();

        const presetPushCalls = setSpy.mock.calls.filter(c => 'dsPreset_p1' in c[0]);
        expect(presetPushCalls.length).toBeGreaterThan(0);

        const syncAfter = await chrome.storage.sync.get(['dsPreset_p1']);
        expect(syncAfter.dsPreset_p1.name).toBe('NewLocal');

        expect(result.success).toBe(true);
        const localAfter = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        expect(localAfter[K.LOCAL_AUTHORITATIVE] || []).not.toContain('dsPreset_p1');
    });
});
