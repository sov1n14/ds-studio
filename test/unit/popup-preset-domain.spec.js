/**
 * Tests for popup/popup.preset-domain.js — the shared preset domain module
 * (backlog B3 + B4).
 *
 * Requirements under test (derived from the task directive, not from any
 * implementation):
 *
 *   createPreset(name)
 *     - returns a new preset entity with fields: id, name, content,
 *       createdAt, updatedAt, globalPromptEnabled
 *     - id format: 'preset-' + <epoch ms> + '-' + <short base36 suffix>
 *     - content defaults to '', globalPromptEnabled defaults to true
 *     - createdAt === updatedAt, both set to "now"
 *     - the name is stored verbatim
 *     - two calls never produce the same id
 *
 *   validatePresetName(name, existingPresets, { selfId })
 *     - returns { ok: true } or { ok: false, reason: 'empty' | 'duplicate' }
 *     - empty / whitespace-only / missing name  -> reason 'empty'
 *     - exact (case-sensitive) name match against another preset -> 'duplicate'
 *     - a match differing only by case is NOT a duplicate
 *     - the preset identified by options.selfId is excluded from the
 *       comparison, so renaming a preset to its own current name is valid
 *     - options may be omitted entirely (the add-preset flow has no self)
 *
 * The module is a classic popup script publishing globalThis.DSSPresetDomain,
 * loaded here the same way every other popup script spec loads one.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { evalPopupScript } from '../helpers/popup-script-loader.js';

let createPreset;
let validatePresetName;

beforeAll(() => {
    evalPopupScript('popup/popup.preset-domain.js');
    ({ createPreset, validatePresetName } = globalThis.DSSPresetDomain);
});

// ─────────────────────────────────────────────
// createPreset
// ─────────────────────────────────────────────

describe('createPreset — new preset entity construction', () => {
    it('produces an id of the form preset-<epoch ms>-<short base36 suffix>', () => {
        const before = Date.now();
        const preset = createPreset('My New Preset');
        const after = Date.now();

        expect(preset.id).toMatch(/^preset-\d+-[a-z0-9]{0,4}$/);

        const stamp = Number(preset.id.split('-')[1]);
        expect(stamp).toBeGreaterThanOrEqual(before);
        expect(stamp).toBeLessThanOrEqual(after);
    });

    it('stores the given name verbatim and defaults content, flag and timestamps', () => {
        const before = Date.now();
        const preset = createPreset('My New Preset');
        const after = Date.now();

        expect(preset.name).toBe('My New Preset');
        expect(preset.content).toBe('');
        expect(preset.globalPromptEnabled).toBe(true);
        expect(preset.createdAt).toBe(preset.updatedAt);
        expect(preset.createdAt).toBeGreaterThanOrEqual(before);
        expect(preset.createdAt).toBeLessThanOrEqual(after);
    });

    it('never returns the same id twice', () => {
        const ids = new Set(Array.from({ length: 50 }, (_, i) => createPreset(`p${i}`).id));
        expect(ids.size).toBe(50);
    });
});

// ─────────────────────────────────────────────
// validatePresetName
// ─────────────────────────────────────────────

const PRESETS = [
    { id: 'a', name: 'Alpha', content: '' },
    { id: 'b', name: 'Beta', content: '' },
];

describe('validatePresetName — empty names', () => {
    it.each([
        ['empty string', ''],
        ['spaces only', '   '],
        ['tab and newline only', '\t\n'],
        ['undefined', undefined],
        ['null', null],
    ])('rejects %s with reason "empty"', (_label, name) => {
        expect(validatePresetName(name, PRESETS)).toEqual({ ok: false, reason: 'empty' });
    });
});

describe('validatePresetName — duplicates (case-sensitive)', () => {
    it('rejects a name already used by another preset', () => {
        expect(validatePresetName('Alpha', PRESETS)).toEqual({ ok: false, reason: 'duplicate' });
    });

    it('accepts a name that differs only by case', () => {
        expect(validatePresetName('alpha', PRESETS)).toEqual({ ok: true });
    });

    it('accepts an unused name', () => {
        expect(validatePresetName('Gamma', PRESETS)).toEqual({ ok: true });
    });

    it('accepts any non-empty name when there are no existing presets', () => {
        expect(validatePresetName('Alpha', [])).toEqual({ ok: true });
    });
});

describe('validatePresetName — selfId exclusion (rename flow)', () => {
    it('accepts renaming a preset to the name it already has', () => {
        expect(validatePresetName('Alpha', PRESETS, { selfId: 'a' })).toEqual({ ok: true });
    });

    it('still rejects a name owned by a different preset', () => {
        expect(validatePresetName('Beta', PRESETS, { selfId: 'a' })).toEqual({ ok: false, reason: 'duplicate' });
    });

    it('rejects a duplicate when two other presets share the name and selfId is neither', () => {
        const presets = [
            { id: 'a', name: 'Same', content: '' },
            { id: 'b', name: 'Same', content: '' },
            { id: 'c', name: 'Other', content: '' },
        ];
        expect(validatePresetName('Same', presets, { selfId: 'c' })).toEqual({ ok: false, reason: 'duplicate' });
    });

    it('still reports an empty name as "empty", not "duplicate", when selfId is given', () => {
        expect(validatePresetName('  ', PRESETS, { selfId: 'a' })).toEqual({ ok: false, reason: 'empty' });
    });

    it('treats an unknown selfId as excluding nothing', () => {
        expect(validatePresetName('Alpha', PRESETS, { selfId: 'nope' })).toEqual({ ok: false, reason: 'duplicate' });
    });
});
