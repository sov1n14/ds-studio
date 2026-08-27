/**
 * Tests for popup/editor/editor.js
 *
 * editor.js exposes __DSSEditor (window namespace + guarded module.exports).
 * Functions under test: parseTarget, loadContent, saveContent,
 * renderDisabledState, updateSaveStatus.
 *
 * StorageManager is loaded in the global scope by the content script import
 * mechanism. For editor.js we manually set globalThis.StorageManager before
 * importing, so saveContent / loadContent can reach it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';
// editor.js does `const debounce = DSSDebounce;` at load time — publish the shared helper first.
import '../../utils/debounce.js';
// editor.js calls DSSPresetDomain.validatePresetName — publish the preset-domain module too.
import '../../popup/popup.preset-domain.js';

// editor.js references `location.search` and `window.DSSTabControl`, and
// assigns to `window.__DSSEditor`. Set up mocks before importing.
// We stub location.search via globalThis.location in happy-dom.

// Provide StorageManager as a global so editor.js's classic-script path finds it
globalThis.StorageManager = StorageManager;

// Provide a stub DSSTabControl
globalThis.window = globalThis.window ?? {};

const editor = await import('../../popup/editor/editor.js');

// editor.js exports { parseTarget, loadContent, saveContent, renderDisabledState, updateSaveStatus }
const { parseTarget, loadContent, saveContent, renderDisabledState, updateSaveStatus } = editor;

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
        expect(result.title).toBe('全域提示詞');
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

    it('preset save triggers DSSTabControl.broadcastActivePreset', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'P1', content: 'old', createdAt: 1000, updatedAt: 1000 },
        ]);
        vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);

        const broadcastSpy = vi.fn().mockResolvedValue(undefined);
        globalThis.window.DSSTabControl = { broadcastActivePreset: broadcastSpy };

        await saveContent({ type: 'preset', id: 'p1' }, 'new content');
        expect(broadcastSpy).toHaveBeenCalledWith('p1', 'new content');

        delete globalThis.window.DSSTabControl;
    });

    it('preset save does not throw when DSSTabControl is absent', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p2', name: 'P2', content: 'old', createdAt: 1000, updatedAt: 1000 },
        ]);
        vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);
        delete globalThis.window.DSSTabControl;

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
// Auto-save debounce wiring — must be 500ms, not 600ms
//
// performSave/debouncedSave live inside the DOMContentLoaded closure and are not
// exported via __DSSEditor, so we assert the literal wiring in source. This is
// paired with test/unit/debounce.spec.js (which owns the shared helper's timing
// contract) to fully cover the "auto-save now fires at 500ms" requirement.
// ─────────────────────────────────────────────

describe('editor.js auto-save debounce wiring — source assertion', () => {
    it('wires debouncedSave = debounce(performSave, 500) — not 600ms', async () => {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { dirname, resolve } = await import('path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const code = readFileSync(resolve(__dirname, '../../popup/editor/editor.js'), 'utf-8');

        expect(code).toContain('const debouncedSave = debounce(performSave, 500);');
        expect(code).not.toContain('debounce(performSave, 600)');
    });

    it('textarea "input" handler sets isDirty and calls the debounced save (not performSave directly)', async () => {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { dirname, resolve } = await import('path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const code = readFileSync(resolve(__dirname, '../../popup/editor/editor.js'), 'utf-8');

        const inputBlockMatch = code.match(/textareaEl\.addEventListener\('input', \(\) => \{[\s\S]*?\}\);/);
        expect(inputBlockMatch).not.toBeNull();
        expect(inputBlockMatch[0]).toContain('isDirty = true');
        expect(inputBlockMatch[0]).toContain('debouncedSave()');
        expect(inputBlockMatch[0]).not.toContain('performSave()');
    });

    it('preset target flow fills the name input with the preset name, hides the title, and focuses (without selecting) the name input', async () => {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { dirname, resolve } = await import('path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const code = readFileSync(resolve(__dirname, '../../popup/editor/editor.js'), 'utf-8');

        // Anchor on the distinctive name-input assignment (the 'if (target.type === "preset")'
        // header also appears in saveContent/loadContent) and capture through the block's close.
        const presetBlockMatch = code.match(/nameInputEl\.value = loaded\.name \?\? '';[\s\S]*?\n    \}/);
        expect(presetBlockMatch).not.toBeNull();
        expect(presetBlockMatch[0]).toContain("nameInputEl.value = loaded.name ?? ''");
        expect(presetBlockMatch[0]).toContain("titleEl.classList.add('is-hidden')");
        expect(presetBlockMatch[0]).toContain("nameInputEl.classList.remove('is-hidden')");
        expect(presetBlockMatch[0]).toContain('nameInputEl.focus()');
        // v4.18.2 (2026-08-07): auto-select-all was deliberately removed so the user's
        // first keystroke doesn't wipe the whole preset name -- focus-only, cursor at end.
        // Do NOT reintroduce nameInputEl.select() here; this guards that decision.
        expect(presetBlockMatch[0]).not.toContain('nameInputEl.select()');
    });

    it('name input "input" handler sets isDirty and calls the debounced save (not performSave directly)', async () => {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { dirname, resolve } = await import('path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const code = readFileSync(resolve(__dirname, '../../popup/editor/editor.js'), 'utf-8');

        const inputBlockMatch = code.match(/nameInputEl\.addEventListener\('input', \(\) => \{[\s\S]*?\}\);/);
        expect(inputBlockMatch).not.toBeNull();
        expect(inputBlockMatch[0]).toContain('isDirty = true');
        expect(inputBlockMatch[0]).toContain('debouncedSave()');
        expect(inputBlockMatch[0]).not.toContain('performSave()');
    });
});

// ─────────────────────────────────────────────
// Escape-to-close wiring — source assertion
//
// The window-level keydown listener lives inside the DOMContentLoaded closure
// and is not exported via __DSSEditor, so we assert the literal wiring in
// source, matching the auto-save debounce tests above.
// ─────────────────────────────────────────────

describe('editor.js Escape-to-close wiring — source assertion', () => {
    it('registers a window-level keydown listener that closes the window on Escape', async () => {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { dirname, resolve } = await import('path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const code = readFileSync(resolve(__dirname, '../../popup/editor/editor.js'), 'utf-8');

        // Anchor on the distinctive Esc comment and capture through the listener's close.
        const escBlockMatch = code.match(/\/\/ Esc 關閉視窗：pagehide 自動儲存保證未存內容先寫入[\s\S]*?\}\);/);
        expect(escBlockMatch).not.toBeNull();
        expect(escBlockMatch[0]).toContain("window.addEventListener('keydown'");
        expect(escBlockMatch[0]).toContain("e.key === 'Escape'");
        expect(escBlockMatch[0]).toContain('window.close()');
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

    it('sets text to the message and adds save-status--error for "error" state', () => {
        const statusEl = document.createElement('span');
        statusEl.classList.add('save-status--hidden');
        updateSaveStatus(statusEl, 'error', '「A」已存在，請使用不同的名稱。');
        expect(statusEl.textContent).toBe('「A」已存在，請使用不同的名稱。');
        expect(statusEl.classList.contains('save-status--error')).toBe(true);
        expect(statusEl.classList.contains('save-status--hidden')).toBe(false);
    });

    it('removes save-status--error when leaving the error state ("saving"/"saved")', () => {
        const statusEl = document.createElement('span');
        updateSaveStatus(statusEl, 'error', 'boom');
        expect(statusEl.classList.contains('save-status--error')).toBe(true);

        updateSaveStatus(statusEl, 'saving');
        expect(statusEl.classList.contains('save-status--error')).toBe(false);

        updateSaveStatus(statusEl, 'error', 'boom');
        updateSaveStatus(statusEl, 'saved');
        expect(statusEl.classList.contains('save-status--error')).toBe(false);
    });

    it('does not throw when statusEl is null', () => {
        expect(() => updateSaveStatus(null, 'saving')).not.toThrow();
    });
});

// ─────────────────────────────────────────────
// saveContent — preset rename & duplicate protection
// ─────────────────────────────────────────────

describe('saveContent — preset duplicate-name protection and rename', () => {
    beforeEach(async () => {
        await StorageManager.initialize();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects with code DUPLICATE_NAME and does not save when renaming to a name held by another preset', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Other', content: 'c1', createdAt: 1000, updatedAt: 1000 },
            { id: 'p2', name: 'Shared', content: 'c2', createdAt: 1000, updatedAt: 1000 },
        ]);
        const spy = vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);

        const err = await saveContent({ type: 'preset', id: 'p1' }, 'new content', 'Shared').then(
            () => null,
            (e) => e,
        );

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('DUPLICATE_NAME');
        expect(spy).not.toHaveBeenCalled();
    });

    it('saves fine when the given name matches only the preset itself (own name is not a duplicate)', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Shared', content: 'c1', createdAt: 1000, updatedAt: 1000 },
            { id: 'p2', name: 'Different', content: 'c2', createdAt: 1000, updatedAt: 1000 },
        ]);
        const spy = vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);

        await saveContent({ type: 'preset', id: 'p1' }, 'new content', 'Shared');

        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0].name).toBe('Shared');
        expect(spy.mock.calls[0][0].content).toBe('new content');
    });

    it('updates the preset name and content when the new name is unique', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Old', content: 'c1', createdAt: 1000, updatedAt: 1000 },
            { id: 'p2', name: 'Other', content: 'c2', createdAt: 1000, updatedAt: 1000 },
        ]);
        const spy = vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);

        await saveContent({ type: 'preset', id: 'p1' }, 'new content', 'NewName');

        expect(spy).toHaveBeenCalledOnce();
        const saved = spy.mock.calls[0][0];
        expect(saved.id).toBe('p1');
        expect(saved.name).toBe('NewName');
        expect(saved.content).toBe('new content');
    });

    it('treats a case-different name as not a duplicate and saves it', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Old', content: 'c1', createdAt: 1000, updatedAt: 1000 },
            { id: 'p2', name: 'alpha', content: 'c2', createdAt: 1000, updatedAt: 1000 },
        ]);
        const spy = vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);

        await saveContent({ type: 'preset', id: 'p1' }, 'new content', 'Alpha');

        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0].name).toBe('Alpha');
    });

    it('preserves the existing name on a 2-arg call (no name argument)', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Keep', content: 'c1', createdAt: 1000, updatedAt: 1000 },
        ]);
        const spy = vi.spyOn(StorageManager, 'saveOnePromptPreset').mockResolvedValue(undefined);

        await saveContent({ type: 'preset', id: 'p1' }, 'new content');

        expect(spy).toHaveBeenCalledOnce();
        const saved = spy.mock.calls[0][0];
        expect(saved.name).toBe('Keep');
        expect(saved.content).toBe('new content');
    });
});

// ─────────────────────────────────────────────
// loadContent — preset name exposure
// ─────────────────────────────────────────────

describe('loadContent — preset name exposure', () => {
    beforeEach(async () => {
        await chrome.storage.local.clear?.();
        await chrome.storage.sync.clear?.();
        await StorageManager.initialize();
    });

    it('returns the preset name for a preset target', async () => {
        await StorageManager.savePromptPresets([
            { id: 'p1', name: 'Named Preset', content: 'content', createdAt: 1000, updatedAt: 1000 },
        ]);
        const result = await loadContent({ type: 'preset', id: 'p1' });
        expect(result).not.toBeNull();
        expect(result.name).toBe('Named Preset');
    });
});
