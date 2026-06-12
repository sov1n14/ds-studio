/**
 * Tests for popup/editor/editor.js
 *
 * editor.js exposes __DSSEditor (window namespace + guarded module.exports).
 * Functions under test: parseTarget, loadContent, saveContent, debounce,
 * renderDisabledState, updateSaveStatus.
 *
 * StorageManager is loaded in the global scope by the content script import
 * mechanism. For editor.js we manually set globalThis.StorageManager before
 * importing, so saveContent / loadContent can reach it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

// editor.js references `location.search` and `window.DSVMessaging`, and
// assigns to `window.__DSSEditor`. Set up mocks before importing.
// We stub location.search via globalThis.location in happy-dom.

// Provide StorageManager as a global so editor.js's classic-script path finds it
globalThis.StorageManager = StorageManager;

// Provide a stub DSVMessaging
globalThis.window = globalThis.window ?? {};

const editor = await import('../../popup/editor/editor.js');

// editor.js exports { parseTarget, loadContent, saveContent, debounce, renderDisabledState, updateSaveStatus }
const { parseTarget, loadContent, saveContent, debounce, renderDisabledState, updateSaveStatus } = editor;

// ─────────────────────────────────────────────
// parseTarget
// ─────────────────────────────────────────────

describe('parseTarget — query string parsing', () => {
    const originalLocation = globalThis.location;

    function setSearch(search) {
        // happy-dom provides location; we override search via URL assignment
        Object.defineProperty(globalThis, 'location', {
            value: { search },
            writable: true,
            configurable: true,
        });
    }

    afterEach(() => {
        Object.defineProperty(globalThis, 'location', {
            value: originalLocation,
            writable: true,
            configurable: true,
        });
    });

    it('returns { type: "global" } for ?target=global', () => {
        setSearch('?target=global');
        expect(parseTarget()).toEqual({ type: 'global' });
    });

    it('returns { type: "preset", id } for ?target=preset&id=abc', () => {
        setSearch('?target=preset&id=abc-123');
        expect(parseTarget()).toEqual({ type: 'preset', id: 'abc-123' });
    });

    it('returns null for ?target=preset with no id', () => {
        setSearch('?target=preset');
        expect(parseTarget()).toBeNull();
    });

    it('returns null for ?target=preset with empty id', () => {
        setSearch('?target=preset&id=');
        expect(parseTarget()).toBeNull();
    });

    it('returns null for ?target=preset with whitespace-only id', () => {
        setSearch('?target=preset&id=   ');
        expect(parseTarget()).toBeNull();
    });

    it('returns null for unknown target', () => {
        setSearch('?target=unknown');
        expect(parseTarget()).toBeNull();
    });

    it('returns null for empty search string', () => {
        setSearch('');
        expect(parseTarget()).toBeNull();
    });

    it('trims id for preset target', () => {
        setSearch('?target=preset&id=  my-id  ');
        expect(parseTarget()).toEqual({ type: 'preset', id: 'my-id' });
    });
});

// ─────────────────────────────────────────────
// loadContent
// ─────────────────────────────────────────────

describe('loadContent — routing', () => {
    beforeEach(async () => {
        // Clear storage and ensure initialized state
        await chrome.storage.local.clear?.();
        await chrome.storage.sync.clear?.();
        // Run initialize so defaults are written (required by loadContent's call to it)
        await StorageManager.initialize();
    });

    it('loads global content from StorageManager', async () => {
        await StorageManager.saveGlobalDefaultPrompt('My global prompt');
        const result = await loadContent({ type: 'global' });
        expect(result).not.toBeNull();
        expect(result.content).toBe('My global prompt');
        expect(result.title).toBe('全域預設提示詞');
    });

    it('loads global content as empty string when no global prompt saved', async () => {
        const result = await loadContent({ type: 'global' });
        expect(result).not.toBeNull();
        expect(result.content).toBe('');
    });

    it('loads preset content when preset exists', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Test Preset', content: 'Preset content', createdAt: 1000, updatedAt: 1000 },
        ]);
        const result = await loadContent({ type: 'preset', id: 'p1' });
        expect(result).not.toBeNull();
        expect(result.content).toBe('Preset content');
        expect(result.title).toBe('Test Preset');
    });

    it('returns null when preset not found', async () => {
        const result = await loadContent({ type: 'preset', id: 'nonexistent' });
        expect(result).toBeNull();
    });

    it('returns null for null target', async () => {
        const result = await loadContent(null);
        expect(result).toBeNull();
    });
});

// ─────────────────────────────────────────────
// saveContent
// ─────────────────────────────────────────────

describe('saveContent — routing with spied StorageManager', () => {
    beforeEach(async () => {
        await StorageManager.initialize();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('routes global target to saveGlobalDefaultPrompt', async () => {
        const spy = vi.spyOn(StorageManager, 'saveGlobalDefaultPrompt').mockResolvedValue(undefined);
        await saveContent({ type: 'global' }, 'my global value');
        expect(spy).toHaveBeenCalledWith('my global value');
    });

    it('routes preset target to saveOnePromptPreset after re-fetching', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'P1', content: 'old content', createdAt: 1000, updatedAt: 1000 },
        ]);
        const spy = vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);
        await saveContent({ type: 'preset', id: 'p1' }, 'new content');
        expect(spy).toHaveBeenCalledOnce();
        const savedPreset = spy.mock.calls[0][0];
        expect(savedPreset.content).toBe('new content');
        expect(savedPreset.id).toBe('p1');
    });

    it('preset save triggers DSVMessaging.broadcastActivePreset', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'P1', content: 'old', createdAt: 1000, updatedAt: 1000 },
        ]);
        vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);

        const broadcastSpy = vi.fn().mockResolvedValue(undefined);
        globalThis.window.DSVMessaging = { broadcastActivePreset: broadcastSpy };

        await saveContent({ type: 'preset', id: 'p1' }, 'new content');
        expect(broadcastSpy).toHaveBeenCalledWith('p1', 'new content');

        delete globalThis.window.DSVMessaging;
    });

    it('preset save does not throw when DSVMessaging is absent', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p2', name: 'P2', content: 'old', createdAt: 1000, updatedAt: 1000 },
        ]);
        vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);
        delete globalThis.window.DSVMessaging;

        await expect(saveContent({ type: 'preset', id: 'p2' }, 'new')).resolves.toBeUndefined();
    });

    it('silently ignores save when preset not found (deleted during save)', async () => {
        vi.spyOn(StorageManager, 'saveOnePromptPreset');
        // p-gone does not exist in storage
        await expect(saveContent({ type: 'preset', id: 'p-gone' }, 'value')).resolves.toBeUndefined();
        expect(StorageManager.saveOnePromptPreset).not.toHaveBeenCalled();
    });

    it('throws for null target', async () => {
        await expect(saveContent(null, 'val')).rejects.toThrow();
    });

    it('throws for unknown target type', async () => {
        await expect(saveContent({ type: 'unknown' }, 'val')).rejects.toThrow();
    });
});

// ─────────────────────────────────────────────
// debounce
// ─────────────────────────────────────────────

describe('debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires only once for rapid successive calls', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        debounced();
        debounced();

        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('fires again after the delay following the last call', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 200);

        debounced();
        vi.advanceTimersByTime(200);
        expect(fn).toHaveBeenCalledTimes(1);

        debounced();
        vi.advanceTimersByTime(200);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not fire before the delay elapses', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced();
        vi.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledOnce();
    });
});

// ─────────────────────────────────────────────
// renderDisabledState
// ─────────────────────────────────────────────

describe('renderDisabledState', () => {
    it('sets title text, adds error class, disables textarea, clears value, sets document.title', () => {
        const titleEl = document.createElement('div');
        const textareaEl = document.createElement('textarea');
        textareaEl.value = 'some content';

        renderDisabledState(titleEl, textareaEl, 'Error: not found');

        expect(titleEl.textContent).toBe('Error: not found');
        expect(titleEl.classList.contains('is-error')).toBe(true);
        expect(textareaEl.disabled).toBe(true);
        expect(textareaEl.value).toBe('');
        expect(document.title).toBe('Error: not found');
    });
});

// ─────────────────────────────────────────────
// updateSaveStatus
// ─────────────────────────────────────────────

describe('updateSaveStatus', () => {
    it('sets text to saving text and removes hidden class for "saving" state', () => {
        const statusEl = document.createElement('span');
        statusEl.classList.add('save-status--hidden');
        updateSaveStatus(statusEl, 'saving');
        expect(statusEl.textContent).toBe('儲存中…');
        expect(statusEl.classList.contains('save-status--hidden')).toBe(false);
    });

    it('sets text and removes hidden class for "saved" state', () => {
        const statusEl = document.createElement('span');
        statusEl.classList.add('save-status--hidden');
        updateSaveStatus(statusEl, 'saved');
        expect(statusEl.textContent).toBe('已儲存');
        expect(statusEl.classList.contains('save-status--hidden')).toBe(false);
    });

    it('does not throw when statusEl is null', () => {
        expect(() => updateSaveStatus(null, 'saving')).not.toThrow();
    });
});
