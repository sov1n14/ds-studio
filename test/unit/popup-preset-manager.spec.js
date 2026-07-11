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

    // popup.preset-manager.js (post-refactor) is a plain classic-script module —
    // top-level `async function requestAddPreset(popupState) {...}` etc, no
    // window.__DS_PopupPresetManager bridge. It also references bare globals
    // Modal / StorageManager / refreshSyncStatus / updateEditPresetBtnState /
    // showSaveStatus / sendActivePresetToContentScript (all top-level in
    // popup.js in production; stubbed as globalThis properties below).
    // A direct eval() inside this strict-mode ESM test module would NOT leak
    // these function declarations to the global scope, so indirect eval is
    // used instead.
    const code = readFileSync(resolve(__dirname, '../../popup/popup.preset-manager.js'), 'utf-8');
    const globalEval = eval;
    globalEval(code);
    if (typeof globalThis.requestAddPreset !== 'function') {
        throw new Error('requestAddPreset was not exposed as a global after eval');
    }
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
 * Builds a fresh popupState object (mirrors popup.js's shared state shape) plus
 * stubs the bare-global collaborators requestAddPreset/requestEditPreset/etc
 * call directly (Modal, StorageManager, refreshSyncStatus, ...).
 */
function makePopupState({ presets = makePresets(), activePresetId = '', chatPresetMap = {}, currentTabUuid } = {}) {
    const customSelect = { render: vi.fn() };
    const popupState = {
        presets,
        activePresetId,
        chatPresetMap,
        currentTabUuid,
        customSelect,
        globalEditorWindowId: null,
        presetEditorWindowId: null,
    };
    return { popupState, customSelect };
}

function stubCollaborators({ confirmResult = true, promptResult = null } = {}) {
    let _chatPresetMap;

    const StorageManager = {
        savePromptPresets: vi.fn().mockResolvedValue(undefined),
        saveActivePresetId: vi.fn().mockResolvedValue(undefined),
        mutateChatPresetMap: vi.fn(async (mutator) => {
            const map = { ..._chatPresetMap };
            mutator(map);
            _chatPresetMap = map;
            return map;
        }),
        getSettings: vi.fn().mockResolvedValue({ chatPresetMap: {} }),
        bindChatToPreset: vi.fn().mockResolvedValue(undefined),
    };

    const Modal = {
        confirm: vi.fn().mockResolvedValue(confirmResult),
        prompt: vi.fn().mockResolvedValue(promptResult),
    };

    globalThis.StorageManager = StorageManager;
    globalThis.Modal = Modal;
    globalThis.refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    globalThis.showSaveStatus = vi.fn();
    globalThis.updateEditPresetBtnState = vi.fn();
    globalThis.sendActivePresetToContentScript = vi.fn();

    return { StorageManager, Modal, setChatPresetMap: (m) => { _chatPresetMap = m; } };
}

describe('requestAddPreset(popupState)', () => {
    it('does nothing when Modal.prompt resolves falsy (user cancels)', async () => {
        const { StorageManager, Modal } = stubCollaborators({ promptResult: null });
        const { popupState } = makePopupState({ presets: [] });

        await requestAddPreset(popupState);

        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
        expect(popupState.presets).toHaveLength(0);
    });

    it('warns via Modal.confirm and does not add when name duplicates an existing preset', async () => {
        const { StorageManager, Modal } = stubCollaborators({ promptResult: 'Alpha' });
        const { popupState } = makePopupState();

        await requestAddPreset(popupState);

        expect(Modal.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ title: dsI18n.t('duplicateNameTitle') })
        );
        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
        expect(popupState.presets).toHaveLength(3);
    });

    it('appends a new preset, sets it active, and persists via StorageManager', async () => {
        stubCollaborators({ promptResult: 'Delta' });
        const { popupState, customSelect } = makePopupState();

        await requestAddPreset(popupState);

        expect(popupState.presets).toHaveLength(4);
        const added = popupState.presets[3];
        expect(added.name).toBe('Delta');
        expect(popupState.activePresetId).toBe(added.id);
        expect(customSelect.render).toHaveBeenCalled();
        expect(globalThis.showSaveStatus).toHaveBeenCalled();
        expect(globalThis.sendActivePresetToContentScript).toHaveBeenCalled();
    });

    it('binds the new preset to the current tab when currentTabUuid is set', async () => {
        const { StorageManager } = stubCollaborators({ promptResult: 'Delta' });
        const { popupState } = makePopupState({ currentTabUuid: 'uuid-1' });

        await requestAddPreset(popupState);

        expect(StorageManager.bindChatToPreset).toHaveBeenCalledWith('uuid-1', popupState.activePresetId);
    });
});

describe('requestEditPreset(popupState, id)', () => {
    it('is a no-op when id does not match any preset', async () => {
        const { StorageManager } = stubCollaborators();
        const { popupState } = makePopupState();

        await requestEditPreset(popupState, 'missing-id');

        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
    });

    it('does nothing when the new name equals the current name or is empty', async () => {
        const { StorageManager, Modal } = stubCollaborators({ promptResult: 'Alpha' });
        const { popupState } = makePopupState();

        await requestEditPreset(popupState, 'a');

        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
        expect(Modal.prompt).toHaveBeenCalled();
    });

    it('renames the preset and persists via StorageManager when the name is unique', async () => {
        const { StorageManager } = stubCollaborators({ promptResult: 'Renamed' });
        const { popupState, customSelect } = makePopupState();

        await requestEditPreset(popupState, 'a');

        expect(popupState.presets.find(p => p.id === 'a').name).toBe('Renamed');
        expect(StorageManager.savePromptPresets).toHaveBeenCalledWith(popupState.presets);
        expect(customSelect.render).toHaveBeenCalled();
    });

    it('warns via Modal.confirm and does not rename when the new name duplicates another preset', async () => {
        const { StorageManager, Modal } = stubCollaborators({ promptResult: 'Beta' });
        const { popupState } = makePopupState();

        await requestEditPreset(popupState, 'a');

        expect(Modal.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ title: dsI18n.t('duplicateNameTitlePresetManager') })
        );
        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
        expect(popupState.presets.find(p => p.id === 'a').name).toBe('Alpha');
    });
});

describe('requestDeletePreset(popupState, id)', () => {
    it('is a no-op when id does not match any preset', async () => {
        const { StorageManager, Modal } = stubCollaborators();
        const { popupState } = makePopupState();

        await requestDeletePreset(popupState, 'missing-id');

        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
    });

    it('does nothing when the user cancels the confirm dialog', async () => {
        const { StorageManager } = stubCollaborators({ confirmResult: false });
        const { popupState } = makePopupState();

        await requestDeletePreset(popupState, 'b');

        expect(popupState.presets).toHaveLength(3);
        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
    });

    it('removes the preset, clears activePresetId if it was active, and prunes chatPresetMap', async () => {
        const { StorageManager, setChatPresetMap } = stubCollaborators({ confirmResult: true });
        setChatPresetMap({ 'chat-1': 'b', 'chat-2': 'a' });
        const { popupState, customSelect } = makePopupState({ activePresetId: 'b' });

        await requestDeletePreset(popupState, 'b');

        expect(popupState.presets.map(p => p.id)).toEqual(['a', 'c']);
        expect(popupState.activePresetId).toBe('');
        expect(StorageManager.saveActivePresetId).toHaveBeenCalledWith('');
        expect(popupState.chatPresetMap).not.toHaveProperty('chat-1');
        expect(popupState.chatPresetMap['chat-2']).toBe('a');
        expect(customSelect.render).toHaveBeenCalled();
    });

    it('leaves activePresetId untouched when deleting a non-active preset', async () => {
        stubCollaborators({ confirmResult: true });
        const { popupState } = makePopupState({ activePresetId: 'a' });

        await requestDeletePreset(popupState, 'b');

        expect(popupState.activePresetId).toBe('a');
    });
});

describe('requestDeleteAllPresets(popupState)', () => {
    it('is a no-op (shows no Modal) when presets is already empty', async () => {
        const { StorageManager, Modal } = stubCollaborators();
        const { popupState } = makePopupState({ presets: [] });

        await requestDeleteAllPresets(popupState);

        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
        expect(popupState.presets).toEqual([]);
    });

    it('leaves presets/activePresetId unchanged when the user cancels', async () => {
        const { StorageManager } = stubCollaborators({ confirmResult: false });
        const { popupState } = makePopupState({ activePresetId: 'a' });

        await requestDeleteAllPresets(popupState);

        expect(popupState.presets).toHaveLength(3);
        expect(popupState.activePresetId).toBe('a');
        expect(StorageManager.savePromptPresets).not.toHaveBeenCalled();
    });

    it('empties presets, resets activePresetId, and prunes every chatPresetMap entry', async () => {
        const { StorageManager, setChatPresetMap } = stubCollaborators({ confirmResult: true });
        setChatPresetMap({ 'chat-1': 'a', 'chat-2': 'b', 'chat-3': 'unrelated-id' });
        const { popupState, customSelect } = makePopupState({ activePresetId: 'b' });

        await requestDeleteAllPresets(popupState);

        expect(popupState.presets).toEqual([]);
        expect(popupState.activePresetId).toBe('');
        expect(StorageManager.savePromptPresets).toHaveBeenCalledWith([]);
        expect(StorageManager.saveActivePresetId).toHaveBeenCalledWith('');
        expect(popupState.chatPresetMap).not.toHaveProperty('chat-1');
        expect(popupState.chatPresetMap).not.toHaveProperty('chat-2');
        expect(popupState.chatPresetMap['chat-3']).toBe('unrelated-id');
        expect(customSelect.render).toHaveBeenCalled();
        expect(globalThis.showSaveStatus).toHaveBeenCalled();
        expect(globalThis.sendActivePresetToContentScript).toHaveBeenCalled();
    });
});

describe('getPendingPresetIdFromContentScript(tabId)', () => {
    it('returns the pendingPresetId from a successful response', async () => {
        globalThis.chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ pendingPresetId: 'p1' });

        const result = await getPendingPresetIdFromContentScript(42);

        expect(result).toBe('p1');
        expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'GET_PENDING_PRESET' });
    });

    it('returns null when the content script response has no pendingPresetId', async () => {
        globalThis.chrome.tabs.sendMessage = vi.fn().mockResolvedValue({});

        const result = await getPendingPresetIdFromContentScript(42);

        expect(result).toBeNull();
    });

    it('returns null when chrome.tabs.sendMessage rejects (no content script listening)', async () => {
        globalThis.chrome.tabs.sendMessage = vi.fn().mockRejectedValue(new Error('no receiver'));

        const result = await getPendingPresetIdFromContentScript(42);

        expect(result).toBeNull();
    });
});

describe('extractUuidFromUrl(url)', () => {
    it('extracts the chat UUID from a valid DeepSeek chat URL', () => {
        const uuid = extractUuidFromUrl('https://chat.deepseek.com/a/chat/s/abc123-def4-5678');
        expect(uuid).toBe('abc123-def4-5678');
    });

    it('returns null for a URL with no matching path', () => {
        const uuid = extractUuidFromUrl('https://chat.deepseek.com/');
        expect(uuid).toBeNull();
    });

    it('returns null for an invalid URL string instead of throwing', () => {
        expect(() => extractUuidFromUrl('not-a-valid-url')).not.toThrow();
        expect(extractUuidFromUrl('not-a-valid-url')).toBeNull();
    });
});
