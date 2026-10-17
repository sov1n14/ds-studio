/**
 * Mutant-kill spec for two behaviours:
 *  O1  content/preset-overlay.controller.js onSelectChange: when a bind dispatch is rejected and the re-read stored map comes back null/undefined, the rollback still completes (no throw) and the overlay shows the "no preset" selection, persisting an empty activePresetId.
 *  O2  Same rollback on a chat with no stored binding (map present, chat key absent) persists an empty activePresetId as the final value.
 *  P1  popup/popup.preset-manager.js requestDeletePreset(id): chats bound to the deleted preset are unbound in the durable map; chats bound to other presets are untouched.
 *
 * Overlay: the real global StorageManager with its persistence methods replaced by a behavioural fake writing into a plain backing object (same pattern as preset-overlay.controller.persistence.spec.js), so assertions read stored state.
 * Popup: a real client StorageManager whose unbind goes through the real SW writer (chat-map-writer-harness); assertions read the durable sync map.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import '../../utils/storage-manager.js';
import { evalPopupScript, loadI18nOnce } from '../helpers/popup-script-loader.js';
import { createChatMapWriterHarness, restoreChromeBoundaries } from '../helpers/chat-map-writer-harness.js';

const { createPresetOverlay } = require('../../content/preset-overlay.controller.js');

const CHAT_UUID = 'uuid-rollback';
const PRESETS = [
    { id: 'preset-A', name: 'Alpha', content: 'a' },
    { id: 'preset-B', name: 'Bravo', content: 'b' },
];
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

describe('overlay rollback of a rejected bind (O1, O2)', () => {
    let overlay, controlOverlay, store, spies, errorSpy, unhandled, onUnhandled;

    function makeCtx() {
        return {
            getIsEnabled: vi.fn(() => true),
            getCurrentChatUuid: vi.fn(() => CHAT_UUID),
            setCurrentChatUuid: vi.fn(),
            getChatPresetMap: vi.fn(() => ({})),
            setChatPresetMap: vi.fn(),
            getPendingPresetId: vi.fn(() => undefined),
            setPendingPresetId: vi.fn(),
            updatePromptPrefixFromBinding: vi.fn(),
            isExtensionContextValid: vi.fn(() => true),
        };
    }

    function mountRendered() {
        const o = createPresetOverlay(makeCtx());
        o.reposition = vi.fn();
        const el = document.createElement('div');
        document.body.appendChild(el);
        o.mountTo(el);
        o.render(PRESETS, '');
        return o;
    }

    const label = (o) => o.dropdown.label.textContent;
    const selectedValue = (o) => o.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? null;

    beforeEach(() => {
        // readMap: what the post-failure re-read of the stored map resolves with.
        store = { readMap: {}, activePresetId: 'untouched' };
        const reject = () => Promise.reject(new StorageManager.errors.ChatMapDispatchError('[DSS] chat-map dispatch failed'));
        spies = [
            vi.spyOn(StorageManager, 'bindChatToPreset').mockImplementation(reject),
            vi.spyOn(StorageManager, 'unbindChat').mockImplementation(reject),
            vi.spyOn(StorageManager, 'getChatPresetMap').mockImplementation(async () => store.readMap),
            vi.spyOn(StorageManager, 'saveActivePresetId').mockImplementation(async (id) => { store.activePresetId = id; return true; }),
            vi.spyOn(StorageManager, 'getSettings').mockResolvedValue({ promptPresets: [], pinnedPresetId: '' }),
        ];
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        unhandled = [];
        onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);

        overlay = mountRendered();
        // Reference for the "no preset" display: an untouched overlay rendered with an empty active id.
        controlOverlay = mountRendered();
    });

    afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
        errorSpy.mockRestore();
        overlay.unmount();
        controlOverlay.unmount();
        document.body.innerHTML = '';
        spies.forEach(s => s.mockRestore());
    });

    const reReadFailures = () => errorSpy.mock.calls.filter(args => String(args[0]).includes('重新讀取失敗'));

    for (const readMap of [null, undefined]) {
        it('re-read resolving ' + readMap + ': rollback completes, shows no preset, persists empty activePresetId', async () => {
            store.readMap = readMap;
            overlay.onSelectChange('preset-B');
            await flush();

            expect(StorageManager.getChatPresetMap, 'guard: the rollback re-read must actually run').toHaveBeenCalled();
            expect(reReadFailures(), 'the rollback must not fail on a null/undefined re-read map').toEqual([]);
            expect(unhandled).toEqual([]);
            expect(selectedValue(overlay), 'selection must roll back to the no-preset option').toBe(selectedValue(controlOverlay));
            expect(label(overlay), 'label must roll back to the no-preset label').toBe(label(controlOverlay));
            expect(label(overlay), 'guard: the no-preset label differs from the clicked preset').not.toBe('Bravo');
            expect(store.activePresetId, 'the failed selection must not stay persisted as activePresetId').toBe('');
        });
    }

    it('chat with no stored binding: rollback persists an empty activePresetId', async () => {
        store.readMap = { 'uuid-other': 'preset-A' };
        overlay.onSelectChange('preset-B');
        await flush();

        expect(store.activePresetId).toBe('');
        expect(selectedValue(overlay)).toBe(selectedValue(controlOverlay));
    });
});

describe('popup requestDeletePreset unbinds chats bound to the deleted preset (P1)', () => {
    beforeAll(() => {
        loadI18nOnce();
        evalPopupScript('utils/chat-session-id.js');
        evalPopupScript('popup/popup.preset-manager.js');
    });

    beforeEach(async () => {
        if (globalThis.dsI18n) {
            globalThis.dsI18n._reset();
            await globalThis.dsI18n.init();
        }
    });

    afterEach(() => restoreChromeBoundaries());

    it('removes only the bindings pointing at the deleted preset', async () => {
        const h = await createChatMapWriterHarness({ clientCount: 1 });
        const storedMap = { 'chat-1': 'a', 'chat-2': 'b', 'chat-3': 'a', 'chat-4': 'c' };
        await h.seedChatMap([storedMap]);

        let presets = [{ id: 'a', name: 'Alpha', content: '' }, { id: 'b', name: 'Beta', content: '' }, { id: 'c', name: 'Gamma', content: '' }];
        let chatPresetMap = { ...storedMap };
        const manager = window.__DS_PopupPresetManager.createPresetManager({
            getPresets: () => presets,
            setPresets: (next) => { presets = next; },
            getActivePresetId: () => '',
            setActivePresetId: () => {},
            getChatPresetMap: () => chatPresetMap,
            setChatPresetMap: (map) => { chatPresetMap = map; },
            getCustomSelect: () => ({ render: () => {} }),
            refreshSyncStatus: async () => {},
            showSaveStatus: () => {},
            updateEditPresetBtnState: () => {},
            sendActivePresetToContentScript: () => {},
            Modal: { confirm: vi.fn().mockResolvedValue(true), prompt: vi.fn() },
            StorageManager: h.clients[0],
        });

        await manager.requestDeletePreset('a');

        expect(presets.map(p => p.id), 'guard: the delete itself went through').toEqual(['b', 'c']);
        expect((await h.readStored()).map, 'durable map after deleting preset a').toEqual({ 'chat-2': 'b', 'chat-4': 'c' });
        expect(chatPresetMap, 'popup in-memory map after deleting preset a').toEqual({ 'chat-2': 'b', 'chat-4': 'c' });
    });
});
