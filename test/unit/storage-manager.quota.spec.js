import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('StorageManager quote error fallback (savePromptPresets)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete chrome.runtime.lastError;
    });

    afterEach(() => {
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;
        vi.restoreAllMocks();
    });

    it('does not throw when sync.set fails with quota error', async () => {
        chrome.storage.sync.setQuotaError(true);

        const presets = [
            { id: 'p1', name: 'Helper', content: 'helpful', createdAt: 1000, updatedAt: 1000 },
        ];

        await expect(
            StorageManager.savePromptPresets(presets)
        ).resolves.toBeUndefined();
    });

    it('writes PRESET_INDEX to local storage when sync quota is exceeded', async () => {
        chrome.storage.sync.setQuotaError(true);

        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Helper', content: 'helpful', createdAt: 1000, updatedAt: 1000 },
        ]);

        const localData = await chrome.storage.local.get([K.PRESET_INDEX]);
        expect(localData[K.PRESET_INDEX]).toEqual(['p1']);
    });

    it('writes individual preset data to local storage when sync quota is exceeded', async () => {
        chrome.storage.sync.setQuotaError(true);

        const preset = { id: 'p1', name: 'Helper', content: 'helpful', createdAt: 1000, updatedAt: 1000 };
        await StorageManager.savePromptPresets([preset]);

        const localData = await chrome.storage.local.get(['dsPreset_p1']);
        expect(localData.dsPreset_p1).toEqual(preset);
    });

    it('adds keys to dsLocalAuth when sync quota fallback occurs', async () => {
        chrome.storage.sync.setQuotaError(true);

        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Helper', content: 'helpful', createdAt: 1000, updatedAt: 1000 },
        ]);

        const localData = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        const auth = localData[K.LOCAL_AUTHORITATIVE] || [];
        // PRESET_INDEX and dsPreset_p1 should be in the authoritative list
        expect(auth).toContain(K.PRESET_INDEX);
        expect(auth).toContain('dsPreset_p1');
    });

    it('logs a warning when sync quota is exceeded', async () => {
        chrome.storage.sync.setQuotaError(true);

        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Helper', content: 'helpful', createdAt: 1000, updatedAt: 1000 },
        ]);

        expect(console.warn).toHaveBeenCalled();
        const warnMsg = console.warn.mock.calls[0][0];
        expect(warnMsg).toContain('quota');
    });

    it('retrieves settings correctly after quota fallback', async () => {
        chrome.storage.sync.setQuotaError(true);

        const presets = [
            { id: 'p1', name: 'Helper', content: 'helpful', createdAt: 1000, updatedAt: 1000 },
            { id: 'p2', name: 'Concise', content: 'brief', createdAt: 2000, updatedAt: 2000 },
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

    it('recovers from quota error on subsequent successful saves', async () => {
        // First save with quota error
        chrome.storage.sync.setQuotaError(true);
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Fallback', content: 'fb', createdAt: 1000, updatedAt: 1000 },
        ]);

        // Second save without quota error
        chrome.storage.sync.setQuotaError(false);
        delete chrome.runtime.lastError;

        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Fallback', content: 'recovered', createdAt: 1000, updatedAt: 2000 },
        ]);

        const settings = await StorageManager.getSettings();
        expect(settings.promptPresets[0].content).toBe('recovered');

        // dsLocalAuth should have been cleaned up for the recovered keys
        const localData = await chrome.storage.local.get([K.LOCAL_AUTHORITATIVE]);
        const auth = localData[K.LOCAL_AUTHORITATIVE] || [];
        expect(auth).not.toContain(K.PRESET_INDEX);
        expect(auth).not.toContain('dsPreset_p1');
    });
});
