/**
 * Edit-window send-button recognition with ds-selectors.js and
 * prompt-injector.send-button.js loaded INSIDE each test (beforeEach), not at import time.
 *
 * Why a separate fresh-load spec: ds-selectors.js is a pure load-time module, so every
 * mutant in it is "static". test/stryker.config.json sets "ignoreStatic": true, under which
 * Stryker runs a static mutant only against tests that load the module inside a test hook
 * (per-test coverage). prompt-injector.send-button.spec.js loads both modules at import
 * time, so its identical assertions never run against ds-selectors.js mutants. This spec
 * re-evaluates both modules per test, putting the consumer's observable behavior in front
 * of those mutants.
 *
 * Kept out of prompt-injector.send-button.spec.js because that file already exceeds the
 * 450-line limit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    makeEditSendButtonInContainer,
    makeEditCancelButtonInContainer,
    mountInDocument,
} from '../helpers/send-button-fixtures.js';

const SELECTORS_PATH = require.resolve('../../content/ds-selectors.js');
const SEND_BUTTON_PATH = require.resolve('../../content/prompt-injector.send-button.js');

/**
 * Evaluate ds-selectors.js then prompt-injector.send-button.js from scratch, with no
 * previously published Selectors global for the consumer to fall back on.
 */
function loadFreshSendButton() {
    delete require.cache[SELECTORS_PATH];
    delete require.cache[SEND_BUTTON_PATH];
    if (globalThis.DSstudio) delete globalThis.DSstudio.Selectors;
    if (typeof window !== 'undefined' && window.DSstudio) delete window.DSstudio.Selectors;
    require(SELECTORS_PATH);
    return require(SEND_BUTTON_PATH);
}

let SB;
let cleanup = null;

beforeEach(() => { SB = loadFreshSendButton(); });
afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.innerHTML = '';
});

describe('isEditWindowSendButton (fresh module load)', () => {
    it('accepts the primary/filled edit-window Send button with a content label', () => {
        const { container, button } = makeEditSendButtonInContainer('edit message', '发送');
        cleanup = mountInDocument(container);
        expect(SB.isEditWindowSendButton(button)).toBe(true);
    });

    it('rejects the outlined Cancel button although it also carries a non-empty content label', () => {
        const { container, button } = makeEditCancelButtonInContainer('edit message', '取消');
        cleanup = mountInDocument(container);
        expect(SB.isEditWindowSendButton(button)).toBe(false);
    });
});
