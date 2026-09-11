/**
 * Kills Stryker mutant: storage-manager.restore.js line 32
 * Mutator: ConditionalExpression — `if (importedSettings.chatPresetMap)` → `if (true)`
 *
 * Requirement: when restoring settings from an imported backup that does NOT
 * include a chatPresetMap (undefined / null / missing key), the restore
 * function MUST skip chatPresetMap processing entirely — it must not corrupt,
 * clear, or replace the existing chatPresetMap already in storage.
 */
import { describe, it, expect } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

describe('restoreSettings — chatPresetMap guard (mutant kill)', () => {
    it('preserves existing chatPresetMap when imported data omits chatPresetMap entirely', async () => {
        // Seed an existing binding
        await StorageManager.bindChatToPreset('chat-aaa', 'preset-111');

        // Restore settings that do NOT include chatPresetMap
        await StorageManager.restoreSettings({ chatWidth: 50 }, false);

        const settings = await StorageManager.getSettings();
        expect(settings.chatPresetMap).toEqual({ 'chat-aaa': 'preset-111' });
    });

    it('preserves existing chatPresetMap when imported data has chatPresetMap as undefined', async () => {
        await StorageManager.bindChatToPreset('chat-bbb', 'preset-222');

        await StorageManager.restoreSettings({ chatPresetMap: undefined, chatWidth: 50 }, false);

        const settings = await StorageManager.getSettings();
        expect(settings.chatPresetMap).toEqual({ 'chat-bbb': 'preset-222' });
    });

    it('preserves existing chatPresetMap when imported data has chatPresetMap as null', async () => {
        await StorageManager.bindChatToPreset('chat-ccc', 'preset-333');

        await StorageManager.restoreSettings({ chatPresetMap: null, chatWidth: 50 }, false);

        const settings = await StorageManager.getSettings();
        expect(settings.chatPresetMap).toEqual({ 'chat-ccc': 'preset-333' });
    });
});
