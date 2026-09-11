/**
 * Targeted tests for storage-manager.restore.js - restoreSettings()
 *
 * Goal: kill survived Stryker mutants on the !== undefined guards (lines 41-54),
 * the mergePresetsOnly branch, the presets/chatPresetMap guards, and the
 * empty-updates short-circuit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

const K = StorageManager.KEYS;

describe('restoreSettings - field-level guard coverage', () => {
    beforeEach(() => {
        chrome.storage.local.store = {};
        chrome.storage.sync.store = {};
        vi.restoreAllMocks();
    });

    const FIELD_MAP = [
        ['activePresetId',    K.ACTIVE_PRESET_ID,    'test-preset-id'],
        ['pinnedPresetId',    K.PINNED_PRESET_ID,    'pinned-123'],
        ['includeThinking',   K.INCLUDE_THINKING,    false],
        ['includeReferences', K.INCLUDE_REFERENCES,  false],
        ['globalDefaultPrompt', K.GLOBAL_DEFAULT_PROMPT, 'Be concise.'],
        ['sidebarAutoHide',   K.SIDEBAR_AUTO_HIDE,   true],
        ['hideThinking',      K.HIDE_THINKING,       true],
        ['isShowSystemTime',  K.SHOW_SYSTEM_TIME,    true],
        ['chatWidth',         K.CHAT_WIDTH,           90],
        ['chatWidthEnabled',  K.CHAT_WIDTH_ENABLED,  true],
        ['inputWidth',        K.INPUT_WIDTH,          85],
        ['inputWidthEnabled', K.INPUT_WIDTH_ENABLED,  true],
    ];

    describe.each(FIELD_MAP)(
        'field %s -> storage key %s',
        (importKey, storageKey, testValue) => {
            it('writes to storage when present in import', async () => {
                const spy = vi.spyOn(StorageManager, '_set');
                await StorageManager.restoreSettings({ [importKey]: testValue }, false);
                expect(spy).toHaveBeenCalledTimes(1);
                const passedUpdates = spy.mock.calls[0][0];
                expect(passedUpdates).toHaveProperty(storageKey, testValue);
            });

            it('does NOT include storage key when field is absent', async () => {
                const spy = vi.spyOn(StorageManager, '_set');
                const unrelatedField = importKey === 'chatWidth' ? 'hideThinking' : 'chatWidth';
                const unrelatedValue = importKey === 'chatWidth' ? true : 50;
                await StorageManager.restoreSettings({ [unrelatedField]: unrelatedValue }, false);
                expect(spy).toHaveBeenCalledTimes(1);
                const passedUpdates = spy.mock.calls[0][0];
                expect(passedUpdates).not.toHaveProperty(storageKey);
            });

            it('writes field even when its value is null', async () => {
                const spy = vi.spyOn(StorageManager, '_set');
                await StorageManager.restoreSettings({ [importKey]: null }, false);
                expect(spy).toHaveBeenCalledTimes(1);
                expect(spy.mock.calls[0][0]).toHaveProperty(storageKey, null);
            });

            it('writes field even when its value is false', async () => {
                const spy = vi.spyOn(StorageManager, '_set');
                await StorageManager.restoreSettings({ [importKey]: false }, false);
                expect(spy).toHaveBeenCalledTimes(1);
                expect(spy.mock.calls[0][0]).toHaveProperty(storageKey, false);
            });

            it('writes field even when its value is 0', async () => {
                const spy = vi.spyOn(StorageManager, '_set');
                await StorageManager.restoreSettings({ [importKey]: 0 }, false);
                expect(spy).toHaveBeenCalledTimes(1);
                expect(spy.mock.calls[0][0]).toHaveProperty(storageKey, 0);
            });

            it('writes field even when its value is empty string', async () => {
                const spy = vi.spyOn(StorageManager, '_set');
                await StorageManager.restoreSettings({ [importKey]: '' }, false);
                expect(spy).toHaveBeenCalledTimes(1);
                expect(spy.mock.calls[0][0]).toHaveProperty(storageKey, '');
            });
        }
    );

    describe('mergePresetsOnly = true', () => {
        it('does not write any individual setting fields', async () => {
            const spy = vi.spyOn(StorageManager, '_set');
            await StorageManager.restoreSettings({
                activePresetId: 'x',
                pinnedPresetId: 'y',
                includeThinking: false,
                includeReferences: false,
                globalDefaultPrompt: 'test',
                sidebarAutoHide: true,
                hideThinking: true,
                isShowSystemTime: true,
                chatWidth: 50,
                chatWidthEnabled: true,
                inputWidth: 60,
                inputWidthEnabled: true,
            }, true);
            expect(spy).not.toHaveBeenCalled();
        });

        it('still processes presets when mergePresetsOnly is true', async () => {
            const saveSpy = vi.spyOn(StorageManager, 'savePromptPresets').mockResolvedValue();
            vi.spyOn(StorageManager, 'mergePresets').mockReturnValue([]);
            vi.spyOn(StorageManager, 'clearPresetTombstones').mockResolvedValue();
            await StorageManager.restoreSettings({
                promptPresets: [{ id: 'p1', name: 'Test', content: 'hi' }],
                activePresetId: 'should-be-skipped',
            }, true);
            expect(saveSpy).toHaveBeenCalledTimes(1);
        });

        it('still processes chatPresetMap when mergePresetsOnly is true', async () => {
            const mutateSpy = vi.spyOn(StorageManager, 'mutateChatPresetMap').mockResolvedValue();
            await StorageManager.restoreSettings({
                chatPresetMap: { c1: 'p1' },
                activePresetId: 'should-be-skipped',
            }, true);
            expect(mutateSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('empty import object', () => {
        it('does not call _set when no fields are present', async () => {
            const spy = vi.spyOn(StorageManager, '_set');
            await StorageManager.restoreSettings({}, false);
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not call _set when all fields are undefined', async () => {
            const spy = vi.spyOn(StorageManager, '_set');
            await StorageManager.restoreSettings({
                activePresetId: undefined,
                pinnedPresetId: undefined,
            }, false);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('promptPresets handling', () => {
        it('calls savePromptPresets and clearPresetTombstones when present', async () => {
            const saveSpy = vi.spyOn(StorageManager, 'savePromptPresets').mockResolvedValue();
            const mergeSpy = vi.spyOn(StorageManager, 'mergePresets').mockReturnValue([]);
            const tombSpy = vi.spyOn(StorageManager, 'clearPresetTombstones').mockResolvedValue();
            const presets = [{ id: 'p1', name: 'Test', content: 'hello' }];
            await StorageManager.restoreSettings({ promptPresets: presets }, false);
            expect(mergeSpy).toHaveBeenCalledTimes(1);
            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(tombSpy).toHaveBeenCalledWith(['p1']);
        });

        it('skips preset processing when promptPresets is absent', async () => {
            const saveSpy = vi.spyOn(StorageManager, 'savePromptPresets').mockResolvedValue();
            await StorageManager.restoreSettings({ chatWidth: 50 }, false);
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it('skips preset processing when promptPresets is null', async () => {
            const saveSpy = vi.spyOn(StorageManager, 'savePromptPresets').mockResolvedValue();
            await StorageManager.restoreSettings({ promptPresets: null }, false);
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it('filters out falsy preset ids for tombstone clearing', async () => {
            vi.spyOn(StorageManager, 'savePromptPresets').mockResolvedValue();
            vi.spyOn(StorageManager, 'mergePresets').mockReturnValue([]);
            const tombSpy = vi.spyOn(StorageManager, 'clearPresetTombstones').mockResolvedValue();
            const presets = [{ id: 'p1' }, null, { id: '' }, { id: 'p2' }, { name: 'no-id' }];
            await StorageManager.restoreSettings({ promptPresets: presets }, false);
            expect(tombSpy).toHaveBeenCalledWith(['p1', 'p2']);
        });
    });

    describe('chatPresetMap handling', () => {
        it('merge function spreads existing then imported', async () => {
            const mutateSpy = vi.spyOn(StorageManager, 'mutateChatPresetMap')
                .mockImplementation(async (fn) => fn({}));
            await StorageManager.restoreSettings({
                chatPresetMap: { 'chat-new': 'preset-new' }
            }, false);
            expect(mutateSpy).toHaveBeenCalledTimes(1);
            const mergeFn = mutateSpy.mock.calls[0][0];
            const merged = mergeFn({ 'chat-existing': 'preset-existing' });
            expect(merged).toEqual({
                'chat-existing': 'preset-existing',
                'chat-new': 'preset-new',
            });
        });

        it('imported keys overwrite existing keys', async () => {
            const mutateSpy = vi.spyOn(StorageManager, 'mutateChatPresetMap')
                .mockImplementation(async (fn) => fn({}));
            await StorageManager.restoreSettings({
                chatPresetMap: { 'chat-1': 'new-preset' }
            }, false);
            const mergeFn = mutateSpy.mock.calls[0][0];
            const merged = mergeFn({ 'chat-1': 'old-preset' });
            expect(merged['chat-1']).toBe('new-preset');
        });
    });

    describe('local-only fields are not restored', () => {
        it('does not restore isEnabled even when present', async () => {
            const spy = vi.spyOn(StorageManager, '_set');
            await StorageManager.restoreSettings({ isEnabled: true, chatWidth: 50 }, false);
            expect(spy).toHaveBeenCalledTimes(1);
            const passedUpdates = spy.mock.calls[0][0];
            expect(passedUpdates).not.toHaveProperty(K.IS_ENABLED);
        });

        it('does not restore globalPromptEnabled even when present', async () => {
            const spy = vi.spyOn(StorageManager, '_set');
            await StorageManager.restoreSettings({ globalPromptEnabled: false, chatWidth: 50 }, false);
            expect(spy).toHaveBeenCalledTimes(1);
            const passedUpdates = spy.mock.calls[0][0];
            expect(passedUpdates).not.toHaveProperty(K.GLOBAL_PROMPT_ENABLED);
        });
    });

    describe('multiple fields in one call', () => {
        it('batches all present fields into one _set call', async () => {
            const spy = vi.spyOn(StorageManager, '_set');
            await StorageManager.restoreSettings({
                activePresetId: 'a',
                chatWidth: 80,
                hideThinking: true,
            }, false);
            expect(spy).toHaveBeenCalledTimes(1);
            const updates = spy.mock.calls[0][0];
            expect(updates).toEqual({
                [K.ACTIVE_PRESET_ID]: 'a',
                [K.CHAT_WIDTH]: 80,
                [K.HIDE_THINKING]: true,
            });
        });
    });

    describe('chatPresetMap false-guard (mutant kill)', () => {
        it('does NOT call mutateChatPresetMap when chatPresetMap is absent', async () => {
            const mutateSpy = vi.spyOn(StorageManager, 'mutateChatPresetMap').mockResolvedValue();
            await StorageManager.restoreSettings({ chatWidth: 50 }, false);
            expect(mutateSpy).not.toHaveBeenCalled();
        });

        it('does NOT call mutateChatPresetMap when chatPresetMap is undefined', async () => {
            const mutateSpy = vi.spyOn(StorageManager, 'mutateChatPresetMap').mockResolvedValue();
            await StorageManager.restoreSettings({ chatPresetMap: undefined, chatWidth: 50 }, false);
            expect(mutateSpy).not.toHaveBeenCalled();
        });

        it('does NOT call mutateChatPresetMap when chatPresetMap is null', async () => {
            const mutateSpy = vi.spyOn(StorageManager, 'mutateChatPresetMap').mockResolvedValue();
            await StorageManager.restoreSettings({ chatPresetMap: null, chatWidth: 50 }, false);
            expect(mutateSpy).not.toHaveBeenCalled();
        });
    });

    describe('return value', () => {
        it('returns the result of _set when updates exist', async () => {
            const sentinel = { ok: true };
            vi.spyOn(StorageManager, '_set').mockResolvedValue(sentinel);
            const result = await StorageManager.restoreSettings({ chatWidth: 50 }, false);
            expect(result).toBe(sentinel);
        });

        it('returns undefined when no updates to write', async () => {
            const result = await StorageManager.restoreSettings({}, false);
            expect(result).toBeUndefined();
        });
    });
});
