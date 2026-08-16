import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * The add-preset flow lives inline inside popup.js's DOMContentLoaded handler
 * (bound to addPresetBtn's click listener), closed over live popup state
 * (Modal, StorageManager, dsI18n, chrome.tabs, customSelect, currentTabUuid,
 * etc.). Driving that handler end-to-end would require standing up the full
 * popup.html DOM plus every window.__DS_Popup* submodule and chrome.* mock —
 * effectively an integration test, which this project's unit-test-only policy
 * forbids.
 *
 * Instead — mirroring the existing precedent in popup-custom-select.spec.js,
 * which extracts and evaluates the `const Modal = { ... };` object literal
 * straight out of popup.modal.js in isolation — this spec extracts the
 * self-contained `const newPreset = { ... };` object-literal construction out
 * of popup.js and evaluates it directly. The literal has no dependency on
 * outer closure state besides the local `name` variable, Date.now() and
 * Math.random(), so this is a faithful, non-tautological exercise of the real
 * construction code, not a source-text regex match.
 */
let buildNewPreset;

beforeAll(() => {
    const popupCode = readFileSync(resolve(__dirname, '../../popup/popup.js'), 'utf-8');
    const match = popupCode.match(/const newPreset = \{[\s\S]*?\n\s*\};/);
    if (!match) {
        throw new Error('Could not extract the newPreset object-literal construction from popup/popup.js');
    }

    // Wrap the extracted literal in a function so each test gets a fresh
    // object built from the real, unmodified source snippet.
    buildNewPreset = new Function('name', `${match[0]}\nreturn newPreset;`);
});

describe('popup.js add-preset flow — newPreset object construction', () => {
    it('sets globalPromptEnabled to true explicitly on a newly created preset', () => {
        const newPreset = buildNewPreset('My New Preset');

        expect(newPreset).toHaveProperty('globalPromptEnabled');
        expect(newPreset.globalPromptEnabled).toBe(true);
    });

    it('keeps all pre-existing fields intact and correctly derived from the given name', () => {
        const newPreset = buildNewPreset('My New Preset');

        expect(newPreset.name).toBe('My New Preset');
        expect(newPreset.content).toBe('');
        expect(typeof newPreset.id).toBe('string');
        expect(newPreset.id.startsWith('preset-')).toBe(true);
        expect(typeof newPreset.createdAt).toBe('number');
        expect(typeof newPreset.updatedAt).toBe('number');
    });
});
