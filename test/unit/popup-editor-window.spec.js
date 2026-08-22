/**
 * Spec for popup/popup.editor-window.js — the real module, loaded as a classic
 * script (window.__DS_PopupEditorWindow.createEditorWindowManager).
 *
 * Contract under test (popup layer only):
 *   The popup owns NO singleton bookkeeping. It translates a click into ONE
 *   delegation to DSSWindowControl.openSingletonWindow, choosing:
 *     - the url  — '?target=global' for the global prompt editor, and
 *                  '?target=preset&id=<encoded presetId>' for a prompt group
 *                  (the group rides the query string, so switching group while a
 *                  window is open navigates it), and
 *     - the storageKey — a DIFFERENT session slot per target, so the global and
 *                  the preset editor are independent singletons rather than
 *                  fighting over one window.
 *   Focus / navigate / re-create behaviour belongs to utils/window-control.js and
 *   is covered by test/unit/window-control.spec.js — not duplicated here.
 *
 * DSSWindowControl is stubbed: what the popup passes to it IS the wiring
 * contract, and no real window can be opened under happy-dom.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { evalPopupScript } from '../helpers/popup-script-loader.js';

const BASE_URL = 'chrome-extension://EXTID/popup/editor/editor.html';
const GLOBAL_KEY = 'dss-editor-window-id-global';
const PRESET_KEY = 'dss-editor-window-id-preset';

beforeAll(() => {
    // popup.editor-window.js reads globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS behind a
    // fail-fast throw, so utils/editor-window-constants.js MUST load first (matches
    // the runtime load order declared in popup.html).
    evalPopupScript('utils/editor-window-constants.js');
    evalPopupScript('popup/popup.editor-window.js');
    if (typeof window.__DS_PopupEditorWindow?.createEditorWindowManager !== 'function') {
        throw new Error('createEditorWindowManager was not exposed on window.__DS_PopupEditorWindow');
    }
});

let openSingletonWindow;
let activePresetId;

beforeEach(() => {
    activePresetId = '';
    chrome.runtime.getURL = vi.fn(() => BASE_URL);
    openSingletonWindow = vi.fn().mockResolvedValue({ created: true });
    globalThis.DSSWindowControl = { openSingletonWindow };
});

const buildManager = () =>
    window.__DS_PopupEditorWindow.createEditorWindowManager({
        getActivePresetId: () => activePresetId,
    });

/** The single argument object handed to DSSWindowControl.openSingletonWindow. */
const delegatedCall = () => {
    expect(openSingletonWindow).toHaveBeenCalledOnce();
    return openSingletonWindow.mock.calls[0][0];
};

describe('createEditorWindowManager — openEditorWindow delegation', () => {
    it("target=global asks for the global url and the GLOBAL session slot", async () => {
        await buildManager().openEditorWindow('global');

        const arg = delegatedCall();
        expect(arg.url).toBe(`${BASE_URL}?target=global`);
        expect(arg.storageKey).toBe(GLOBAL_KEY);
        expect(arg.createOptions).toEqual({ type: 'popup', width: 1280, height: 720 });
    });

    it("target=preset carries the preset id in the url and uses the PRESET session slot", async () => {
        await buildManager().openEditorWindow('preset', 'my-preset-id');

        const arg = delegatedCall();
        expect(arg.url).toBe(`${BASE_URL}?target=preset&id=my-preset-id`);
        expect(arg.storageKey).toBe(PRESET_KEY);
    });

    it('percent-encodes a preset id containing url-significant characters', async () => {
        await buildManager().openEditorWindow('preset', 'a b&c=d');

        expect(delegatedCall().url).toBe(`${BASE_URL}?target=preset&id=a%20b%26c%3Dd`);
    });

    it('the two targets occupy separate session slots, so neither evicts the other', async () => {
        const manager = buildManager();
        await manager.openEditorWindow('global');
        await manager.openEditorWindow('preset', 'p1');

        const keys = openSingletonWindow.mock.calls.map(([arg]) => arg.storageKey);
        expect(keys).toEqual([GLOBAL_KEY, PRESET_KEY]);
        expect(new Set(keys).size).toBe(2);
    });

    it('a rejected openSingletonWindow is swallowed and reported, never thrown at the click handler', async () => {
        openSingletonWindow.mockRejectedValue(new Error('no window'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(buildManager().openEditorWindow('global')).resolves.toBeUndefined();

        expect(errorSpy.mock.calls.flat().some((a) => typeof a === 'string' && a.includes('[DSS]'))).toBe(true);
        errorSpy.mockRestore();
    });
});

describe('createEditorWindowManager — button bindings', () => {
    it('editPresetBtn click with no active preset opens nothing', () => {
        const btn = document.createElement('button');
        buildManager().bindEditPresetButton(btn);

        activePresetId = '';
        btn.click();

        expect(openSingletonWindow).not.toHaveBeenCalled();
    });

    it('editPresetBtn click with an active preset opens that preset editor', () => {
        const btn = document.createElement('button');
        buildManager().bindEditPresetButton(btn);

        activePresetId = 'preset-123';
        btn.click();

        expect(delegatedCall()).toMatchObject({
            url: `${BASE_URL}?target=preset&id=preset-123`,
            storageKey: PRESET_KEY,
        });
    });

    it('editGlobalPromptBtn click opens the global editor', () => {
        const btn = document.createElement('button');
        buildManager().bindEditGlobalPromptButton(btn);

        btn.click();

        expect(delegatedCall()).toMatchObject({
            url: `${BASE_URL}?target=global`,
            storageKey: GLOBAL_KEY,
        });
    });
});
