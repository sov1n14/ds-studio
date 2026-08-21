/**
 * DOM-adapter behavior tests for content/prompt-injector.send-button.js.
 *
 * These pin the OBSERVABLE contract of the five pure DOM predicates/resolvers
 * that the send-interception path depends on, so a future selector refactor
 * cannot silently change which element counts as "the send button" or which
 * textarea receives the injection.
 *
 * Fixture markup comes from real DeepSeek page samples (see
 * test/helpers/send-button-fixtures.js), never from the selector constants in
 * content/ds-selectors.js.
 *
 * Every assertion is on a returned value only. No internal call sequence and no
 * selector string is asserted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../content/ds-selectors.js';
import '../../content/prompt-injector.send-button.js';
import {
    SEND_ICON_PATH_D,
    EDIT_SEND_CLASSES,
    makeDesktopSendButton,
    makeMobileSendButton,
    makeOtherButton,
    makeEditSendButtonInContainer,
    makeEditCancelButtonInContainer,
    makeEditScenarioWithEmptyAncestorTextarea,
    makeEditSendButtonStandalone,
    mountInDocument,
} from '../helpers/send-button-fixtures.js';

const SB = globalThis.__DS_PromptInjectorSendButton;

// ---------------------------------------------------------------------------
// Local fixtures (scenarios specific to this spec)
// ---------------------------------------------------------------------------

/** An iconless [role=button] with no send-icon SVG and no content span. */
function makeBareButton() {
    const button = document.createElement('div');
    button.className = 'ds-icon-button';
    button.setAttribute('role', 'button');
    return button;
}

/** Wrap `child` in a div carrying `className`; returns the wrapper. */
function wrapIn(className, child) {
    const wrapper = document.createElement('div');
    wrapper.className = className;
    wrapper.appendChild(child);
    return wrapper;
}

/** A textarea with the given value. */
function makeTextarea(value = '') {
    const ta = document.createElement('textarea');
    ta.value = value;
    return ta;
}

/** Blur whatever holds focus so activeElement-priority cases start clean. */
function clearFocus() {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function' && active !== document.body) active.blur();
}

let cleanup = null;

beforeEach(() => { clearFocus(); });
afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.innerHTML = '';
    document.head.querySelectorAll('div[role="button"]').forEach(el => el.remove());
});

// ---------------------------------------------------------------------------
// isSendButtonCandidate
// ---------------------------------------------------------------------------

describe('isSendButtonCandidate', () => {
    it('accepts an icon button whose svg path d starts with the send-icon prefix', () => {
        const { button } = makeDesktopSendButton();
        cleanup = mountInDocument(button);
        expect(SB.isSendButtonCandidate(button)).toBe(true);
    });

    it('accepts the mobile composer send button (icon nested in a wrapper div)', () => {
        const { button } = makeMobileSendButton();
        cleanup = mountInDocument(button);
        expect(SB.isSendButtonCandidate(button)).toBe(true);
    });

    it('rejects an icon button whose svg path d is a different shape', () => {
        const { button } = makeOtherButton();
        cleanup = mountInDocument(button);
        expect(SB.isSendButtonCandidate(button)).toBe(false);
    });

    it('accepts an iconless button placed inside a .ba4f09d3 ancestor', () => {
        const button = makeBareButton();
        const inputArea = wrapIn('ba4f09d3', wrapIn('some-inner-row', button));
        cleanup = mountInDocument(inputArea);
        expect(SB.isSendButtonCandidate(button)).toBe(true);
    });

    it('accepts an iconless button whose direct parent carries class bf38813a', () => {
        const button = makeBareButton();
        const actionsRow = wrapIn('bf38813a', button);
        cleanup = mountInDocument(actionsRow);
        expect(SB.isSendButtonCandidate(button)).toBe(true);
    });

    it('rejects an iconless button that is neither inside .ba4f09d3 nor a child of .bf38813a', () => {
        const button = makeBareButton();
        cleanup = mountInDocument(wrapIn('unrelated-row', button));
        expect(SB.isSendButtonCandidate(button)).toBe(false);
    });

    it('returns false for a detached, parentless button instead of throwing', () => {
        const button = makeBareButton();
        expect(button.parentElement).toBe(null);
        expect(() => SB.isSendButtonCandidate(button)).not.toThrow();
        expect(SB.isSendButtonCandidate(button)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// isEditWindowSendButton
// ---------------------------------------------------------------------------

describe('isEditWindowSendButton', () => {
    it('accepts a primary/filled ds-button carrying a non-empty content span', () => {
        const { container, button } = makeEditSendButtonInContainer('edit message', '发送');
        cleanup = mountInDocument(container);
        expect(SB.isEditWindowSendButton(button)).toBe(true);
    });

    it('accepts it regardless of the label language (structure, not wording, decides)', () => {
        const { container, button } = makeEditSendButtonInContainer('edit message', 'Send');
        cleanup = mountInDocument(container);
        expect(SB.isEditWindowSendButton(button)).toBe(true);
    });

    it('rejects it when the content span is present but empty', () => {
        const { container, button, span } = makeEditSendButtonInContainer('edit message', '发送');
        span.textContent = '';
        cleanup = mountInDocument(container);
        expect(SB.isEditWindowSendButton(button)).toBe(false);
    });

    it('rejects it when the content span is whitespace only', () => {
        const { container, button, span } = makeEditSendButtonInContainer('edit message', '发送');
        span.textContent = '   ';
        cleanup = mountInDocument(container);
        expect(SB.isEditWindowSendButton(button)).toBe(false);
    });

    it('rejects a primary/filled ds-button with no content span at all', () => {
        const button = document.createElement('div');
        button.className = EDIT_SEND_CLASSES;
        button.setAttribute('role', 'button');
        cleanup = mountInDocument(button);
        expect(SB.isEditWindowSendButton(button)).toBe(false);
    });

    it('rejects the outlined Cancel button even though it has a non-empty content span', () => {
        const { container, button } = makeEditCancelButtonInContainer('edit message', '取消');
        cleanup = mountInDocument(container);
        expect(SB.isEditWindowSendButton(button)).toBe(false);
    });

    it('returns false for a detached, parentless plain div instead of throwing', () => {
        const bare = document.createElement('div');
        expect(() => SB.isEditWindowSendButton(bare)).not.toThrow();
        expect(SB.isEditWindowSendButton(bare)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// isSendButtonEnabled
// ---------------------------------------------------------------------------

describe('isSendButtonEnabled', () => {
    it('reports an untouched composer send button as enabled', () => {
        const { button } = makeMobileSendButton();
        cleanup = mountInDocument(button);
        expect(SB.isSendButtonEnabled(button)).toBe(true);
    });

    it('reports false when the ds-button--disabled class is present', () => {
        const { button } = makeMobileSendButton();
        button.classList.add('ds-button--disabled');
        cleanup = mountInDocument(button);
        expect(SB.isSendButtonEnabled(button)).toBe(false);
    });

    it('reports false when aria-disabled is "true"', () => {
        const { button } = makeMobileSendButton();
        button.setAttribute('aria-disabled', 'true');
        cleanup = mountInDocument(button);
        expect(SB.isSendButtonEnabled(button)).toBe(false);
    });

    it('reports true when aria-disabled is "false"', () => {
        const { button } = makeMobileSendButton();
        button.setAttribute('aria-disabled', 'false');
        cleanup = mountInDocument(button);
        expect(SB.isSendButtonEnabled(button)).toBe(true);
    });

    it('reports false when the element carries a disabled property set to true', () => {
        const { button } = makeMobileSendButton();
        button.disabled = true;
        cleanup = mountInDocument(button);
        expect(SB.isSendButtonEnabled(button)).toBe(false);
    });

    it('reports false for null instead of throwing', () => {
        expect(() => SB.isSendButtonEnabled(null)).not.toThrow();
        expect(SB.isSendButtonEnabled(null)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// findSendButtonForTextarea
// ---------------------------------------------------------------------------

describe('findSendButtonForTextarea', () => {
    it('finds the send button that shares an ancestor with the textarea', () => {
        const { button } = makeMobileSendButton();
        const actionsRow = wrapIn('bf38813a', button);
        const inputArea = document.createElement('div');
        const textarea = makeTextarea('');
        inputArea.appendChild(textarea);
        inputArea.appendChild(actionsRow);
        cleanup = mountInDocument(inputArea);

        expect(SB.findSendButtonForTextarea(textarea)).toBe(button);
    });

    it('returns null when the only [role=button] in the input area is not a send button', () => {
        const { button } = makeOtherButton();
        const inputArea = document.createElement('div');
        const textarea = makeTextarea('');
        inputArea.appendChild(textarea);
        inputArea.appendChild(button);
        cleanup = mountInDocument(inputArea);

        expect(SB.findSendButtonForTextarea(textarea)).toBe(null);
    });

    it('returns null when the input area has no button at all', () => {
        const inputArea = document.createElement('div');
        const textarea = makeTextarea('');
        inputArea.appendChild(textarea);
        cleanup = mountInDocument(inputArea);

        expect(SB.findSendButtonForTextarea(textarea)).toBe(null);
    });

    it('does not walk past document.body: a send button outside body is never returned', () => {
        const { button } = makeMobileSendButton();
        document.head.appendChild(button);
        const textarea = makeTextarea('');
        cleanup = mountInDocument(textarea);

        expect(SB.findSendButtonForTextarea(textarea)).toBe(null);
    });

    it('returns null for a detached textarea instead of walking off the tree', () => {
        const { button } = makeMobileSendButton();
        cleanup = mountInDocument(wrapIn('bf38813a', button));
        const detached = makeTextarea('');

        expect(detached.parentElement).toBe(null);
        expect(() => SB.findSendButtonForTextarea(detached)).not.toThrow();
        expect(SB.findSendButtonForTextarea(detached)).toBe(null);
    });
});

// ---------------------------------------------------------------------------
// resolveTextareaForButton
//
// Documented priority for the edit-window case:
//   1. the focused textarea
//   2. the nearest NON-EMPTY textarea found walking up from the button
//   3. the first NON-EMPTY textarea in the document
//   4. the nearest EMPTY textarea found walking up from the button
//   5. the first textarea in the document (whatever it is)
// Each case below is built so that exactly one rung can produce the expected
// element, and a lower rung would produce a different one.
// ---------------------------------------------------------------------------

describe('resolveTextareaForButton (edit-window case)', () => {
    it('P1 prefers the focused textarea over a non-empty textarea in the walk-up', () => {
        const { container, button, textarea: inContainer } =
            makeEditSendButtonInContainer('in-container text');
        const focused = makeTextarea('focused text');
        cleanup = mountInDocument(container, focused);
        focused.focus();

        expect(SB.resolveTextareaForButton(button, true)).toBe(focused);
        expect(inContainer.value).toBe('in-container text');
    });

    it('P2 with nothing focused, prefers the non-empty textarea from the walk-up over document order', () => {
        const decoy = makeTextarea('earlier in document');
        const { container, button, textarea: inContainer } =
            makeEditSendButtonInContainer('in-container text');
        cleanup = mountInDocument(decoy, container);

        expect(SB.resolveTextareaForButton(button, true)).toBe(inContainer);
    });

    it('P3 skips an EMPTY textarea in the walk-up and takes the first non-empty one in the document', () => {
        const { editTextarea, container, button, emptyTextarea } =
            makeEditScenarioWithEmptyAncestorTextarea('edit message');
        cleanup = mountInDocument(editTextarea, container);

        expect(SB.resolveTextareaForButton(button, true)).toBe(editTextarea);
        expect(emptyTextarea.value).toBe('');
    });

    it('P4 falls back to the EMPTY textarea from the walk-up when no non-empty one exists anywhere', () => {
        const decoyEmpty = makeTextarea('');
        const { container, button, emptyTextarea } =
            makeEditScenarioWithEmptyAncestorTextarea('');
        cleanup = mountInDocument(decoyEmpty, container);

        expect(SB.resolveTextareaForButton(button, true)).toBe(emptyTextarea);
    });

    it('P5 falls back to the first textarea in the document when the walk-up finds none', () => {
        const { button, textarea } = makeEditSendButtonStandalone('portal text');
        cleanup = mountInDocument(textarea, button);

        expect(SB.resolveTextareaForButton(button, true)).toBe(textarea);
    });
});

describe('resolveTextareaForButton (composer case)', () => {
    it('always takes the first textarea in the document, ignoring focus and the walk-up', () => {
        const first = makeTextarea('first in document');
        const inputArea = document.createElement('div');
        const near = makeTextarea('near the button');
        const { button } = makeMobileSendButton();
        inputArea.appendChild(near);
        inputArea.appendChild(wrapIn('bf38813a', button));
        cleanup = mountInDocument(first, inputArea);
        near.focus();

        expect(SB.resolveTextareaForButton(button, false)).toBe(first);
    });

    it('treats an omitted isEditSendButton argument as the composer case', () => {
        const first = makeTextarea('first in document');
        const inputArea = document.createElement('div');
        const near = makeTextarea('near the button');
        const { button } = makeMobileSendButton();
        inputArea.appendChild(near);
        inputArea.appendChild(wrapIn('bf38813a', button));
        cleanup = mountInDocument(first, inputArea);

        expect(SB.resolveTextareaForButton(button)).toBe(first);
    });
});
