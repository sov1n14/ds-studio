/**
 * DOM-adapter behavior tests for send interception with attachment-only
 * messages (empty textarea + non-disabled send button).
 *
 * Requirement (from directive, not from reading control flow):
 *   - Send button state (absence/presence of ds-button--disabled or
 *     aria-disabled="true") is DeepSeek own signal for "nothing sendable
 *     at all". When the button is enabled and the textarea is empty, the
 *     user is sending an attachment/image only -- injection must still occur.
 *   - When the button is disabled, an empty textarea means nothing is
 *     sendable -- no injection, and the native event must NOT be intercepted.
 *   - Existing non-empty-text behavior must be unaffected.
 *   - Enter-key path must honor the same signal, with a fail-safe (no
 *     send button locatable at all -> no injection, no interception).
 *
 * All assertions are on observable behavior only: resulting textarea value
 * and event.defaultPrevented. No internal call sequence is asserted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSendButton(opts) {
    opts = opts || {};
    var disabled = opts.disabled || false;
    var ariaDisabled = opts.ariaDisabled || false;

    var button = document.createElement('div');
    var className = 'ds-button ds-button--primary ds-button--filled ds-button--circle ' +
        'ds-button--m ds-button--icon-relative-m _52c986b';
    if (disabled) className += ' ds-button--disabled';
    button.className = className;
    button.setAttribute('role', 'button');
    if (ariaDisabled) button.setAttribute('aria-disabled', 'true');

    var iconWrapper = document.createElement('div');
    iconWrapper.className = 'ds-button__icon ds-button__icon--last-child';

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8.3125 0L16.625 8.3125L8.3125 16.625');
    svg.appendChild(path);
    iconWrapper.appendChild(svg);
    button.appendChild(iconWrapper);

    return { button: button, svg: svg };
}

function makeInputArea(textareaValue, buttonInfo) {
    var container = document.createElement('div');
    var textarea = document.createElement('textarea');
    textarea.value = textareaValue;
    container.appendChild(textarea);

    if (buttonInfo) {
        var actionsRow = document.createElement('div');
        actionsRow.className = 'bf38813a';
        actionsRow.appendChild(buttonInfo.button);
        container.appendChild(actionsRow);
    }

    return { container: container, textarea: textarea };
}

function mountInDocument() {
    var elements = Array.prototype.slice.call(arguments);
    elements.forEach(function (el) { document.body.appendChild(el); });
    return function cleanup() {
        elements.forEach(function (el) {
            if (el.parentNode) el.parentNode.removeChild(el);
        });
    };
}

function dispatchClick(target) {
    var ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}

function dispatchEnterKeydown(target, options) {
    var base = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
    };
    var merged = Object.assign(base, options || {});
    var ev = new KeyboardEvent('keydown', merged);
    target.dispatchEvent(ev);
    return ev;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Send interception: attachment-only (empty textarea) via click', function () {
    var cleanup;

    beforeEach(function () {
        contentScript.__resetState();
        contentScript.__setState({
            isEnabled: true,
            globalDefaultPrompt: 'sys',
            showSystemTime: true,
        });
    });

    afterEach(function () {
        if (cleanup) { cleanup(); cleanup = null; }
    });

    it('REQ-1 ENABLED + EMPTY: clicking an enabled send button with empty textarea injects prefix+timestamp and intercepts the click', function () {
        var buttonInfo = makeSendButton({ disabled: false });
        var area = makeInputArea('', buttonInfo);
        cleanup = mountInDocument(area.container);

        var ev = dispatchClick(buttonInfo.svg);

        expect(area.textarea.value).toMatch(/^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n\n<system-reminder>\nsys\n<\/system-reminder>$/);
        expect(area.textarea.value).not.toContain('<user-input>');
        expect(ev.defaultPrevented).toBe(true);
    });

    it('REQ-2 DISABLED + EMPTY: clicking a ds-button--disabled send button with empty textarea injects nothing and does not intercept', function () {
        var buttonInfo = makeSendButton({ disabled: true });
        var area = makeInputArea('', buttonInfo);
        cleanup = mountInDocument(area.container);

        var ev = dispatchClick(buttonInfo.svg);

        expect(area.textarea.value).toBe('');
        expect(ev.defaultPrevented).toBe(false);
    });

    it('REQ-3 NON-EMPTY TEXT: clicking the send button with existing text still wraps user-input and intercepts (preserved behavior)', function () {
        var buttonInfo = makeSendButton({ disabled: false });
        var area = makeInputArea('hello world', buttonInfo);
        cleanup = mountInDocument(area.container);

        var ev = dispatchClick(buttonInfo.svg);

        expect(area.textarea.value).toContain('<user-input>\nhello world\n</user-input>');
        expect(ev.defaultPrevented).toBe(true);
    });

    it('REQ-7a ARIA-DISABLED: aria-disabled true with no ds-button--disabled class is treated the same as disabled -- no injection, no interception', function () {
        var buttonInfo = makeSendButton({ disabled: false, ariaDisabled: true });
        var area = makeInputArea('', buttonInfo);
        cleanup = mountInDocument(area.container);

        var ev = dispatchClick(buttonInfo.svg);

        expect(area.textarea.value).toBe('');
        expect(ev.defaultPrevented).toBe(false);
    });
});

describe('Send interception: attachment-only (empty textarea) via Enter keydown', function () {
    var cleanup;

    beforeEach(function () {
        contentScript.__resetState();
        contentScript.__setState({
            isEnabled: true,
            globalDefaultPrompt: 'sys',
            showSystemTime: false,
        });
    });

    afterEach(function () {
        if (cleanup) { cleanup(); cleanup = null; }
    });

    it('REQ-4 ENABLED + EMPTY: Enter on an empty textarea whose input area has an enabled send button injects the prefix and intercepts the keydown', function () {
        var buttonInfo = makeSendButton({ disabled: false });
        var area = makeInputArea('', buttonInfo);
        cleanup = mountInDocument(area.container);
        area.textarea.focus();

        var ev = dispatchEnterKeydown(area.textarea);

        expect(area.textarea.value).toBe('<system-reminder>\nsys\n</system-reminder>');
        expect(ev.defaultPrevented).toBe(true);
    });

    it('REQ-5 DISABLED + EMPTY: Enter on an empty textarea whose send button is ds-button--disabled injects nothing and does not intercept', function () {
        var buttonInfo = makeSendButton({ disabled: true });
        var area = makeInputArea('', buttonInfo);
        cleanup = mountInDocument(area.container);
        area.textarea.focus();

        var ev = dispatchEnterKeydown(area.textarea);

        expect(area.textarea.value).toBe('');
        expect(ev.defaultPrevented).toBe(false);
    });

    it('REQ-6 FAIL-SAFE: Enter on an empty textarea whose input area has no send button at all injects nothing and does not intercept', function () {
        var area = makeInputArea('', null);
        cleanup = mountInDocument(area.container);
        area.textarea.focus();

        var ev = dispatchEnterKeydown(area.textarea);

        expect(area.textarea.value).toBe('');
        expect(ev.defaultPrevented).toBe(false);
    });

    it('REQ-7b ARIA-DISABLED: aria-disabled true send button on Enter path is treated the same as disabled -- no injection, no interception', function () {
        var buttonInfo = makeSendButton({ disabled: false, ariaDisabled: true });
        var area = makeInputArea('', buttonInfo);
        cleanup = mountInDocument(area.container);
        area.textarea.focus();

        var ev = dispatchEnterKeydown(area.textarea);

        expect(area.textarea.value).toBe('');
        expect(ev.defaultPrevented).toBe(false);
    });
});
