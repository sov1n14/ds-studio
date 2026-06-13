import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let Modal;

beforeAll(() => {
    const code = readFileSync(resolve(__dirname, '../../popup/popup.modal.js'), 'utf-8');
    // Extract the Modal object definition from the top of popup.js (lines 1-149).
    // Modal is a top-level const, not inside DOMContentLoaded.
    const match = code.match(/const Modal = \{[\s\S]*?\n\};/);
    if (!match) {
        throw new Error('Could not extract Modal object from popup.js');
    }
    // Indirect eval runs in global scope. 'var' creates a globalThis property;
    // 'const' would only create a global lexical binding that is not accessible
    // via globalThis, so we transform the declaration.
    const globalEval = eval;
    globalEval(match[0].replace('const Modal', 'var Modal'));
    if (typeof globalThis.Modal !== 'object') {
        throw new Error('Extracted code did not define Modal as an object');
    }
    Modal = globalThis.Modal;
});

function setupModalDOM() {
    document.body.innerHTML = `
        <div id="modalOverlay" hidden>
            <div id="modalTitle"></div>
            <div id="modalMessage"></div>
            <input id="modalInput">
            <span id="modalRequired"></span>
            <div id="modalActions"></div>
        </div>
    `;
    Modal.init();
}

describe('Modal', () => {
    beforeEach(() => {
        setupModalDOM();
    });

    it('prompt() clears actionsEl before adding buttons', async () => {
        const p1 = Modal.prompt({ title: 'First' });
        expect(Modal.actionsEl.children.length).toBe(2);

        // Resolve first prompt by clicking cancel
        Modal.actionsEl.children[0].click();
        await p1;

        // After cleanup, actionsEl should be empty
        expect(Modal.actionsEl.children.length).toBe(0);

        // Second prompt must not accumulate old buttons
        const p2 = Modal.prompt({ title: 'Second' });
        expect(Modal.actionsEl.children.length).toBe(2);

        // Cleanup
        Modal.actionsEl.children[0].click();
        await p2;
    });

    it('confirm() clears actionsEl before adding buttons', async () => {
        const c1 = Modal.confirm({ title: 'First Confirm' });
        expect(Modal.actionsEl.children.length).toBe(2);

        // Resolve first confirm by clicking cancel
        Modal.actionsEl.children[0].click();
        await c1;

        // After cleanup, actionsEl should be empty
        expect(Modal.actionsEl.children.length).toBe(0);

        // Second confirm must not accumulate old buttons
        const c2 = Modal.confirm({ title: 'Second Confirm' });
        expect(Modal.actionsEl.children.length).toBe(2);

        // Cleanup
        Modal.actionsEl.children[0].click();
        await c2;
    });

    it('_cleanup() clears actionsEl.innerHTML', async () => {
        const p = Modal.prompt({ title: 'Test' });

        // Resolve by clicking cancel, which triggers _cleanup()
        Modal.actionsEl.children[0].click();
        await p;

        expect(Modal.actionsEl.innerHTML).toBe('');
    });

    it('Escape key dismisses modal', async () => {
        const p = Modal.prompt({ title: 'Test' });
        expect(Modal.overlay.hidden).toBe(false);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        await p;
        expect(Modal.overlay.hidden).toBe(true);
    });

    it('dismissActive() dismisses an active prompt modal', async () => {
        const p = Modal.prompt({ title: 'Test' });
        expect(Modal.overlay.hidden).toBe(false);

        Modal.dismissActive();
        await p;

        expect(Modal.overlay.hidden).toBe(true);
    });

    it('dismissActive() is a no-op when no modal is active', () => {
        expect(Modal.overlay.hidden).toBe(true);

        expect(() => Modal.dismissActive()).not.toThrow();
        expect(Modal.overlay.hidden).toBe(true);
    });

    it('mixed prompt then confirm clears old buttons', async () => {
        Modal.prompt({ title: 'Prompt' });
        expect(Modal.actionsEl.children.length).toBe(2);

        // confirm() must reset actionsEl before adding its own buttons
        const c = Modal.confirm({ title: 'Confirm' });
        expect(Modal.actionsEl.children.length).toBe(2);

        // Cleanup the latest dialog
        Modal.actionsEl.children[0].click();
        await c;
    });
});
