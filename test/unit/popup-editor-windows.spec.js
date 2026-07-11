/**
 * popup/popup.editor-windows.js — openEditorWindow() unit tests.
 * Freshly extracted from popup.js's inline click handlers during the modular
 * split; no prior spec covered this logic directly.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

beforeAll(() => {
    const code = readFileSync(resolve(__dirname, '../../popup/popup.editor-windows.js'), 'utf-8');
    const globalEval = eval;
    globalEval(code);
    if (typeof globalThis.openEditorWindow !== 'function') {
        throw new Error('openEditorWindow was not exposed as a global after eval');
    }
});

function makePopupState(overrides = {}) {
    return {
        globalEditorWindowId: null,
        presetEditorWindowId: null,
        ...overrides,
    };
}

describe('openEditorWindow(popupState, target, presetId)', () => {
    it('opens a new window for the global prompt editor and tracks its window id', async () => {
        globalThis.chrome.runtime.getURL = vi.fn((p) => `chrome-extension://ext/${p}`);
        globalThis.chrome.windows.create = vi.fn().mockResolvedValue({ id: 101 });

        const popupState = makePopupState();
        await openEditorWindow(popupState, 'global');

        expect(globalThis.chrome.windows.create).toHaveBeenCalledWith(
            expect.objectContaining({ url: expect.stringContaining('target=global') })
        );
        expect(popupState.globalEditorWindowId).toBe(101);
        expect(popupState.presetEditorWindowId).toBeNull();
    });

    it('opens a new window for a preset editor with the id in the URL and tracks presetEditorWindowId', async () => {
        globalThis.chrome.runtime.getURL = vi.fn((p) => `chrome-extension://ext/${p}`);
        globalThis.chrome.windows.create = vi.fn().mockResolvedValue({ id: 202 });

        const popupState = makePopupState();
        await openEditorWindow(popupState, 'preset', 'preset-1');

        expect(globalThis.chrome.windows.create).toHaveBeenCalledWith(
            expect.objectContaining({ url: expect.stringContaining('target=preset&id=preset-1') })
        );
        expect(popupState.presetEditorWindowId).toBe(202);
        expect(popupState.globalEditorWindowId).toBeNull();
    });

    it('focuses (not re-creates) an existing tracked window when it is still open', async () => {
        globalThis.chrome.runtime.getURL = vi.fn((p) => `chrome-extension://ext/${p}`);
        globalThis.chrome.windows.update = vi.fn().mockResolvedValue({ id: 101 });
        globalThis.chrome.windows.create = vi.fn();

        const popupState = makePopupState({ globalEditorWindowId: 101 });
        await openEditorWindow(popupState, 'global');

        expect(globalThis.chrome.windows.update).toHaveBeenCalledWith(101, { focused: true });
        expect(globalThis.chrome.windows.create).not.toHaveBeenCalled();
    });

    it('clears the tracked id and creates a new window when the tracked window was closed', async () => {
        globalThis.chrome.runtime.getURL = vi.fn((p) => `chrome-extension://ext/${p}`);
        globalThis.chrome.windows.update = vi.fn().mockRejectedValue(new Error('No window with id'));
        globalThis.chrome.windows.create = vi.fn().mockResolvedValue({ id: 303 });

        const popupState = makePopupState({ presetEditorWindowId: 999 });
        await openEditorWindow(popupState, 'preset', 'p2');

        expect(globalThis.chrome.windows.update).toHaveBeenCalledWith(999, { focused: true });
        expect(globalThis.chrome.windows.create).toHaveBeenCalled();
        expect(popupState.presetEditorWindowId).toBe(303);
    });

    it('swallows chrome.windows.create() failures without throwing', async () => {
        globalThis.chrome.runtime.getURL = vi.fn((p) => `chrome-extension://ext/${p}`);
        globalThis.chrome.windows.create = vi.fn().mockRejectedValue(new Error('create failed'));

        const popupState = makePopupState();
        await expect(openEditorWindow(popupState, 'global')).resolves.toBeUndefined();
        expect(popupState.globalEditorWindowId).toBeNull();
    });
});
