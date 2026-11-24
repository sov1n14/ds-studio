/**
 * Source-text contract for popup/editor/editor.js: reads the file as text and regex-matches the preset target flow wiring inside the DOMContentLoaded closure.
 * Listed on the exclude list of test/stryker-vitest.config.js, because Stryker's instrumented copy of editor.js breaks the regex.
 */
import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────
// Preset target flow wiring — source assertion
//
// The preset target flow lives inside the DOMContentLoaded closure and is not exported via __DSSEditor, so we assert the literal wiring in source.
// ─────────────────────────────────────────────

describe('editor.js preset target flow wiring — source assertion', () => {
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
});
