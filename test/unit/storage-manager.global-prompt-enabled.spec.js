/**
 * Tests for GLOBAL_PROMPT_ENABLED key in StorageManager:
 *   - getSettings() default when unset
 *   - saveGlobalPromptEnabled() persists the key
 *   - restoreSettings() imports it
 *   - export→import round-trip preserves the value
 */
import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

describe('StorageManager — globalPromptEnabled', () => {
    beforeEach(() => {
        // Storage cleared by vitest.setup.js beforeEach
    });

    it('getSettings() returns default true when globalPromptEnabled is not set', async () => {
        const settings = await StorageManager.getSettings();
        expect(settings.globalPromptEnabled).toBe(true);
    });

    it('saveGlobalPromptEnabled(false) persists the key and getSettings reflects it', async () => {
        await StorageManager.saveGlobalPromptEnabled(false);
        const settings = await StorageManager.getSettings();
        expect(settings.globalPromptEnabled).toBe(false);
    });

    it('saveGlobalPromptEnabled(true) persists the key as true', async () => {
        // First set to false, then back to true
        await StorageManager.saveGlobalPromptEnabled(false);
        await StorageManager.saveGlobalPromptEnabled(true);
        const settings = await StorageManager.getSettings();
        expect(settings.globalPromptEnabled).toBe(true);
    });

    it('restoreSettings() imports globalPromptEnabled from the imported settings object', async () => {
        await StorageManager.restoreSettings({ globalPromptEnabled: false });
        const settings = await StorageManager.getSettings();
        expect(settings.globalPromptEnabled).toBe(false);
    });

    it('restoreSettings() does not overwrite when mergePresetsOnly=true', async () => {
        await StorageManager.saveGlobalPromptEnabled(true);
        await StorageManager.restoreSettings({ globalPromptEnabled: false }, true);
        const settings = await StorageManager.getSettings();
        // mergePresetsOnly=true skips non-preset keys; value should remain true
        expect(settings.globalPromptEnabled).toBe(true);
    });

    it('export(getSettings) → import(restoreSettings) round-trip preserves globalPromptEnabled', async () => {
        // Save a known value
        await StorageManager.saveGlobalPromptEnabled(false);
        const exported = await StorageManager.getSettings();
        expect(exported.globalPromptEnabled).toBe(false);

        // Simulate a fresh state by setting to true
        await StorageManager.saveGlobalPromptEnabled(true);

        // Restore from the exported snapshot
        await StorageManager.restoreSettings({ globalPromptEnabled: exported.globalPromptEnabled });
        const restored = await StorageManager.getSettings();
        expect(restored.globalPromptEnabled).toBe(false);
    });
});
