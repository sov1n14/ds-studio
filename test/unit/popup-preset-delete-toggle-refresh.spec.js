/**
 * Gap under test: popup/popup.preset-manager.js delete flows
 * (requestDeletePreset(id) and requestDeleteAllPresets()) clear
 * activePresetId but must ALSO trigger a re-render of the
 * #globalPromptToggle checkbox so the popup UI reflects the fallback
 * state immediately, without a reopen.
 *
 * Requirement source (per task directive):
 *   delete the currently active preset -> toggle falls back to the
 *   no-active-preset state (the legacy global key value)
 *   delete all presets -> same, and the toggle stays operable, must not
 *   become disabled/greyed-out
 *
 * This spec wires the REAL createPresetManager (popup.preset-manager.js)
 * together with the REAL createToggleManager (popup.toggles.js) against a
 * shared ctx (matching the accessor convention already used by every other
 * factory in this codebase -- getPresets/setPresets/getActivePresetId/
 * setActivePresetId -- see popup-preset-manager.spec.js and
 * popup-global-prompt-toggle.spec.js). Both managers read/write the SAME
 * closure state, exactly as popup.js wires them in the live popup.
 *
 * The only thing this test author does NOT know is the exact ctx property
 * name/shape createPresetManager will use to reach into the toggle
 * manager render entry point (createPresetManager has no such hook
 * today -- that IS the gap). This test supplies a zero-arg
 * renderGlobalPromptToggle callback on ctx, pre-bound to the actual
 * checkbox element, mirroring how popup.js already has direct access to
 * both the toggle manager and the DOM element and could bind them once at
 * wiring time. If the implementation reaches the render entry point through
 * a differently-named ctx property, that is a naming detail to reconcile
 * with code-implementer at green time -- not a re-guess of business logic.
 *
 * Assertions are made ONLY on observable behavior: the real checkbox
 * .checked / .disabled state after calling the real delete functions,
 * and the actual value persisted to chrome.storage.local on a subsequent
 * click. Nothing here mocks or asserts on internal call sequences.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript, loadI18nOnce } from '../helpers/popup-script-loader.js';

beforeAll(async () => {
    loadI18nOnce();
    await globalThis.dsI18n.init();

    evalPopupScript('popup/popup.preset-manager.js');
    evalPopupScript('popup/popup.toggles.js');
});

function makeCheckbox(checked = false) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = checked;
    el.disabled = false;
    return el;
}

function buildScenario({ presets, activePresetId, confirmResult = true }) {
    let _presets = presets;
    let _activePresetId = activePresetId;
    let _chatPresetMap = {};

    const customSelect = { render: vi.fn() };

    const sharedCtx = {
        getPresets: () => _presets,
        setPresets: (next) => { _presets = next; },
        getActivePresetId: () => _activePresetId,
        setActivePresetId: (id) => { _activePresetId = id; },
        getChatPresetMap: () => _chatPresetMap,
        setChatPresetMap: (map) => { _chatPresetMap = map; },
    };

    const toggleManager = window.__DS_PopupToggles.createToggleManager({
        ...sharedCtx,
        StorageManager,
        refreshSyncStatus: vi.fn(async () => {}),
        showSaveStatus: vi.fn(),
        applyMasterSwitchUI: vi.fn(),
    });

    const globalPromptToggle = makeCheckbox();

    const PresetManagerStorageMock = {
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

    const presetManager = window.__DS_PopupPresetManager.createPresetManager({
        ...sharedCtx,
        getCustomSelect: () => customSelect,
        refreshSyncStatus: vi.fn().mockResolvedValue(undefined),
        showSaveStatus: vi.fn(),
        updateEditPresetBtnState: vi.fn(),
        sendActivePresetToContentScript: vi.fn(),
        Modal,
        StorageManager: PresetManagerStorageMock,
        renderGlobalPromptToggle: () => toggleManager.renderGlobalPromptToggle(globalPromptToggle),
    });

    return { presetManager, toggleManager, globalPromptToggle, getActivePresetId: () => _activePresetId };
}

describe('preset delete flows refresh the global prompt toggle (gap: requestDeletePreset/requestDeleteAllPresets never re-render it today)', () => {
    it('deleting the currently active preset drops the toggle to the legacy device-local value, and it stays operable', async () => {
        await StorageManager.saveGlobalPromptEnabled(true); // legacy key: TRUE
        const preset = { id: 'p1', globalPromptEnabled: false, updatedAt: 1000 }; // active preset: FALSE (opposite)
        const { presetManager, toggleManager, globalPromptToggle } = buildScenario({
            presets: [preset],
            activePresetId: 'p1',
        });

        await toggleManager.renderGlobalPromptToggle(globalPromptToggle);
        expect(globalPromptToggle.checked).toBe(false);

        await presetManager.requestDeletePreset('p1');

        expect(globalPromptToggle.checked).toBe(true);
        expect(globalPromptToggle.disabled).toBe(false);
    });
    it('deleting ALL presets drops the toggle to the legacy device-local value, and it stays operable', async () => {
        await StorageManager.saveGlobalPromptEnabled(true); // legacy key: TRUE
        const preset = { id: 'p1', globalPromptEnabled: false, updatedAt: 1000 }; // active preset: FALSE (opposite)
        const { presetManager, toggleManager, globalPromptToggle } = buildScenario({
            presets: [preset],
            activePresetId: 'p1',
        });

        await toggleManager.renderGlobalPromptToggle(globalPromptToggle);
        expect(globalPromptToggle.checked).toBe(false);

        await presetManager.requestDeleteAllPresets();

        expect(globalPromptToggle.checked).toBe(true);
        expect(globalPromptToggle.disabled).toBe(false);
    });

    it('a subsequent click after deleting the active preset persists to the legacy key (no active preset remains)', async () => {
        await StorageManager.saveGlobalPromptEnabled(true);
        const preset = { id: 'p1', globalPromptEnabled: false, updatedAt: 1000 };
        const { presetManager, toggleManager, globalPromptToggle } = buildScenario({
            presets: [preset],
            activePresetId: 'p1',
        });

        await toggleManager.renderGlobalPromptToggle(globalPromptToggle);
        await presetManager.requestDeletePreset('p1');
        expect(globalPromptToggle.checked).toBe(true); // fell back to legacy TRUE

        toggleManager.bindToggles({
            globalPromptToggle,
            enableToggle: makeCheckbox(true),
            includeThinkingToggle: null,
            includeReferencesToggle: null,
            sidebarAutoHideToggle: null,
            hideThinkingToggle: null,
            showSystemTimeToggle: null,
            preventAutoScrollToggle: null,
            websearchRadios: [],
        });

        globalPromptToggle.checked = false;
        globalPromptToggle.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 200));

        const localData = await chrome.storage.local.get([StorageManager.KEYS.GLOBAL_PROMPT_ENABLED]);
        expect(localData[StorageManager.KEYS.GLOBAL_PROMPT_ENABLED]).toBe(false);
    });

    it('deleting a NON-active preset does NOT change the displayed toggle state', async () => {
        await StorageManager.saveGlobalPromptEnabled(true); // legacy key TRUE, false-positive trap if fallback fires wrongly
        const activePreset = { id: 'p1', globalPromptEnabled: false, updatedAt: 1000 }; // active: FALSE
        const otherPreset = { id: 'p2', globalPromptEnabled: true, updatedAt: 1000 };
        const { presetManager, toggleManager, globalPromptToggle, getActivePresetId } = buildScenario({
            presets: [activePreset, otherPreset],
            activePresetId: 'p1',
        });

        await toggleManager.renderGlobalPromptToggle(globalPromptToggle);
        expect(globalPromptToggle.checked).toBe(false);

        await presetManager.requestDeletePreset('p2');

        expect(getActivePresetId()).toBe('p1'); // unchanged
        expect(globalPromptToggle.checked).toBe(false); // still the active preset value, unaffected
    });
});
