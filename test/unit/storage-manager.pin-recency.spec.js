/**
 * StorageManager — pin recency fix (resilience fix)
 *
 * Covers:
 *   - _shouldPinLocalPreset() pure matrix
 *   - _get() dsPreset pin now uses _shouldPinLocalPreset instead of a bare
 *     equal-ts-biased `>=` comparison, so a strictly-newer sync copy wins
 *     even while the key is parked in dsLocalAuth.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
// _shouldPinLocalPreset — pure matrix
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager._shouldPinLocalPreset (pure helper)', () => {
    it('returns true when syncPreset is missing (nothing to compare against)', () => {
        const local = makePreset();
        expect(StorageManager._shouldPinLocalPreset(local, null)).toBe(true);
        expect(StorageManager._shouldPinLocalPreset(local, undefined)).toBe(true);
    });

    it('returns false when localPreset is missing', () => {
        const sync = makePreset();
        expect(StorageManager._shouldPinLocalPreset(null, sync)).toBe(false);
        expect(StorageManager._shouldPinLocalPreset(undefined, sync)).toBe(false);
    });

    it('returns true when local is strictly newer', () => {
        const local = makePreset({ updatedAt: 300 });
        const sync = makePreset({ updatedAt: 100 });
        expect(StorageManager._shouldPinLocalPreset(local, sync)).toBe(true);
    });

    it('returns false when sync is strictly newer', () => {
        const local = makePreset({ updatedAt: 100 });
        const sync = makePreset({ updatedAt: 300 });
        expect(StorageManager._shouldPinLocalPreset(local, sync)).toBe(false);
    });

    it('equal updatedAt, differing content → createdAt tiebreak (local earlier wins)', () => {
        const local = makePreset({ updatedAt: 100, createdAt: 1, content: 'l' });
        const sync = makePreset({ updatedAt: 100, createdAt: 5, content: 's' });
        expect(StorageManager._shouldPinLocalPreset(local, sync)).toBe(true);
    });

    it('equal updatedAt, differing content → createdAt tiebreak (sync earlier wins, pin false)', () => {
        const local = makePreset({ updatedAt: 100, createdAt: 5, content: 'l' });
        const sync = makePreset({ updatedAt: 100, createdAt: 1, content: 's' });
        expect(StorageManager._shouldPinLocalPreset(local, sync)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _get() receiver-side pin behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager._get() — parked dsPreset pin recency', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        delete chrome.runtime.lastError;
    });

    it('accepts newer sync content even when the key is parked in dsLocalAuth', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'StaleLocal', content: 'stale', updatedAt: 50 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: makePreset({ name: 'NewerSync', content: 'newer', updatedAt: 999 }),
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1.name).toBe('NewerSync');
    });

    it('parked + equal-ts + differing content → earlier-createdAt copy wins (behavior change)', async () => {
        // Local has LATER createdAt than sync — old code's bare `>=` on updatedAt
        // would have pinned local regardless; new code applies the createdAt tiebreak.
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'Local', content: 'local', updatedAt: 100, createdAt: 5 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: makePreset({ name: 'Sync', content: 'sync', updatedAt: 100, createdAt: 1 }),
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        // sync createdAt (1) is earlier → sync wins per _pickNewerPreset contract
        expect(result.dsPreset_p1.name).toBe('Sync');
    });

    it('parked + sync missing → local is pinned', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: makePreset({ name: 'OnlyLocal', content: 'local-only', updatedAt: 10 }),
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        // No sync copy at all

        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1.name).toBe('OnlyLocal');
    });
});
