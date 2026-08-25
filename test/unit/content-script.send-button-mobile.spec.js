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
import {
    makeDesktopSendButton,
    makeMobileSendButton,
    makeOtherButton,
    makeEditSendButtonInContainer,
    makeEditCancelButtonInContainer,
    makeEditScenarioWithEmptyAncestorTextarea,
    makeEditSendButtonStandalone,
    mountInDocument,
    dispatchPointerdown,
} from '../helpers/send-button-fixtures.js';

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
