/**
 * Regression tests for the send-button interception fix (mobile layout).
 *
 * Bug: On mobile layout DeepSeek uses `div.ds-button[role="button"]` for the
 * send button, whereas desktop uses `div.ds-icon-button[role="button"]`.
 * The original selector only matched the desktop variant, so tapping the mobile
 * send button never triggered prefix injection.
 *
 * Fix: The selector in the pointerdown/mousedown/click handler was broadened to:
 *   e.target.closest('div.ds-icon-button[role="button"], div.ds-button[role="button"]')
 *
 * These tests verify that both variants are detected and that a non-send button
 * (missing the M8.3125 SVG path) is correctly ignored.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a desktop-style send button DOM subtree:
 *   <div class="ds-icon-button" role="button">
 *     <svg><path d="M8.3125..."/></svg>
 *   </div>
 * Returns { button, svg } so the tap target (svg) can be dispatched.
 */
function makeDesktopSendButton() {
    const button = document.createElement('div');
    button.className = 'ds-icon-button';
    button.setAttribute('role', 'button');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8.3125 0L16.625 8.3125L8.3125 16.625');
    svg.appendChild(path);
    button.appendChild(svg);

    return { button, svg };
}

/**
 * Build a mobile-style send button DOM subtree matching the real mobile shape:
 *   <div class="ds-button ds-button--primary ... " role="button">
 *     <div class="ds-button__icon ds-button__icon--last-child">
 *       <svg><path d="M8.3125..."/></svg>
 *     </div>
 *   </div>
 * Returns { button, svg } — the real tap target is the inner svg.
 */
function makeMobileSendButton() {
    const button = document.createElement('div');
    button.className =
        'ds-button ds-button--primary ds-button--filled ds-button--circle ' +
        'ds-button--m ds-button--icon-relative-m _52c986b';
    button.setAttribute('role', 'button');

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'ds-button__icon ds-button__icon--last-child';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8.3125 0L16.625 8.3125L8.3125 16.625');
    svg.appendChild(path);

    iconWrapper.appendChild(svg);
    button.appendChild(iconWrapper);

    return { button, svg };
}

/**
 * Build a generic button with role="button" but NO send-icon SVG.
 * Represents any other interactive element (e.g., a toolbar action).
 */
function makeOtherButton() {
    const button = document.createElement('div');
    button.className = 'ds-icon-button';
    button.setAttribute('role', 'button');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Different path — NOT the send icon
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0 0 L10 10 L20 0');
    svg.appendChild(path);
    button.appendChild(svg);

    return { button, svg };
}

/**
 * Build an edit-message send button DOM subtree:
 *   <div class="edit-container">
 *     <textarea>user text</textarea>
 *     <div class="ds-button ds-button--primary ..." role="button">
 *       <div class="ds-button__background"></div>
 *       <span class="ds-button__content">发送</span>
 *     </div>
 *   </div>
 * Returns { container, button, span, textarea }
 */
function makeEditSendButtonInContainer(value = 'edit text', label = '发送') {
    const container = document.createElement('div');
    container.className = 'edit-container';

    const textarea = document.createElement('textarea');
    textarea.value = value;

    const button = document.createElement('div');
    button.className =
        'ds-button ds-button--primary ds-button--filled ds-button--capsule ' +
        'ds-button--s ds-button--icon-relative-m ds-button--min-width';
    button.setAttribute('role', 'button');

    const bg = document.createElement('div');
    bg.className = 'ds-button__background';

    const span = document.createElement('span');
    span.className = 'ds-button__content';
    span.textContent = label;

    button.appendChild(bg);
    button.appendChild(span);
    container.appendChild(textarea);
    container.appendChild(button);

    return { container, button, span, textarea };
}

/**
 * Build an edit-window Cancel button DOM subtree matching the real markup:
 *   <div class="edit-container">
 *     <textarea>user text</textarea>
 *     <div class="ds-button ds-button--outlinedNeutral ds-button--outlined ..." role="button">
 *       <div class="ds-button__background"></div>
 *       <div class="ds-button__border"></div>
 *       <span class="ds-button__content">取消</span>
 *     </div>
 *   </div>
 * Structurally distinct from the Send button fixture by variant classes
 * (--outlinedNeutral --outlined vs --primary --filled) and the extra
 * ds-button__border child. Verbatim per to-do/samples/input-area.html:31-41.
 * Returns { container, button, span, textarea }
 */
function makeEditCancelButtonInContainer(value = 'edit text', label = '取消') {
    const container = document.createElement('div');
    container.className = 'edit-container';

    const textarea = document.createElement('textarea');
    textarea.value = value;

    const button = document.createElement('div');
    button.className =
        'ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--capsule ' +
        'ds-button--s ds-button--icon-relative-m ds-button--min-width';
    button.setAttribute('role', 'button');

    const bg = document.createElement('div');
    bg.className = 'ds-button__background';

    const border = document.createElement('div');
    border.className = 'ds-button__border';

    const span = document.createElement('span');
    span.className = 'ds-button__content';
    span.textContent = label;

    button.appendChild(bg);
    button.appendChild(border);
    button.appendChild(span);
    container.appendChild(textarea);
    container.appendChild(button);

    return { container, button, span, textarea };
}

/**
 * Build the "empty ancestor composer" scenario for TC-8:
 * - A non-empty edit textarea placed BEFORE the container in document order,
 *   so document.querySelector('textarea') resolves to it as a final fallback.
 * - A container holding an EMPTY textarea (main composer) co-located with the
 *   edit send button, so the DOM walk-up encounters the empty one first.
 * Returns { editTextarea, container, button, span, emptyTextarea }.
 */
function makeEditScenarioWithEmptyAncestorTextarea(editValue = 'edit message') {
    const editTextarea = document.createElement('textarea');
    editTextarea.value = editValue;

    const container = document.createElement('div');
    container.className = 'outer-send-container';

    const emptyTextarea = document.createElement('textarea');
    emptyTextarea.value = '';

    const button = document.createElement('div');
    button.className =
        'ds-button ds-button--primary ds-button--filled ds-button--capsule ' +
        'ds-button--s ds-button--icon-relative-m ds-button--min-width';
    button.setAttribute('role', 'button');

    const span = document.createElement('span');
    span.className = 'ds-button__content';
    span.textContent = '发送';

    button.appendChild(span);
    container.appendChild(emptyTextarea);
    container.appendChild(button);

    return { editTextarea, container, button, span, emptyTextarea };
}

/**
 * Build an edit-message send button where the textarea is NOT inside the
 * button's ancestor DOM tree (simulates React portal scenario where the
 * DOM walk-up in the handler fails).
 * Returns { button, span, textarea } all independent elements.
 */
function makeEditSendButtonStandalone(value = 'edit text') {
    const button = document.createElement('div');
    button.className =
        'ds-button ds-button--primary ds-button--filled ds-button--capsule ' +
        'ds-button--s ds-button--icon-relative-m ds-button--min-width';
    button.setAttribute('role', 'button');

    const span = document.createElement('span');
    span.className = 'ds-button__content';
    span.textContent = '发送';
    button.appendChild(span);

    // Textarea is a sibling of button on body, NOT inside any ancestor of button
    const textarea = document.createElement('textarea');
    textarea.value = value;

    return { button, span, textarea };
}

/**
 * Attach button + textarea to document.body and return a cleanup function.
 */
function mountInDocument(...elements) {
    elements.forEach(el => document.body.appendChild(el));
    return () => elements.forEach(el => el.parentNode?.removeChild(el));
}

/**
 * Dispatch a pointerdown event from a given target element, simulating the
 * real browser event where e.target is the inner element (e.g., svg) and
 * closest() walks up from there.
 */
function dispatchPointerdown(target) {
    const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Send-button interception: desktop vs mobile selector fix', () => {
    let textarea;
    let cleanup;

    beforeEach(() => {
        contentScript.__resetState();
        contentScript.__setState({ isEnabled: true, globalDefaultPrompt: 'sys' });

        textarea = document.createElement('textarea');
        textarea.value = 'hello world';
    });

    afterEach(() => {
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
        textarea = null;
    });

    // -----------------------------------------------------------------------
    // TC-1: Desktop send button (ds-icon-button) — must trigger injection
    // -----------------------------------------------------------------------
    it('TC-1 DESKTOP: tapping inner svg of ds-icon-button[role=button] triggers injection', () => {
        const { button, svg } = makeDesktopSendButton();
        cleanup = mountInDocument(button, textarea);

        dispatchPointerdown(svg);

        // After injection, textarea value must be wrapped
        expect(textarea.value).toContain('<user-input>');
        expect(textarea.value).toContain('hello world');
    });

    // -----------------------------------------------------------------------
    // TC-2: Mobile send button (ds-button) — must ALSO trigger injection
    //        (this was the regression — previously NOT detected)
    // -----------------------------------------------------------------------
    it('TC-2 MOBILE: tapping inner svg of ds-button[role=button] triggers injection (regression fix)', () => {
        const { button, svg } = makeMobileSendButton();
        cleanup = mountInDocument(button, textarea);

        dispatchPointerdown(svg);

        // After injection, textarea value must be wrapped
        expect(textarea.value).toContain('<user-input>');
        expect(textarea.value).toContain('hello world');
    });

    // -----------------------------------------------------------------------
    // TC-3: Non-send button (no M8.3125 path) — must NOT trigger injection
    // -----------------------------------------------------------------------
    it('TC-3 NEGATIVE: tapping a [role=button] div without the M8.3125 SVG does NOT inject', () => {
        const { button, svg } = makeOtherButton();
        cleanup = mountInDocument(button, textarea);

        const originalValue = textarea.value;
        dispatchPointerdown(svg);

        // Textarea must be untouched
        expect(textarea.value).toBe(originalValue);
        expect(textarea.value).not.toContain('<user-input>');
    });

    // -----------------------------------------------------------------------
    // TC-4: Edit-message Send button — must trigger injection regardless of
    //       the UI locale of its label. The predicate must NOT compare the
    //       label text against a hardcoded literal; ANY label on the edit
    //       window's Send button (identified structurally, not linguistically)
    //       must be recognized.
    // -----------------------------------------------------------------------
    it.each([
        ['发送', 'Simplified Chinese (no regression)'],
        ['傳送', 'Traditional Chinese'],
        ['Send', 'English'],
    ])('TC-4 EDIT-SEND (%s / %s): edit-window Send button triggers injection regardless of label language', (label) => {
        const { container, span } = makeEditSendButtonInContainer('edit message', label);
        cleanup = mountInDocument(container);

        dispatchPointerdown(span);

        const textarea = container.querySelector('textarea');
        expect(textarea.value).toContain('<user-input>');
        expect(textarea.value).toContain('edit message');
    });

    // -----------------------------------------------------------------------
    // TC-5: Edit-window Cancel button — must NEVER trigger injection, no
    //       matter which locale label it carries.
    // -----------------------------------------------------------------------
    it.each([
        ['取消', 'Chinese'],
        ['Cancel', 'English'],
    ])('TC-5 NEGATIVE EDIT (%s / %s): edit-window Cancel button does NOT inject', (label) => {
        const { container, span, textarea } = makeEditCancelButtonInContainer('edit message', label);
        cleanup = mountInDocument(container);

        const originalValue = textarea.value;
        dispatchPointerdown(span);

        expect(textarea.value).toBe(originalValue);
        expect(textarea.value).not.toContain('<user-input>');
    });

    // -----------------------------------------------------------------------
    // TC-5b: An icon-only button sharing the SAME "primary/filled" classes as
    //       the edit Send button, but with NEITHER the send-icon SVG path NOR
    //       a span.ds-button__content label, must NOT be treated as the edit
    //       Send button. This proves the predicate cannot key on the
    //       primary/filled classes alone (those are shared with the main
    //       composer's send button).
    // -----------------------------------------------------------------------
    it('TC-5b NEGATIVE AMBIGUOUS: primary/filled button with no send-icon and no content span does NOT inject', () => {
        const button = document.createElement('div');
        button.className =
            'ds-button ds-button--primary ds-button--filled ds-button--capsule ' +
            'ds-button--s ds-button--icon-relative-m ds-button--min-width';
        button.setAttribute('role', 'button');
        // Deliberately no span.ds-button__content and no send-icon svg.

        cleanup = mountInDocument(button, textarea);

        const originalValue = textarea.value;
        dispatchPointerdown(button);

        expect(textarea.value).toBe(originalValue);
        expect(textarea.value).not.toContain('<user-input>');
    });

    // -----------------------------------------------------------------------
    // TC-5c: The main composer's icon-only send button (ds-button--circle,
    //       NO span.ds-button__content) must keep being handled by the
    //       composer-send detection path — it must not be swallowed or
    //       double-handled by the edit-Send predicate merely because it
    //       shares ds-button--primary/--filled with the edit Send button.
    // -----------------------------------------------------------------------
    it('TC-5c COMPOSER-NOT-EDIT: icon-only composer send button (no content span) still injects via the composer path', () => {
        const { button, svg } = makeMobileSendButton();
        cleanup = mountInDocument(button, textarea);

        dispatchPointerdown(svg);

        expect(textarea.value).toContain('<user-input>');
        expect(textarea.value).toContain('hello world');
    });

    // -----------------------------------------------------------------------
    // TC-6: Edit send button with textarea outside button DOM tree (React portal)
    //       Must trigger injection via the document.activeElement fallback
    // -----------------------------------------------------------------------
    it('TC-6 EDIT-SEND FALLBACK: injection works when textarea is outside button DOM tree', () => {
        const { button, span, textarea } = makeEditSendButtonStandalone('fallback test');
        cleanup = mountInDocument(button, textarea);

        // Focus the textarea so the fallback can find it via document.activeElement
        textarea.focus();

        dispatchPointerdown(span);

        expect(textarea.value).toContain('<user-input>');
        expect(textarea.value).toContain('fallback test');
    });

    // -----------------------------------------------------------------------
    // TC-7: document.activeElement TEXTAREA takes priority over the textarea
    //       found via DOM walk-up.
    //       With the old logic (walk-up first), the in-container textarea would
    //       be chosen; the new logic (activeElement first) must choose the
    //       focused textarea instead.
    // -----------------------------------------------------------------------
    it('TC-7 ACTIVE-ELEMENT PRIORITY: focused TEXTAREA is chosen over the textarea found via DOM walk-up', () => {
        // Container holds its own non-empty textarea + the edit send button.
        // DOM walk-up from button would find containerTextarea if checked first.
        const { container, button, span, textarea: containerTextarea } =
            makeEditSendButtonInContainer('in-container text');

        // Separate textarea that represents the actual edit area being focused.
        const activeTextarea = document.createElement('textarea');
        activeTextarea.value = 'active edit text';

        // Mount container before activeTextarea; document.querySelector('textarea')
        // would find containerTextarea first — activeElement must take priority.
        cleanup = mountInDocument(container, activeTextarea);

        // Focus the separate textarea: document.activeElement becomes activeTextarea.
        activeTextarea.focus();

        dispatchPointerdown(span);

        // The focused activeElement must receive injection.
        expect(activeTextarea.value).toContain('<user-input>');
        expect(activeTextarea.value).toContain('active edit text');
        // The in-container textarea must remain untouched.
        expect(containerTextarea.value).not.toContain('<user-input>');
    });

    // -----------------------------------------------------------------------
    // TC-8: DOM walk-up encounters an empty main composer textarea and skips it
    //       (ta.value.trim() === ''); the final querySelector fallback must
    //       resolve to the non-empty edit textarea instead.
    //       document.activeElement is NOT a textarea in this scenario.
    // -----------------------------------------------------------------------
    it('TC-8 EMPTY-SKIP FALLBACK: DOM walk-up skips empty main composer and querySelector fallback finds non-empty edit textarea', () => {
        const { editTextarea, container, button, span, emptyTextarea } =
            makeEditScenarioWithEmptyAncestorTextarea('edit message');

        // Mount editTextarea FIRST so document.querySelector('textarea') finds it
        // before the empty main composer inside the container.
        cleanup = mountInDocument(editTextarea, container);

        // Ensure no textarea is focused — document.activeElement must NOT be a TEXTAREA.
        // (After cleanup, happy-dom resets focus to body; an explicit blur is a safety net.)
        if (document.activeElement instanceof HTMLElement && document.activeElement.tagName === 'TEXTAREA') {
            document.activeElement.blur();
        }

        dispatchPointerdown(span);

        // Non-empty edit textarea must receive injection via the querySelector fallback.
        expect(editTextarea.value).toContain('<user-input>');
        expect(editTextarea.value).toContain('edit message');
        // Empty main composer must remain completely untouched.
        expect(emptyTextarea.value).toBe('');
        expect(emptyTextarea.value).not.toContain('<user-input>');
    });
});
