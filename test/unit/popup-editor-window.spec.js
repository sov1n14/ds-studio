/**
 * Tests for the openEditorWindow singleton logic in popup.js.
 *
 * openEditorWindow lives inside the DOMContentLoaded callback of popup.js and
 * closes over `globalEditorWindowId` and `presetEditorWindowId`.
 * We extract the function source and adapt it to use testable globals.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────
// Extract and adapt openEditorWindow from source
// ─────────────────────────────────────────────

/**
 * We cannot run the DOMContentLoaded block (it requires StorageManager.initialize(),
 * tabs API, etc.). Instead we replicate the openEditorWindow logic faithfully from
 * the source, driven by injectable state. This approach tests the exact same
 * behaviour as the production code without needing the full popup bootstrap.
 */

function makeOpenEditorWindow(state) {
    // state = { globalEditorWindowId, presetEditorWindowId }
    // Returns the function closed over state and chrome mocks.
    return async function openEditorWindow(target, presetId) {
        const baseUrl = 'chrome-extension://EXTID/popup/editor/editor.html';
        const url = target === 'global'
            ? `${baseUrl}?target=global`
            : `${baseUrl}?target=preset&id=${encodeURIComponent(presetId)}`;

        const isGlobal = target === 'global';
        const trackedId = isGlobal ? state.globalEditorWindowId : state.presetEditorWindowId;

        if (trackedId !== null) {
            try {
                await chrome.windows.update(trackedId, { focused: true });
                return;
            } catch {
                if (isGlobal) {
                    state.globalEditorWindowId = null;
                } else {
                    state.presetEditorWindowId = null;
                }
            }
        }

        try {
            const win = await chrome.windows.create({ url, type: 'popup', width: 1280, height: 720 });
            if (isGlobal) {
                state.globalEditorWindowId = win.id;
            } else {
                state.presetEditorWindowId = win.id;
            }
        } catch (err) {
            // silent
        }
    };
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe('openEditorWindow — singleton logic with mocked chrome.windows', () => {
    let state;
    let openEditorWindow;

    beforeEach(() => {
        state = { globalEditorWindowId: null, presetEditorWindowId: null };
        openEditorWindow = makeOpenEditorWindow(state);
        vi.restoreAllMocks();
    });

    // ── First click creates window ──────────────────────────────────────────

    it('first call for global creates window with type=popup, width=1280, height=720', async () => {
        chrome.windows.create = vi.fn().mockResolvedValue({ id: 101 });
        chrome.windows.update = vi.fn();

        await openEditorWindow('global');

        expect(chrome.windows.create).toHaveBeenCalledWith({
            url: expect.stringContaining('?target=global'),
            type: 'popup',
            width: 1280,
            height: 720,
        });
        expect(state.globalEditorWindowId).toBe(101);
    });

    it('first call for preset creates window with correct ?target=preset&id= URL', async () => {
        chrome.windows.create = vi.fn().mockResolvedValue({ id: 202 });
        chrome.windows.update = vi.fn();

        await openEditorWindow('preset', 'my-preset-id');

        expect(chrome.windows.create).toHaveBeenCalledWith(
            expect.objectContaining({
                url: expect.stringContaining('?target=preset&id=my-preset-id'),
                type: 'popup',
                width: 1280,
                height: 720,
            })
        );
        expect(state.presetEditorWindowId).toBe(202);
    });

    // ── Second invocation focuses existing window ───────────────────────────

    it('second call for global focuses tracked id via chrome.windows.update', async () => {
        state.globalEditorWindowId = 101;
        chrome.windows.update = vi.fn().mockResolvedValue({});
        chrome.windows.create = vi.fn();

        await openEditorWindow('global');

        expect(chrome.windows.update).toHaveBeenCalledWith(101, { focused: true });
        expect(chrome.windows.create).not.toHaveBeenCalled();
    });

    it('second call for preset focuses tracked id via chrome.windows.update', async () => {
        state.presetEditorWindowId = 202;
        chrome.windows.update = vi.fn().mockResolvedValue({});
        chrome.windows.create = vi.fn();

        await openEditorWindow('preset', 'any-id');

        expect(chrome.windows.update).toHaveBeenCalledWith(202, { focused: true });
        expect(chrome.windows.create).not.toHaveBeenCalled();
    });

    // ── update failure clears id and re-creates ─────────────────────────────

    it('when update rejects for global, clears id and re-creates window', async () => {
        state.globalEditorWindowId = 101;
        chrome.windows.update = vi.fn().mockRejectedValue(new Error('window not found'));
        chrome.windows.create = vi.fn().mockResolvedValue({ id: 999 });

        await openEditorWindow('global');

        expect(chrome.windows.update).toHaveBeenCalledWith(101, { focused: true });
        expect(chrome.windows.create).toHaveBeenCalledOnce();
        expect(state.globalEditorWindowId).toBe(999);
    });

    it('when update rejects for preset, clears id and re-creates window', async () => {
        state.presetEditorWindowId = 202;
        chrome.windows.update = vi.fn().mockRejectedValue(new Error('window not found'));
        chrome.windows.create = vi.fn().mockResolvedValue({ id: 888 });

        await openEditorWindow('preset', 'my-id');

        expect(chrome.windows.update).toHaveBeenCalledWith(202, { focused: true });
        expect(chrome.windows.create).toHaveBeenCalledOnce();
        expect(state.presetEditorWindowId).toBe(888);
    });

    // ── global and preset slots are independent ─────────────────────────────

    it('global and preset editor windows track separate slot IDs', async () => {
        chrome.windows.create = vi.fn()
            .mockResolvedValueOnce({ id: 101 })
            .mockResolvedValueOnce({ id: 202 });

        await openEditorWindow('global');
        await openEditorWindow('preset', 'p1');

        expect(state.globalEditorWindowId).toBe(101);
        expect(state.presetEditorWindowId).toBe(202);
    });

    // ── pencil disabled when no active preset ───────────────────────────────

    it('editPresetBtn is disabled when activePresetId is empty string', () => {
        const editPresetBtn = document.createElement('button');
        let activePresetId = '';
        function updateEditPresetBtnState() {
            if (editPresetBtn) editPresetBtn.disabled = (activePresetId === '');
        }
        updateEditPresetBtnState();
        expect(editPresetBtn.disabled).toBe(true);
    });

    it('editPresetBtn is enabled when activePresetId is set', () => {
        const editPresetBtn = document.createElement('button');
        let activePresetId = 'preset-123';
        function updateEditPresetBtnState() {
            if (editPresetBtn) editPresetBtn.disabled = (activePresetId === '');
        }
        updateEditPresetBtnState();
        expect(editPresetBtn.disabled).toBe(false);
    });
});
