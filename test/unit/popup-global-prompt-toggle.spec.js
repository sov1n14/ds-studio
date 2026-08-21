/**
 * popup toggle - "Global Prompt" (#globalPromptToggle) bound to the ACTIVE PRESET
 *
 * Requirement contract under test (docs/requirements/global-prompt-per-preset-toggle.md):
 *   The #globalPromptToggle element itself is UNCHANGED (same id, position,
 *   appearance). Only the SOURCE of its displayed state and the DESTINATION
 *   of its writes change:
 *
 *   1. On popup open, checked reflects StorageManager.resolveGlobalPromptEnabled()
 *      for the currently active preset.
 *   2. Switching to a different preset updates checked IMMEDIATELY (no reopen).
 *   3. Clicking the toggle WITH an active preset writes globalPromptEnabled onto
 *      THAT preset and bumps its updatedAt (load-bearing for cross-device merge
 *      by updatedAt - a fix that skips the bump loses on sync and silently
 *      reverts). The new updatedAt must be strictly greater than the old one.
 *   4. Clicking the toggle with NO active preset writes the legacy device-local
 *      globalPromptEnabled key instead, exactly as today (pre-existing, unchanged
 *      behavior - expected to already pass against the current implementation).
 *   5. Deleting the currently active preset drops back to the no-preset state:
 *      the toggle then shows the legacy key's value.
 *   6. Deleting ALL presets does the same, and the toggle REMAINS operable (not
 *      disabled/greyed out).
 *   7. Selecting the "(no preset)" blank option behaves as the no-active-preset case.
 *   8. A preset object lacking the globalPromptEnabled field entirely displays as ON.
 *
 * Testing strategy:
 *   popup/popup.toggles.js is a standalone classic-script factory
 *   (window.__DS_PopupToggles.createToggleManager), loaded via eval() - the
 *   established pattern for this exact module family (see
 *   test/unit/popup-live-sync.spec.js, which loads popup.live-sync.js the same
 *   way). The factory is executed for real against a real StorageManager
 *   instance (backed by the in-memory chrome.storage mock from
 *   vitest.setup.js) and real DOM checkbox elements; assertions are made on
 *   the resulting .checked value and on the ACTUAL data written to storage
 *   (never on "was a collaborator called").
 *
 *   This test author does NOT know how createToggleManager's ctx surface or
 *   return shape will be implemented, because no implementation exists yet
 *   (TDD red phase - implementation blindness). The ctx shape below
 *   (getPresets/setPresets/getActivePresetId/setActivePresetId) mirrors the
 *   EXISTING accessor convention already used by every other factory in this
 *   codebase for the exact same state (createPresetManager, createLiveSyncListener,
 *   createPresetCustomSelect all take these same four accessors - see
 *   popup/popup.js's wiring block). A render-on-demand entry point named
 *   renderGlobalPromptToggle(globalPromptToggle) is required by the spec's
 *   requirement 1/2 ("checked reflects the resolver's result... updates
 *   immediately on preset switch, no popup reopen required") - some function
 *   must be callable from both the initial load path and the preset-switch
 *   path in popup.js, and bindToggles() alone (event-listener wiring) cannot
 *   serve that need. If the implementation exposes this render entry point
 *   under a different name, that is a naming detail to reconcile between
 *   test-engineer and code-implementer at green time - not a re-guess of
 *   business logic.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
import { evalPopupScript } from '../helpers/popup-script-loader.js';

beforeAll(() => {
    evalPopupScript('popup/popup.toggles.js');
    if (typeof window.__DS_PopupToggles?.createToggleManager !== 'function') {
        throw new Error('createToggleManager was not exposed on window.__DS_PopupToggles');
    }
});

function makeCheckbox(checked = false) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = checked;
    return el;
}

/** Mirrors the ctx wiring block createToggleManager() will receive from popup.js. */
function buildManager({ presets = [], activePresetId = '' } = {}) {
    const state = { presets, activePresetId };
    const ctx = {
        StorageManager,
        refreshSyncStatus: vi.fn(async () => {}),
        showSaveStatus: vi.fn(),
        applyMasterSwitchUI: vi.fn(),
        getPresets: () => state.presets,
        setPresets: (v) => { state.presets = v; },
        getActivePresetId: () => state.activePresetId,
        setActivePresetId: (v) => { state.activePresetId = v; },
    };
    const manager = window.__DS_PopupToggles.createToggleManager(ctx);
    return { manager, state };
}

/** Minimal elements object satisfying bindToggles()'s unconditional refs. */
function buildElements(globalPromptToggle) {
    return {
        globalPromptToggle,
        enableToggle: makeCheckbox(true),
        includeThinkingToggle: null,
        includeReferencesToggle: null,
        sidebarAutoHideToggle: null,
        hideThinkingToggle: null,
        showSystemTimeToggle: null,
        preventAutoScrollToggle: null,
        websearchRadios: [],
    };
}

async function flush() {
    await new Promise((r) => setTimeout(r, 200));
}

function fireChange(el) {
    el.dispatchEvent(new Event('change'));
}

describe('createToggleManager - renderGlobalPromptToggle (initial load + live preset switch)', () => {
    it('requirement 1: reflects the active preset globalPromptEnabled=false on initial render', async () => {
        const preset = { id: 'p1', globalPromptEnabled: false, updatedAt: 1000 };
        const { manager } = buildManager({ presets: [preset], activePresetId: 'p1' });
        const toggle = makeCheckbox(true);

        expect(typeof manager.renderGlobalPromptToggle).toBe('function');
        await manager.renderGlobalPromptToggle(toggle);

        expect(toggle.checked).toBe(false);
    });

    it('requirement 8: a preset lacking the globalPromptEnabled field entirely displays as ON', async () => {
        const preset = { id: 'p1', name: 'legacy preset, no field' };
        const { manager } = buildManager({ presets: [preset], activePresetId: 'p1' });
        const toggle = makeCheckbox(false);

        await manager.renderGlobalPromptToggle(toggle);

        expect(toggle.checked).toBe(true);
    });

    it('requirement 2: switching the active preset updates checked immediately on the next render call, no reopen', async () => {
        const presetA = { id: 'a', globalPromptEnabled: true, updatedAt: 1000 };
        const presetB = { id: 'b', globalPromptEnabled: false, updatedAt: 1000 };
        const { manager, state } = buildManager({ presets: [presetA, presetB], activePresetId: 'a' });
        const toggle = makeCheckbox(false);

        await manager.renderGlobalPromptToggle(toggle);
        expect(toggle.checked).toBe(true);

        state.activePresetId = 'b';
        await manager.renderGlobalPromptToggle(toggle);

        expect(toggle.checked).toBe(false);
    });

    it('requirements 5 and 7: with no active preset (deleted / blank no-preset selection), falls back to the legacy device-local key', async () => {
        await StorageManager.saveGlobalPromptEnabled(false);
        const { manager } = buildManager({ presets: [], activePresetId: '' });
        const toggle = makeCheckbox(true);

        await manager.renderGlobalPromptToggle(toggle);

        expect(toggle.checked).toBe(false);
    });

    it('requirement 5: deleting the currently active preset drops back to the legacy key, not the stale preset value', async () => {
        await StorageManager.saveGlobalPromptEnabled(true);
        const preset = { id: 'p1', globalPromptEnabled: false, updatedAt: 1000 };
        const { manager, state } = buildManager({ presets: [preset], activePresetId: 'p1' });
        const toggle = makeCheckbox(false);

        await manager.renderGlobalPromptToggle(toggle);
        expect(toggle.checked).toBe(false);

        state.presets = [];
        state.activePresetId = '';
        await manager.renderGlobalPromptToggle(toggle);

        expect(toggle.checked).toBe(true);
    });

    it('requirement 6: deleting ALL presets leaves the toggle operable (not disabled)', async () => {
        const preset = { id: 'p1', globalPromptEnabled: false, updatedAt: 1000 };
        const { manager, state } = buildManager({ presets: [preset], activePresetId: 'p1' });
        const toggle = makeCheckbox(false);
        toggle.disabled = false;

        state.presets = [];
        state.activePresetId = '';
        await manager.renderGlobalPromptToggle(toggle);

        expect(toggle.disabled).toBe(false);
    });
});

describe('createToggleManager - bindToggles change handler, WITH an active preset', () => {
    it('requirement 3: writes globalPromptEnabled onto the active preset and bumps its updatedAt strictly forward', async () => {
        const oldUpdatedAt = Date.now() - 10000;
        const preset = { id: 'p1', name: 'A', content: '', createdAt: oldUpdatedAt, updatedAt: oldUpdatedAt, globalPromptEnabled: true };
        await StorageManager.savePromptPresets([preset]);

        const { manager } = buildManager({ presets: [preset], activePresetId: 'p1' });
        const toggle = makeCheckbox(true);
        manager.bindToggles(buildElements(toggle));

        toggle.checked = false;
        fireChange(toggle);
        await flush();

        const settings = await StorageManager.getSettings();
        const stored = settings.promptPresets.find(p => p.id === 'p1');

        expect(stored).toBeTruthy();
        expect(stored.globalPromptEnabled).toBe(false);
        expect(stored.updatedAt).toBeGreaterThan(oldUpdatedAt);
    });

    it('requirement 3: does NOT write to the legacy device-local key when an active preset exists', async () => {
        await StorageManager.saveGlobalPromptEnabled(true);
        const preset = { id: 'p1', name: 'A', content: '', createdAt: 1, updatedAt: 1, globalPromptEnabled: true };
        await StorageManager.savePromptPresets([preset]);

        const { manager } = buildManager({ presets: [preset], activePresetId: 'p1' });
        const toggle = makeCheckbox(true);
        manager.bindToggles(buildElements(toggle));

        toggle.checked = false;
        fireChange(toggle);
        await flush();

        const settings = await StorageManager.getSettings();
        expect(settings.globalPromptEnabled).toBe(true);
    });
});

describe('createToggleManager - bindToggles change handler, with NO active preset (pre-existing behavior)', () => {
    it('requirement 4: writes the new value to the legacy device-local globalPromptEnabled key', async () => {
        await StorageManager.saveGlobalPromptEnabled(true);
        const { manager } = buildManager({ presets: [], activePresetId: '' });
        const toggle = makeCheckbox(true);
        manager.bindToggles(buildElements(toggle));

        toggle.checked = false;
        fireChange(toggle);
        await flush();

        const localData = await chrome.storage.local.get([StorageManager.KEYS.GLOBAL_PROMPT_ENABLED]);
        expect(localData[StorageManager.KEYS.GLOBAL_PROMPT_ENABLED]).toBe(false);
    });
});
