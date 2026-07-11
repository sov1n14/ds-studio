import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

beforeAll(() => {
    // popup.preset-manager.js references the global dsI18n.t(...), so i18n
    // must be loaded and initialized first.
    if (!globalThis.dsI18n) {
        const i18nCode = readFileSync(resolve(__dirname, '../../utils/i18n.js'), 'utf-8');
        eval('var chrome=globalThis.chrome,document=globalThis.document,window=globalThis;' + i18nCode);
    }

    const code = readFileSync(resolve(__dirname, '../../popup/popup.preset-manager.js'), 'utf-8');
    eval(code);
});

beforeEach(async () => {
    if (globalThis.dsI18n) {
        globalThis.dsI18n._reset();
        await globalThis.dsI18n.init();
    }
});

function makePresets() {
    return [
        { id: 'a', name: 'Alpha', content: '' },
        { id: 'b', name: 'Beta', content: '' },
        { id: 'c', name: 'Gamma', content: '' },
    ];
}

/**
 * Builds a fresh mock ctx object mirroring the shape createPresetManager
 * expects, plus spies to assert on. `presets` / `activePresetId` /
 * `chatPresetMap` are mutable closures so setPresets()/setActivePresetId()
 * calls are observable.
 */
function makeCtx({ presets = makePresets(), activePresetId = '', chatPresetMap = {}, confirmResult = true } = {}) {
    let _presets = presets;
    let _activePresetId = activePresetId;
    let _chatPresetMap = chatPresetMap;

    const customSelect = { render: vi.fn() };

    const StorageManager = {
        savePromptPresets: vi.fn().mockResolvedValue(undefined),
        saveActivePresetId: vi.fn().mockResolvedValue(undefined),
        mutateChatPresetMap: vi.fn(async (mutator) => {
            const map = { ..._chatPresetMap };
            mutator(map);
            _chatPresetMap = map;
            return map;
        }),
    };

    const Modal = {
        confirm: vi.fn().mockResolvedValue(confirmResult),
        prompt: vi.fn(),
    };

    const ctx = {
        getPresets: vi.fn(() => _presets),
        setPresets: vi.fn((next) => { _presets = next; }),
        getActivePresetId: vi.fn(() => _activePresetId),
        setActivePresetId: vi.fn((id) => { _activePresetId = id; }),
        getChatPresetMap: vi.fn(() => _chatPresetMap),
        setChatPresetMap: vi.fn((map) => { _chatPresetMap = map; }),
        getCustomSelect: vi.fn(() => customSelect),
        refreshSyncStatus: vi.fn().mockResolvedValue(undefined),
        showSaveStatus: vi.fn(),
        updateEditPresetBtnState: vi.fn(),
        sendActivePresetToContentScript: vi.fn(),
        Modal,
        StorageManager,
    };

    return {
        ctx,
        customSelect,
        Modal,
        StorageManager,
        getPresets: () => _presets,
        getActivePresetId: () => _activePresetId,
        getChatPresetMap: () => _chatPresetMap,
    };
}

describe('createPresetManager().requestDeleteAllPresets()', () => {
    it('is a no-op (shows no Modal) when presets is already empty', async () => {
        const { ctx, Modal, StorageManager } = makeCtx({ presets: [] });
        const manager = window.__DS_PopupPresetManager.createPresetManager(ctx);

        await manager.requestDeleteAllPresets();

        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
        expect(ctx.setPresets).not.toHaveBeenCalled();
    });

    describe('cancel path (Modal.confirm resolves false)', () => {
        it('leaves presets/activePresetId unchanged and makes no StorageManager calls', async () => {
            const initialPresets = makePresets();
            const { ctx, StorageManager, getPresets, getActivePresetId } = makeCtx({
                presets: initialPresets,
                activePresetId: 'a',
                confirmResult: false,
            });
            const manager = window.__DS_PopupPresetManager.createPresetManager(ctx);

            await manager.requestDeleteAllPresets();

            expect(getPresets()).toBe(initialPresets);
            expect(getPresets().length).toBe(3);
            expect(getActivePresetId()).toBe('a');
            expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
            expect(StorageManager.saveActivePresetId).not.toHaveBeenCalled();
            expect(StorageManager.mutateChatPresetMap).not.toHaveBeenCalled();
            expect(ctx.setPresets).not.toHaveBeenCalled();
        });
    });

    describe('confirm path (Modal.confirm resolves true)', () => {
        it('empties presets and resets activePresetId, persisting both via StorageManager', async () => {
            const { ctx, StorageManager, getPresets, getActivePresetId } = makeCtx({
                presets: makePresets(),
                activePresetId: 'b',
                confirmResult: true,
            });
            const manager = window.__DS_PopupPresetManager.createPresetManager(ctx);

            await manager.requestDeleteAllPresets();

            expect(getPresets()).toEqual([]);
            expect(getActivePresetId()).toBe('');
            expect(StorageManager.savePromptPresets).toHaveBeenCalledWith([]);
            expect(StorageManager.saveActivePresetId).toHaveBeenCalledWith('');
        });

        it('removes every chatPresetMap entry that referenced any previously-existing preset id', async () => {
            const { ctx, getChatPresetMap } = makeCtx({
                presets: makePresets(), // ids: a, b, c
                chatPresetMap: {
                    'chat-1': 'a',
                    'chat-2': 'b',
                    'chat-3': 'c',
                    'chat-4': 'unrelated-id-not-in-presets',
                },
                confirmResult: true,
            });
            const manager = window.__DS_PopupPresetManager.createPresetManager(ctx);

            await manager.requestDeleteAllPresets();

            const finalMap = getChatPresetMap();
            expect(finalMap).not.toHaveProperty('chat-1');
            expect(finalMap).not.toHaveProperty('chat-2');
            expect(finalMap).not.toHaveProperty('chat-3');
            // Entries pointing at ids that were never valid presets are left untouched
            // by this deletion pass (mirrors the single-delete path's behavior of only
            // pruning ids that belonged to the presets array at time of deletion).
            expect(finalMap['chat-4']).toBe('unrelated-id-not-in-presets');
        });

        it('invokes the expected post-confirm UI refresh side effects', async () => {
            const { ctx, customSelect } = makeCtx({ presets: makePresets(), confirmResult: true });
            const manager = window.__DS_PopupPresetManager.createPresetManager(ctx);

            await manager.requestDeleteAllPresets();

            expect(customSelect.render).toHaveBeenCalled();
            expect(ctx.updateEditPresetBtnState).toHaveBeenCalled();
            expect(ctx.showSaveStatus).toHaveBeenCalled();
            expect(ctx.sendActivePresetToContentScript).toHaveBeenCalled();
            expect(ctx.refreshSyncStatus).toHaveBeenCalled();
        });

        it('shows the Modal with the deleteAllPresetsTitle/deleteAllPresetsMessage i18n copy', async () => {
            const { ctx, Modal } = makeCtx({ presets: makePresets(), confirmResult: true });
            const manager = window.__DS_PopupPresetManager.createPresetManager(ctx);

            await manager.requestDeleteAllPresets();

            expect(Modal.confirm).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: dsI18n.t('deleteAllPresetsTitle'),
                    message: dsI18n.t('deleteAllPresetsMessage'),
                    variant: 'danger',
                })
            );
        });
    });
});
