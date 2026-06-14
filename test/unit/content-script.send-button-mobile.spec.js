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
function makeEditSendButtonInContainer(value = 'edit text') {
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
    span.textContent = '发送';

    button.appendChild(bg);
    button.appendChild(span);
    container.appendChild(textarea);
    container.appendChild(button);

    return { container, button, span, textarea };
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
    // TC-4: Edit-message send button — must trigger injection on the edit textarea
    // -----------------------------------------------------------------------
    it('TC-4 EDIT-SEND: clicking ds-button with span.ds-button__content "发送" triggers injection on container textarea', () => {
        const { container, button, span } = makeEditSendButtonInContainer('edit message');
        cleanup = mountInDocument(container);

        dispatchPointerdown(span);

        const textarea = container.querySelector('textarea');
        expect(textarea.value).toContain('<user-input>');
        expect(textarea.value).toContain('edit message');
    });

    // -----------------------------------------------------------------------
    // TC-5: Button with non-"发送" content — must NOT trigger injection
    // -----------------------------------------------------------------------
    it('TC-5 NEGATIVE EDIT: ds-button with span.ds-button__content "取消" does NOT inject', () => {
        const { container, button, span, textarea } = makeEditSendButtonInContainer('edit message');
        span.textContent = '取消'; // Change to cancel button text
        cleanup = mountInDocument(container);

        const originalValue = textarea.value;
        dispatchPointerdown(span);

        expect(textarea.value).toBe(originalValue);
        expect(textarea.value).not.toContain('<user-input>');
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
});
