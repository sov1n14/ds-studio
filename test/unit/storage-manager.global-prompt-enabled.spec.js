/**
 * Tests for the local-only settings introduced by report.md §4.3 (Step 3):
 *   - isEnabled (master function toggle)
 *   - globalPromptEnabled (global-prompt toggle)
 *
 * Both keys were converted from synced settings to device-local-only settings:
 *   - saveEnabledState/saveGlobalPromptEnabled write chrome.storage.local directly,
 *     never touching chrome.storage.sync. (The paired getEnabledState/
 *     getGlobalPromptEnabled getters were dead code and have since been removed —
 *     getSettings() is the only read path for these two keys.)
 *   - getSettings() sources isEnabled/globalPromptEnabled from local storage only.
 *   - resolveSyncConflict() never restores/overwrites these two keys from a sync payload.
 *   - restoreSettings() (import/backup restore) does NOT set these two keys from an
 *     imported payload.
 *
 * globalDefaultPrompt (the prompt CONTENT, as opposed to the toggle) is unaffected by
 * this change and continues to sync normally — covered at the bottom of this file.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('StorageManager — isEnabled / globalPromptEnabled (local-only, report.md §4.3)', () => {
    beforeEach(() => {
        // Storage cleared by vitest.setup.js beforeEach
    });

    describe('getSettings() defaults', () => {
        it('returns default globalPromptEnabled=true when not set', async () => {
            const settings = await StorageManager.getSettings();
            expect(settings.globalPromptEnabled).toBe(true);
        });

        it('returns default isEnabled when not set', async () => {
            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(StorageManager.DEFAULTS[K.IS_ENABLED]);
        });
    });

    describe('saveGlobalPromptEnabled / getGlobalPromptEnabled — local storage only', () => {
        it('saveGlobalPromptEnabled(false) writes only to chrome.storage.local, never to sync', async () => {
            await StorageManager.saveGlobalPromptEnabled(false);

            const localData = await chrome.storage.local.get([K.GLOBAL_PROMPT_ENABLED]);
            expect(localData[K.GLOBAL_PROMPT_ENABLED]).toBe(false);

            const syncData = await chrome.storage.sync.get([K.GLOBAL_PROMPT_ENABLED]);
            expect(syncData[K.GLOBAL_PROMPT_ENABLED]).toBeUndefined();
        });

        it('saveGlobalPromptEnabled(true) persists true and getSettings reflects it', async () => {
            await StorageManager.saveGlobalPromptEnabled(false);
            await StorageManager.saveGlobalPromptEnabled(true);
            const settings = await StorageManager.getSettings();
            expect(settings.globalPromptEnabled).toBe(true);
        });

        it('getSettings() reflects globalPromptEnabled from local even if a stale value exists in sync', async () => {
            // Simulate a stale/foreign sync value that must NOT leak into settings.
            await chrome.storage.sync.set({ [K.GLOBAL_PROMPT_ENABLED]: false });
            await chrome.storage.local.set({ [K.GLOBAL_PROMPT_ENABLED]: true });

            const settings = await StorageManager.getSettings();
            expect(settings.globalPromptEnabled).toBe(true);
        });
    });

    describe('saveEnabledState / getEnabledState — local storage only', () => {
        it('saveEnabledState(false) writes only to chrome.storage.local, never to sync', async () => {
            await StorageManager.saveEnabledState(false);

            const localData = await chrome.storage.local.get([K.IS_ENABLED]);
            expect(localData[K.IS_ENABLED]).toBe(false);

            const syncData = await chrome.storage.sync.get([K.IS_ENABLED]);
            expect(syncData[K.IS_ENABLED]).toBeUndefined();
        });

        it('getSettings() reflects isEnabled from local even if a stale value exists in sync', async () => {
            await chrome.storage.sync.set({ [K.IS_ENABLED]: false });
            await chrome.storage.local.set({ [K.IS_ENABLED]: true });

            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(true);
        });
    });

    describe('resolveSyncConflict() never restores these two keys from a sync payload', () => {
        it('preserves the local isEnabled/globalPromptEnabled values across a sync-conflict resolve', async () => {
            // Local device state: user has disabled both toggles on this device.
            await StorageManager.saveEnabledState(false);
            await StorageManager.saveGlobalPromptEnabled(false);

            // A conflicting cloud snapshot with different (would-be) values for these keys.
            // resolveSyncConflict merges `updates = { ...localRaw, ...syncRaw }` but must
            // delete isEnabled/globalPromptEnabled from the merged result before writing.
            await chrome.storage.sync.set({
                [K.IS_ENABLED]: true,
                [K.GLOBAL_PROMPT_ENABLED]: true,
                dsPresetIndex: [],
            });

            await StorageManager.resolveSyncConflict();

            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(false);
            expect(settings.globalPromptEnabled).toBe(false);

            // Local storage must still hold the device's own (unmerged) values —
            // resolveSyncConflict's `updates` payload must never have carried the
            // cloud-side isEnabled/globalPromptEnabled into local storage either.
            const localAfter = await chrome.storage.local.get([K.IS_ENABLED, K.GLOBAL_PROMPT_ENABLED]);
            expect(localAfter[K.IS_ENABLED]).toBe(false);
            expect(localAfter[K.GLOBAL_PROMPT_ENABLED]).toBe(false);
        });
    });

    describe('restoreSettings() (import/backup restore) — regression: must NOT set these two keys', () => {
        it('does not set isEnabled from an imported payload (deliberate change from prior behavior)', async () => {
            await StorageManager.saveEnabledState(true);

            await StorageManager.restoreSettings({ isEnabled: false });

            const settings = await StorageManager.getSettings();
            // Local device value must remain untouched by the import.
            expect(settings.isEnabled).toBe(true);
        });

        it('does not set globalPromptEnabled from an imported payload (deliberate change from prior behavior)', async () => {
            await StorageManager.saveGlobalPromptEnabled(true);

            await StorageManager.restoreSettings({ globalPromptEnabled: false });

            const settings = await StorageManager.getSettings();
            // Local device value must remain untouched by the import.
            expect(settings.globalPromptEnabled).toBe(true);
        });

        it('restoreSettings() with mergePresetsOnly=false still does not import isEnabled/globalPromptEnabled', async () => {
            await StorageManager.saveEnabledState(true);
            await StorageManager.saveGlobalPromptEnabled(true);

            await StorageManager.restoreSettings(
                { isEnabled: false, globalPromptEnabled: false, includeThinking: true },
                false,
            );

            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(true);
            expect(settings.globalPromptEnabled).toBe(true);
            // Sanity check: other (still-synced) settings ARE imported in the same call.
            expect(settings.includeThinking).toBe(true);
        });
    });

    describe('globalDefaultPrompt (content) — unaffected, still syncs normally', () => {
        it('saveGlobalDefaultPrompt writes the prompt content to chrome.storage.sync', async () => {
            await StorageManager.saveGlobalDefaultPrompt('hello world');

            const syncData = await chrome.storage.sync.get([K.GLOBAL_DEFAULT_PROMPT]);
            expect(syncData[K.GLOBAL_DEFAULT_PROMPT]).toBe('hello world');
        });

        it('restoreSettings() DOES import globalDefaultPrompt even though the toggle is excluded', async () => {
            await StorageManager.restoreSettings({ globalDefaultPrompt: 'imported content' });

            const settings = await StorageManager.getSettings();
            expect(settings.globalDefaultPrompt).toBe('imported content');
        });

        it('getSettings() reflects globalDefaultPrompt content independently of the local-only toggle', async () => {
            await StorageManager.saveGlobalPromptEnabled(false);
            await StorageManager.saveGlobalDefaultPrompt('content unaffected by toggle state');

            const settings = await StorageManager.getSettings();
            expect(settings.globalPromptEnabled).toBe(false);
            expect(settings.globalDefaultPrompt).toBe('content unaffected by toggle state');
        });
    });
});
