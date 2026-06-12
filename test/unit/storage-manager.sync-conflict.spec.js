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

    describe('dsLocalAuth Plan A tracking — Plan A: local values preferred', () => {
        it('_get prefers local value when dsLocalAuth lists the key', async () => {
            await chrome.storage.local.set({ isEnabled: true, [K.LOCAL_AUTHORITATIVE]: ['isEnabled'] });
            await chrome.storage.sync.set({ isEnabled: false });
            const result = await StorageManager._get(['isEnabled']);
            expect(result.isEnabled).toBe(true);
        });

        it('_get does NOT prefer local when dsLocalAuth is empty', async () => {
            await chrome.storage.local.set({ isEnabled: true });
            await chrome.storage.sync.set({ isEnabled: false });
            const result = await StorageManager._get(['isEnabled']);
            // Without dsLocalAuth, sync value takes precedence
            expect(result.isEnabled).toBe(false);
        });

        it('_set success branch removes saved keys from dsLocalAuth', async () => {
            await chrome.storage.local.set({ [K.LOCAL_AUTHORITATIVE]: ['isEnabled'], isEnabled: false });
            await StorageManager.saveEnabledState(true);
            const data = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
            const auth = data[K.LOCAL_AUTHORITATIVE] || [];
            expect(auth).not.toContain('isEnabled');
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
        it('sets syncConflictPending when local and sync differ on first sync', async () => {
            await seedAllDefaults({
                [K.PRESET_INDEX]: ['p1', 'p2'],
                dsPreset_p1: { id: 'p1', name: 'Local', content: 'local', createdAt: 1, updatedAt: 1 },
                dsPreset_p2: { id: 'p2', name: 'Both', content: 'old', createdAt: 1, updatedAt: 50 },
            });

            // Sync has a different version of p2 but also a new p3
            await chrome.storage.sync.set({
                [K.PRESET_INDEX]: ['p2', 'p3'],
                dsPreset_p2: { id: 'p2', name: 'Both', content: 'new', createdAt: 1, updatedAt: 200 },
                dsPreset_p3: { id: 'p3', name: 'Sync', content: 's3', createdAt: 1, updatedAt: 300 },
            });

            await StorageManager.initialize();

            const state = await chrome.storage.local.get([K.SYNC_CONFLICT_PENDING]);
            expect(state[K.SYNC_CONFLICT_PENDING]).toBe(true);
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
            await StorageManager.saveEnabledState(true);

            await StorageManager.restoreSettings({
                isEnabled: false,
            }, false);

            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(false);
        });
    });
});
