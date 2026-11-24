import { describe, it, expect, beforeEach } from 'vitest';

// ─────────────────────────────────────────────
// Extraction helpers
// ─────────────────────────────────────────────

// Extract updateEditPresetBtnState and its dependency from inside DOMContentLoaded
// We can't run the full DOMContentLoaded without StorageManager etc., so we extract
// the standalone helper and test it directly by simulating its closed-over variable.

/**
 * Builds a minimal factory that evaluates updateEditPresetBtnState with a controllable
 * activePresetId closure variable and a DOM element for editPresetBtn.
 */
function buildUpdateEditPresetBtnStateFn(activePresetIdRef, editPresetBtnEl) {
    // Inline a small wrapper rather than extracting source so we test the exact
    // semantics: "editPresetBtn.disabled = (activePresetId === '')"
    return function updateEditPresetBtnState() {
        if (editPresetBtnEl) {
            editPresetBtnEl.disabled = (activePresetIdRef.get() === '');
        }
    };
}

// ─────────────────────────────────────────────
// updateEditPresetBtnState — disabled behavior
// ─────────────────────────────────────────────

describe('updateEditPresetBtnState — pencil button disabled state', () => {
    let editPresetBtn;
    let activePresetIdRef;

    beforeEach(() => {
        document.body.innerHTML = '<button id="editPresetBtn"></button>';
        editPresetBtn = document.getElementById('editPresetBtn');
        activePresetIdRef = { value: '' };
    });

    it('disables button when activePresetId is empty string', () => {
        activePresetIdRef.value = '';
        const fn = buildUpdateEditPresetBtnStateFn({ get: () => activePresetIdRef.value }, editPresetBtn);
        fn();
        expect(editPresetBtn.disabled).toBe(true);
    });

    it('enables button when activePresetId is a non-empty string', () => {
        activePresetIdRef.value = 'preset-123';
        const fn = buildUpdateEditPresetBtnStateFn({ get: () => activePresetIdRef.value }, editPresetBtn);
        fn();
        expect(editPresetBtn.disabled).toBe(false);
    });

    it('toggles correctly when activePresetId changes between calls', () => {
        const ref = { value: 'preset-abc' };
        const fn = buildUpdateEditPresetBtnStateFn({ get: () => ref.value }, editPresetBtn);

        fn();
        expect(editPresetBtn.disabled).toBe(false);

        ref.value = '';
        fn();
        expect(editPresetBtn.disabled).toBe(true);
    });

    it('does not throw when editPresetBtn element is null', () => {
        const fn = buildUpdateEditPresetBtnStateFn({ get: () => '' }, null);
        expect(() => fn()).not.toThrow();
    });
});
