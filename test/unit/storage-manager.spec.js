import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

describe('StorageManager CRUD (3.x scenarios)', () => {
    beforeEach(() => {
        // Storage is cleared by vitest.setup.js beforeEach
    });

    describe('getSettings() — 3.1.x read / 3.2.x list', () => {
        it('returns default values when storage is empty', async () => {
            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(false);
            expect(settings.globalDefaultPrompt).toBe('');
            expect(settings.promptPresets).toEqual([]);
            expect(settings.activePresetId).toBe('');
            expect(settings.chatWidth).toBe(70);
            expect(settings.chatWidthEnabled).toBe(false);
            expect(settings.inputWidth).toBe(70);
            expect(settings.inputWidthEnabled).toBe(false);
            expect(settings.sidebarAutoHide).toBe(false);
            expect(settings.hideThinking).toBe(false);
        });

        it('returns values saved via saveEnabledState', async () => {
            await StorageManager.saveEnabledState(true);
            const settings = await StorageManager.getSettings();
            expect(settings.isEnabled).toBe(true);
        });

        it('returns values saved via saveGlobalDefaultPrompt', async () => {
            await StorageManager.saveGlobalDefaultPrompt('Be concise');
            const settings = await StorageManager.getSettings();
            expect(settings.globalDefaultPrompt).toBe('Be concise');
        });

        it('returns values saved via saveChatWidth', async () => {
            await StorageManager.saveChatWidth(50);
            const settings = await StorageManager.getSettings();
            expect(settings.chatWidth).toBe(50);
        });
    });

    describe('savePromptPresets() — 3.1.x create', () => {
        it('saves multiple presets and returns them via getSettings', async () => {
            const presets = [
                { id: 'p1', name: 'Helper', content: 'Helpful', createdAt: 1000, updatedAt: 1000 },
                { id: 'p2', name: 'Concise', content: 'Brief', createdAt: 2000, updatedAt: 2000 },
            ];
            await StorageManager.savePromptPresets(presets);

            const settings = await StorageManager.getSettings();
            expect(settings.promptPresets).toHaveLength(2);
            expect(settings.promptPresets).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'p1', name: 'Helper' }),
                    expect.objectContaining({ id: 'p2', name: 'Concise' }),
                ]),
            );
        });

        it('storing presets with same ID twice overwrites the previous entry', async () => {
            await StorageManager.savePromptPresets([
                { id: 'p1', name: 'Original', content: 'orig', createdAt: 1000, updatedAt: 1000 },
            ]);
            await StorageManager.savePromptPresets([
                { id: 'p1', name: 'Updated', content: 'new', createdAt: 1000, updatedAt: 2000 },
            ]);

            const settings = await StorageManager.getSettings();
            expect(settings.promptPresets).toHaveLength(1);
            expect(settings.promptPresets[0].name).toBe('Updated');
        });

        it('saving fewer presets removes the deleted ones (dsPresetIndex cleanup)', async () => {
            await StorageManager.savePromptPresets([
                { id: 'p1', name: 'P1', content: 'c1', createdAt: 1000, updatedAt: 1000 },
                { id: 'p2', name: 'P2', content: 'c2', createdAt: 1000, updatedAt: 1000 },
            ]);
            await StorageManager.savePromptPresets([
                { id: 'p1', name: 'P1', content: 'c1', createdAt: 1000, updatedAt: 1000 },
            ]);

            const settings = await StorageManager.getSettings();
            expect(settings.promptPresets).toHaveLength(1);
            expect(settings.promptPresets[0].id).toBe('p1');
        });

        it('store empty array clears all presets', async () => {
            await StorageManager.savePromptPresets([
                { id: 'p1', name: 'P1', content: 'c1', createdAt: 1000, updatedAt: 1000 },
            ]);
            await StorageManager.savePromptPresets([]);

            const settings = await StorageManager.getSettings();
            expect(settings.promptPresets).toEqual([]);
        });
    });

    describe('activePresetId — 3.1.x / 3.2.x', () => {
        it('saveActivePresetId persists the value', async () => {
            await StorageManager.saveActivePresetId('preset-1');
            const settings = await StorageManager.getSettings();
            expect(settings.activePresetId).toBe('preset-1');
        });

        it('saving empty string clears activePresetId', async () => {
            await StorageManager.saveActivePresetId('');
            const settings = await StorageManager.getSettings();
            expect(settings.activePresetId).toBe('');
        });
    });

    describe('chatPresetMap bind/unbind — 3.3.x removal interaction', () => {
        it('bindChatToPreset persists UUID→presetId mapping', async () => {
            await StorageManager.bindChatToPreset('uuid-1', 'preset-a');
            const settings = await StorageManager.getSettings();
            expect(settings.chatPresetMap).toEqual({ 'uuid-1': 'preset-a' });
        });

        it('unbindChat removes the mapping', async () => {
            await StorageManager.bindChatToPreset('uuid-1', 'preset-a');
            await StorageManager.unbindChat('uuid-1');
            const settings = await StorageManager.getSettings();
            expect(settings.chatPresetMap).toEqual({});
        });

        it('unbindChat does not affect other bindings', async () => {
            await StorageManager.bindChatToPreset('uuid-1', 'preset-a');
            await StorageManager.bindChatToPreset('uuid-2', 'preset-b');
            await StorageManager.unbindChat('uuid-1');

            const settings = await StorageManager.getSettings();
            expect(settings.chatPresetMap).toEqual({ 'uuid-2': 'preset-b' });
        });
    });

    describe('side-effects on storage keys', () => {
        it('savePromptPresets writes dsPresetIndex and individual dsPreset_ keys', async () => {
            const presets = [
                { id: 'p1', name: 'P1', content: 'c1', createdAt: 1000, updatedAt: 1000 },
            ];
            await StorageManager.savePromptPresets(presets);

            const syncData = await chrome.storage.sync.get(['dsPresetIndex', 'dsPreset_p1']);
            expect(syncData.dsPresetIndex).toEqual(['p1']);
            expect(syncData.dsPreset_p1).toEqual(presets[0]);
        });
    });

    describe('showSystemTime toggle storage', () => {
        it('returns default value false when showSystemTime not set', async () => {
            const settings = await StorageManager.getSettings();
            expect(settings.showSystemTime).toBe(false);
        });

        it('saveShowSystemTime persists the enabled state', async () => {
            await StorageManager.saveShowSystemTime(true);
            const settings = await StorageManager.getSettings();
            expect(settings.showSystemTime).toBe(true);
        });

        it('saveShowSystemTime can toggle from true to false', async () => {
            await StorageManager.saveShowSystemTime(true);
            let settings = await StorageManager.getSettings();
            expect(settings.showSystemTime).toBe(true);

            await StorageManager.saveShowSystemTime(false);
            settings = await StorageManager.getSettings();
            expect(settings.showSystemTime).toBe(false);
        });

        it('showSystemTime survives round-trip: save and retrieve', async () => {
            await StorageManager.saveShowSystemTime(true);
            const settings1 = await StorageManager.getSettings();
            expect(settings1.showSystemTime).toBe(true);

            const settings2 = await StorageManager.getSettings();
            expect(settings2.showSystemTime).toBe(true);
        });
    });
});
