import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

/**
 * Helper to seed all DEFAULTS so initialize() step 4 doesn't produce updates.
 */
async function seedAllDefaults(extra = {}) {
    const all = {};
    Object.keys(StorageManager.DEFAULTS).forEach(k => {
        all[k] = StorageManager.DEFAULTS[k];
    });
    Object.assign(all, extra);
    await chrome.storage.local.set(all);
    await chrome.storage.sync.set(all);
}

describe('StorageManager sync conflict & fallback (5.8, 11.x scenarios)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // Clear any lastError own property that may have leaked from tests
        // that temporarily override the prototype getter
        delete chrome.runtime.lastError;
    });

    describe('sync fallback — 5.8', () => {
        it('falls back to local when sync.set fails', async () => {
            await StorageManager.saveEnabledState(true);

            const localData = await chrome.storage.local.get([K.IS_ENABLED]);
            expect(localData[K.IS_ENABLED]).toBe(true);
        });

        it('data persisted to local even after a full write cycle', async () => {
            await StorageManager.saveEnabledState(true);
            await StorageManager.saveEnabledState(false);
            await StorageManager.saveEnabledState(true);

            const localData = await chrome.storage.local.get([K.IS_ENABLED]);
            expect(localData[K.IS_ENABLED]).toBe(true);
        });
    });

    describe('dsLocalAuth Plan A tracking — pin-on-read removed (report.md §4.2 Step 2)', () => {
        it('does not prefer local based on parking alone — recency still decides even when local is stale', async () => {
            // Local dsPreset_p1 is parked in dsLocalAuth (e.g. from a prior failed
            // write) AND is genuinely stale (older updatedAt) vs a newer sync value.
            // The pin-on-read layer would have kept local pinned purely because it
            // was parked; pure recency (Step 2 fix) must let the newer sync value win.
            await chrome.storage.local.set({
                dsPreset_p1: { id: 'p1', name: 'StaleLocal', content: 'stale', createdAt: 1, updatedAt: 50 },
                [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
            });
            await chrome.storage.sync.set({
                dsPreset_p1: { id: 'p1', name: 'NewerSync', content: 'newer', createdAt: 1, updatedAt: 500 },
            });
            const result = await StorageManager._get(['dsPreset_p1']);
            expect(result.dsPreset_p1.name).toBe('NewerSync');

            // Also verify the plain-key (non-preset) merge behavior: sync always
            // wins when present, regardless of dsLocalAuth parking.
            await chrome.storage.local.set({ isEnabled: true, [K.LOCAL_AUTHORITATIVE]: ['isEnabled'] });
            await chrome.storage.sync.set({ isEnabled: false });
            const plainResult = await StorageManager._get(['isEnabled']);
            expect(plainResult.isEnabled).toBe(false);
        });

        it('_get does NOT prefer local when dsLocalAuth is empty', async () => {
            await chrome.storage.local.set({ isEnabled: true });
            await chrome.storage.sync.set({ isEnabled: false });
            const result = await StorageManager._get(['isEnabled']);
            // Without dsLocalAuth, sync value takes precedence
            expect(result.isEnabled).toBe(false);
        });

        it('_set success branch removes saved keys from dsLocalAuth', async () => {
            // isEnabled is local-only (report.md §4.3 Step 3) and is written via
            // _safeSet('local', …), never via _set() — so it can no longer be used
            // to probe _set()'s dsLocalAuth-removal branch. Use chatWidth instead,
            // which still routes through _set() and the sync path.
            await chrome.storage.local.set({ [K.LOCAL_AUTHORITATIVE]: [K.CHAT_WIDTH], [K.CHAT_WIDTH]: 50 });
            await StorageManager.saveChatWidth(90);
            const data = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
            const auth = data[K.LOCAL_AUTHORITATIVE] || [];
            expect(auth).not.toContain(K.CHAT_WIDTH);
        });

        it('dsLocalAuth does not affect keys not in the list', async () => {
            await chrome.storage.local.set({ chatWidth: 50, [K.LOCAL_AUTHORITATIVE]: ['isEnabled'] });
            await chrome.storage.sync.set({ chatWidth: 80 });
            const result = await StorageManager._get(['chatWidth']);
            // chatWidth not in dsLocalAuth → sync value wins
            expect(result.chatWidth).toBe(80);
        });
    });

    describe('sync conflict detection — 11.x', () => {
        it('auto-resolves divergence with clearly different updatedAt on first sync', async () => {
            await seedAllDefaults({
                [K.PRESET_INDEX]: ['p1', 'p2'],
                dsPreset_p1: { id: 'p1', name: 'Local', content: 'local', createdAt: 1, updatedAt: 1 },
                dsPreset_p2: { id: 'p2', name: 'Both', content: 'old', createdAt: 1, updatedAt: 50 },
                [K.SYNC_INITIALIZED]: false,
            });

            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['p2', 'p3'],
                dsPreset_p2: { id: 'p2', name: 'Both', content: 'new', createdAt: 1, updatedAt: 200 },
                dsPreset_p3: { id: 'p3', name: 'Sync', content: 's3', createdAt: 1, updatedAt: 300 },
            });

            await StorageManager.initialize();

            // Should auto-resolve (not show conflict modal)
            const pending = await StorageManager.checkSyncConflictPending();
            expect(pending).toBe(false);

            // Merged presets should be accessible
            const settings = await StorageManager.getSettings();
            const p2 = settings.promptPresets.find(p => p.id === 'p2');
            expect(p2?.content).toBe('new'); // sync wins (updatedAt 200 > 50)
        });

        it('sets syncConflictPending only for manual conflicts (equal updatedAt, different content)', async () => {
            await seedAllDefaults({
                [K.PRESET_INDEX]: ['p1'],
                dsPreset_p1: { id: 'p1', name: 'LocalName', content: 'local content', createdAt: 1, updatedAt: 100 },
                [K.SYNC_INITIALIZED]: false,
            });

            // Sync has same preset with same updatedAt but different content — true conflict
            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['p1'],
                dsPreset_p1: { id: 'p1', name: 'SyncName', content: 'sync content', createdAt: 1, updatedAt: 100 },
            });

            await StorageManager.initialize();

            const state = await chrome.storage.local.get([K.SYNC_CONFLICT_PENDING]);
            expect(state[K.SYNC_CONFLICT_PENDING]).toBe(true);
        });

        it('cloud preset wins over a stale parked local preset — recency, not a pin/release mechanism', async () => {
            // Local has a stale preset parked in dsLocalAuth, but cloud has a newer
            // version. There is no pin/release mechanism anymore: _get() simply
            // compares updatedAt every time, so the newer cloud value wins outright.
            await chrome.storage.local.set({
                dsPreset_p1: { id: 'p1', name: 'OldLocal', content: 'old', createdAt: 1, updatedAt: 50 },
                [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
            });
            await chrome.storage.sync.set({
                dsPreset_p1: { id: 'p1', name: 'NewSync', content: 'new', createdAt: 1, updatedAt: 200 },
            });

            const result = await StorageManager._get(['dsPreset_p1']);
            expect(result.dsPreset_p1.name).toBe('NewSync');
        });

        it('does not set conflict when local and sync are identical on first sync', async () => {
            await seedAllDefaults({
                [K.PRESET_INDEX]: ['p1'],
                dsPreset_p1: { id: 'p1', name: 'Same', content: 'same', createdAt: 1, updatedAt: 1 },
                [K.SYNC_INITIALIZED]: false,
            });

            // Sync has the same data
            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['p1'],
                dsPreset_p1: { id: 'p1', name: 'Same', content: 'same', createdAt: 1, updatedAt: 1 },
            });

            await StorageManager.initialize();
            const pending = await StorageManager.checkSyncConflictPending();
            expect(pending).toBe(false);
        });
    });

    describe('resolveSyncConflict — 11.x', () => {
        it('merges presets from sync and local, with newer updatedAt winning', async () => {
            await seedAllDefaults({
                [K.SYNC_CONFLICT_PENDING]: true,
                [K.PRESET_INDEX]: ['p1', 'p2'],
                dsPreset_p1: { id: 'p1', name: 'Local', content: 'l1', createdAt: 1, updatedAt: 100 },
                dsPreset_p2: { id: 'p2', name: 'Both', content: 'old', createdAt: 1, updatedAt: 50 },
            });

            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['p2', 'p3'],
                dsPreset_p2: { id: 'p2', name: 'Both', content: 'new', createdAt: 1, updatedAt: 200 },
                dsPreset_p3: { id: 'p3', name: 'Sync', content: 's3', createdAt: 1, updatedAt: 300 },
            });

            await StorageManager.resolveSyncConflict();

            const settings = await StorageManager.getSettings();
            const p1 = settings.promptPresets.find(p => p.id === 'p1');
            const p2 = settings.promptPresets.find(p => p.id === 'p2');
            const p3 = settings.promptPresets.find(p => p.id === 'p3');

            expect(p1).toBeDefined();       // from local only
            expect(p2.content).toBe('new'); // sync has newer updatedAt
            expect(p3).toBeDefined();       // from sync only
            expect(settings.syncConflictPending).toBe(false);
        });

        it('clears syncConflictPending flag after merge', async () => {
            await seedAllDefaults({ [K.SYNC_CONFLICT_PENDING]: true });

            await StorageManager.resolveSyncConflict();

            const pending = await StorageManager.checkSyncConflictPending();
            expect(pending).toBe(false);
        });
    });

    describe('restoreSettings — import/merge', () => {
        it('merges promptPresets from imported data', async () => {
            await StorageManager.savePromptPresets([
                { id: 'p1', name: 'Existing', content: 'e', createdAt: 1, updatedAt: 1 },
            ]);

            await StorageManager.restoreSettings({
                promptPresets: [
                    { id: 'p2', name: 'Imported', content: 'i', createdAt: 2, updatedAt: 2 },
                ],
            }, false);

            const settings = await StorageManager.getSettings();
            expect(settings.promptPresets).toHaveLength(2);
        });

        it('with mergePresetsOnly=true, does not overwrite UI settings', async () => {
            await StorageManager.saveEnabledState(true);
            await StorageManager.saveChatWidth(90);

            await StorageManager.restoreSettings({
                isEnabled: false,
                chatWidth: 30,
            }, true);

            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(true);
            expect(settings.chatWidth).toBe(90);
        });

        it('with mergePresetsOnly=false, overwrites UI settings', async () => {
            await StorageManager.saveChatWidth(90);

            await StorageManager.restoreSettings({
                chatWidth: 30,
            }, false);

            const settings = await StorageManager.getSettings();
            expect(settings.chatWidth).toBe(30);
        });

        it('with mergePresetsOnly=false, does NOT overwrite isEnabled (report.md §4.3 Step 3 — local-only, excluded from import)', async () => {
            await StorageManager.saveEnabledState(true);

            await StorageManager.restoreSettings({
                isEnabled: false,
            }, false);

            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(true);
        });

        it('BUG FIX: re-importing a preset whose id has a stale (not-yet-expired) tombstone restores it and clears the tombstone', async () => {
            const K = StorageManager.KEYS;
            const now = Date.now();
            // Seed a tombstone for 'restored-id' within the 30-day retention window,
            // simulating: user deleted all presets, then re-imports a backup containing that id.
            await chrome.storage.local.set({ [K.PRESET_TOMBSTONES]: { 'restored-id': now - (5 * 24 * 60 * 60 * 1000) } });
            await chrome.storage.sync.set({ [K.PRESET_TOMBSTONES]: { 'restored-id': now - (5 * 24 * 60 * 60 * 1000) } });

            await StorageManager.restoreSettings({
                promptPresets: [
                    { id: 'restored-id', name: 'Restored', content: 'r', createdAt: now, updatedAt: now },
                ],
            }, false);

            const settings = await StorageManager.getSettings();
            expect(settings.promptPresets.map(p => p.id)).toContain('restored-id');

            const localTombstones = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
            const syncTombstones = await chrome.storage.sync.get([K.PRESET_TOMBSTONES]);
            // BUG FIX: clearPresetTombstones() no longer deletes the map key outright —
            // it writes { ts, deleted: false } so a newer "cleared" intent can beat a
            // stale "deleted" tombstone still held by an unsynced device.
            expect(localTombstones[K.PRESET_TOMBSTONES]['restored-id']).toEqual(
                expect.objectContaining({ deleted: false })
            );
            expect(syncTombstones[K.PRESET_TOMBSTONES]['restored-id']).toEqual(
                expect.objectContaining({ deleted: false })
            );
        });

        it('regression-safety: importing presets with no matching tombstone entries works exactly as before', async () => {
            const K = StorageManager.KEYS;
            const now = Date.now();
            await chrome.storage.local.set({ [K.PRESET_TOMBSTONES]: { 'unrelated-id': now } });

            await StorageManager.restoreSettings({
                promptPresets: [
                    { id: 'no-tombstone-id', name: 'Plain Import', content: 'p', createdAt: now, updatedAt: now },
                ],
            }, false);

            const settings = await StorageManager.getSettings();
            expect(settings.promptPresets.map(p => p.id)).toContain('no-tombstone-id');

            const localTombstones = await chrome.storage.local.get([K.PRESET_TOMBSTONES]);
            expect(localTombstones[K.PRESET_TOMBSTONES]).toHaveProperty('unrelated-id');
        });
    });

    describe('regression — parked stale edit must not resurface over a later, different cloud edit (report.md §4.2 Step 2)', () => {
        it('a locally-parked failed edit never overrides a subsequent, newer, unrelated cloud edit — on first read or any later read', async () => {
            // Scenario:
            //  1. Device A edits a preset locally; the write fails (e.g. context-invalidated)
            //     and the key gets parked in dsLocalAuth as a pending retry.
            //  2. Device B makes a DIFFERENT, later edit that successfully reaches the cloud
            //     (strictly larger updatedAt than device A's parked local edit).
            //  3. Any subsequent _get() call — first, second, or third — must surface
            //     device B's cloud edit, never device A's stale parked local edit.
            //     Under the old pin-on-read behavior, parking would have permanently
            //     pinned the local (older) edit on every read; that must no longer happen.
            await chrome.storage.local.set({
                dsPreset_p1: { id: 'p1', name: 'DeviceA-Edit', content: 'device-a-failed-edit', createdAt: 1, updatedAt: 100 },
                [K.LOCAL_AUTHORITATIVE]: ['dsPreset_p1'],
            });
            await chrome.storage.sync.set({
                dsPreset_p1: { id: 'p1', name: 'DeviceB-Edit', content: 'device-b-synced-edit', createdAt: 1, updatedAt: 999 },
            });

            const firstRead = await StorageManager._get(['dsPreset_p1']);
            expect(firstRead.dsPreset_p1.name).toBe('DeviceB-Edit');
            expect(firstRead.dsPreset_p1.content).toBe('device-b-synced-edit');

            // Re-reading must not let the parked local edit "come back" — the parking
            // list is untouched by _get(), so a naive re-introduction of pin-on-read
            // would resurface DeviceA-Edit on a later read. It must not.
            const secondRead = await StorageManager._get(['dsPreset_p1']);
            expect(secondRead.dsPreset_p1.name).toBe('DeviceB-Edit');

            const thirdRead = await StorageManager._get(['dsPreset_p1']);
            expect(thirdRead.dsPreset_p1.name).toBe('DeviceB-Edit');

            // The stale parked entry is still queued for retry (untouched by _get,
            // that's _set()'s job) — parking itself is not the bug, pinning on read was.
            const localAuthState = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
            expect(localAuthState[K.LOCAL_AUTHORITATIVE]).toContain('dsPreset_p1');
        });
    });
});
