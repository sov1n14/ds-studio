import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('StorageManager._pickNewerPreset (pure helper)', () => {
    it('returns localPreset when syncPreset is null/undefined', () => {
        const local = { id: 'p1', updatedAt: 1 };
        expect(StorageManager._pickNewerPreset(local, null)).toBe(local);
        expect(StorageManager._pickNewerPreset(local, undefined)).toBe(local);
    });

    it('returns syncPreset when localPreset is null/undefined', () => {
        const sync = { id: 'p1', updatedAt: 1 };
        expect(StorageManager._pickNewerPreset(null, sync)).toBe(sync);
        expect(StorageManager._pickNewerPreset(undefined, sync)).toBe(sync);
    });

    it('local strictly newer updatedAt wins', () => {
        const local = { id: 'p1', updatedAt: 200, createdAt: 1, content: 'l' };
        const sync = { id: 'p1', updatedAt: 100, createdAt: 1, content: 's' };
        expect(StorageManager._pickNewerPreset(local, sync)).toBe(local);
    });

    it('sync strictly newer updatedAt wins', () => {
        const local = { id: 'p1', updatedAt: 100, createdAt: 1, content: 'l' };
        const sync = { id: 'p1', updatedAt: 200, createdAt: 1, content: 's' };
        expect(StorageManager._pickNewerPreset(local, sync)).toBe(sync);
    });

    it('equal updatedAt, identical content → returns sync (no spurious override)', () => {
        const local = { id: 'p1', updatedAt: 100, createdAt: 5, content: 'same' };
        const sync = { id: 'p1', updatedAt: 100, createdAt: 1, content: 'same' };
        expect(StorageManager._pickNewerPreset(local, sync)).toBe(sync);
    });

    it('equal updatedAt, differing content → earlier createdAt wins (local earlier)', () => {
        const local = { id: 'p1', updatedAt: 100, createdAt: 1, content: 'l' };
        const sync = { id: 'p1', updatedAt: 100, createdAt: 5, content: 's' };
        expect(StorageManager._pickNewerPreset(local, sync)).toBe(local);
    });

    it('equal updatedAt, differing content → earlier createdAt wins (sync earlier)', () => {
        const local = { id: 'p1', updatedAt: 100, createdAt: 5, content: 'l' };
        const sync = { id: 'p1', updatedAt: 100, createdAt: 1, content: 's' };
        expect(StorageManager._pickNewerPreset(local, sync)).toBe(sync);
    });
});

describe('StorageManager._get preset recency reconciliation (dsPreset_<id> in both stores)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        delete chrome.runtime.lastError;
    });

    it('returns LOCAL preset when local updatedAt is strictly newer than sync', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'Local', content: 'local', createdAt: 1, updatedAt: 200 },
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'Sync', content: 'sync', createdAt: 1, updatedAt: 100 },
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1.name).toBe('Local');
    });

    it('returns SYNC preset when sync updatedAt is strictly newer than local', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'Local', content: 'local', createdAt: 1, updatedAt: 100 },
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'Sync', content: 'sync', createdAt: 1, updatedAt: 200 },
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1.name).toBe('Sync');
    });

    it('equal updatedAt, identical content → returns sync value (no spurious override)', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'Same', content: 'same', createdAt: 5, updatedAt: 100 },
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'Same', content: 'same', createdAt: 1, updatedAt: 100 },
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        // sync copy (createdAt: 1) should be the one returned, since content is identical
        expect(result.dsPreset_p1.createdAt).toBe(1);
    });

    it('equal updatedAt, differing content → earlier createdAt wins', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'Local', content: 'local-content', createdAt: 1, updatedAt: 100 },
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'Sync', content: 'sync-content', createdAt: 5, updatedAt: 100 },
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        // local has earlier createdAt (1 < 5) → local wins per helper contract
        expect(result.dsPreset_p1.name).toBe('Local');
    });

    it('preset present only in sync (not local) → sync value returned without throwing', async () => {
        await chrome.storage.sync.set({
            dsPreset_onlySync: { id: 'onlySync', name: 'OnlySync', content: 'c', createdAt: 1, updatedAt: 1 },
        });

        const result = await StorageManager._get(['dsPreset_onlySync']);
        expect(result.dsPreset_onlySync.name).toBe('OnlySync');
    });

    it('preset present only in local (not sync) → local value returned without throwing', async () => {
        await chrome.storage.local.set({
            dsPreset_onlyLocal: { id: 'onlyLocal', name: 'OnlyLocal', content: 'c', createdAt: 1, updatedAt: 1 },
        });

        const result = await StorageManager._get(['dsPreset_onlyLocal']);
        expect(result.dsPreset_onlyLocal.name).toBe('OnlyLocal');
    });

    it('emits a pull:recency-local diagnostic log when local wins over sync', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'Local', content: 'local', createdAt: 1, updatedAt: 200 },
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'Sync', content: 'sync', createdAt: 1, updatedAt: 100 },
        });

        const syncLogSpy = vi.fn();
        globalThis.__DS_Logger = { ...(globalThis.__DS_Logger || {}), sync: syncLogSpy };

        await StorageManager._get(['dsPreset_p1']);

        expect(syncLogSpy).toHaveBeenCalledWith(
            'pull:recency-local',
            expect.objectContaining({ key: 'dsPreset_p1', localTs: 200, syncTs: 100 })
        );
    });

    it('dsLocalAuth pin path is unaffected by preset recency reconciliation', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'OldLocal', content: 'old', createdAt: 1, updatedAt: 50 },
            [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'NewSync', content: 'new', createdAt: 1, updatedAt: 200 },
        });

        // Cloud is newer -> local pin releases -> sync wins (unchanged pre-existing behavior)
        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1.name).toBe('NewSync');
    });

    it('conflict-pending early-return still returns raw local data, unaffected by the fix', async () => {
        await chrome.storage.local.set({
            dsPreset_p1: { id: 'p1', name: 'Local', content: 'local', createdAt: 1, updatedAt: 50 },
            [K.SYNC_CONFLICT_PENDING]: true,
        });
        await chrome.storage.sync.set({
            dsPreset_p1: { id: 'p1', name: 'Sync', content: 'sync', createdAt: 1, updatedAt: 200 },
        });

        const result = await StorageManager._get(['dsPreset_p1']);
        expect(result.dsPreset_p1.name).toBe('Local');
    });
});
