/**
 * Unit tests for content/edit-message-cleanup.js
 *
 * Coverage groups:
 *   A. extractUserInput — pure regex extraction
 *   B. removeMaxHeightConstraints — DOM style mutations
 *   C. applyTextareaCleanup — conditional textarea rewrite
 *   D. findMessageContainer — ancestor traversal
 *   E. waitForTextareaInContainer — sync and async MutationObserver paths
 *   F. handleEditButtonClick — delegated click handler (integration of above)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Module loading
//
// edit-message-cleanup.js uses the `module.exports` guard pattern; we load it
// with createRequire so that Node.js CJS semantics apply in the ESM test
// environment, which is the same strategy used elsewhere in the project.
// ---------------------------------------------------------------------------
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const {
    extractUserInput,
    removeMaxHeightConstraints,
    applyTextareaCleanup,
    findMessageContainer,
    waitForTextareaInContainer,
    handleEditButtonClick,
    EDIT_BUTTON_CLASS,
    MAX_HEIGHT_SELECTORS,
    USER_INPUT_REGEX,
    DETECTION_TIMEOUT_MS,
} = require('../../content/edit-message-cleanup.js');

// ---------------------------------------------------------------------------
// Group A: extractUserInput
// ---------------------------------------------------------------------------

describe('A. extractUserInput', () => {
    it('A1: exports the correct constant values', () => {
        expect(EDIT_BUTTON_CLASS).toBe('d4910adc');
        expect(MAX_HEIGHT_SELECTORS).toEqual(['.cc852ac5', '._646a522']);
        expect(DETECTION_TIMEOUT_MS).toBe(2000);
        expect(USER_INPUT_REGEX).toBeInstanceOf(RegExp);
    });

    it('A2: extracts inner content from a real injected message shape', () => {
        const text =
            '<system-prompt>\nYou are helpful.\n</system-prompt>\n\n' +
            '<user-input>\n你好\n</user-input>';
        expect(extractUserInput(text)).toBe('你好');
    });

    it('A3: extracts multi-line inner content correctly', () => {
        const text =
            '<system-prompt>\nSys\n</system-prompt>\n\n' +
            '<user-input>\nLine 1\nLine 2\nLine 3\n</user-input>';
        expect(extractUserInput(text)).toBe('Line 1\nLine 2\nLine 3');
    });

    it('A4: returns null when no <user-input> wrapper is present (plain text)', () => {
        expect(extractUserInput('hello world')).toBeNull();
    });

    it('A5: returns null for an empty string', () => {
        expect(extractUserInput('')).toBeNull();
    });

    it('A6: returns null for null input', () => {
        expect(extractUserInput(null)).toBeNull();
    });

    it('A7: returns null for undefined input', () => {
        expect(extractUserInput(undefined)).toBeNull();
    });

    it('A8: returns null for a number input', () => {
        expect(extractUserInput(42)).toBeNull();
    });

    it('A9: returns null for an object input', () => {
        expect(extractUserInput({})).toBeNull();
    });

    it('A10: wrapper without system-prompt preamble is still matched', () => {
        const text = '<user-input>\nbare input\n</user-input>';
        expect(extractUserInput(text)).toBe('bare input');
    });

    it('A11: trailing content after </user-input> prevents a match (regex is end-anchored)', () => {
        // The regex ends with $ so any trailing character breaks the match.
        const text = '<user-input>\nhello\n</user-input> trailing';
        expect(extractUserInput(text)).toBeNull();
    });

    it('A12: trailing newline after </user-input> prevents a match', () => {
        // This verifies the strict $ anchor — no trailing newline allowed.
        const text = '<user-input>\nhello\n</user-input>\n';
        expect(extractUserInput(text)).toBeNull();
    });

    it('A13: whitespace-only inner content is returned as-is (not coerced)', () => {
        const text = '<user-input>\n   \n</user-input>';
        expect(extractUserInput(text)).toBe('   ');
    });

    it('A14: Korean inner content preserved exactly', () => {
        const text =
            'Current Time: 2026/06/07 18:10:26\n\n<user-input>\n중국은 왜?\n</user-input>';
        expect(extractUserInput(text)).toBe('중국은 왜?');
    });
});

// ---------------------------------------------------------------------------
// Group B: removeMaxHeightConstraints
// ---------------------------------------------------------------------------

describe('B. removeMaxHeightConstraints', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    it('B1: sets maxHeight=none on .cc852ac5 elements inside root', () => {
        const el = document.createElement('div');
        el.className = 'cc852ac5';
        container.appendChild(el);

        removeMaxHeightConstraints(container);

        expect(el.style.maxHeight).toBe('none');
    });

    it('B2: sets maxHeight=none on ._646a522 elements inside root', () => {
        const el = document.createElement('div');
        el.className = '_646a522';
        container.appendChild(el);

        removeMaxHeightConstraints(container);

        expect(el.style.maxHeight).toBe('none');
    });

    it('B3: sets maxHeight=none on multiple matching elements simultaneously', () => {
        const a = document.createElement('div');
        a.className = 'cc852ac5';
        const b = document.createElement('div');
        b.className = '_646a522';
        const c = document.createElement('div');
        c.className = 'cc852ac5';
        container.append(a, b, c);

        removeMaxHeightConstraints(container);

        expect(a.style.maxHeight).toBe('none');
        expect(b.style.maxHeight).toBe('none');
        expect(c.style.maxHeight).toBe('none');
    });

    it('B4: does NOT touch an unrelated element', () => {
        const el = document.createElement('div');
        el.className = 'some-other-class';
        el.style.maxHeight = '200px';
        container.appendChild(el);

        removeMaxHeightConstraints(container);

        expect(el.style.maxHeight).toBe('200px');
    });

    it('B5: root parameter scoping — does not affect elements outside root', () => {
        const inside = document.createElement('div');
        inside.className = 'cc852ac5';
        container.appendChild(inside);

        const outside = document.createElement('div');
        outside.className = 'cc852ac5';
        outside.style.maxHeight = '100px';
        document.body.appendChild(outside);

        // Only pass container (not document) as root
        removeMaxHeightConstraints(container);

        expect(inside.style.maxHeight).toBe('none');
        expect(outside.style.maxHeight).toBe('100px');

        document.body.removeChild(outside);
    });

    it('B6: falls back to document when root is null', () => {
        const el = document.createElement('div');
        el.className = 'cc852ac5';
        document.body.appendChild(el);

        // Should not throw; uses document as search root
        expect(() => removeMaxHeightConstraints(null)).not.toThrow();

        document.body.removeChild(el);
    });

    it('B7: falls back to document when called with no argument', () => {
        expect(() => removeMaxHeightConstraints()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Group C: applyTextareaCleanup
// ---------------------------------------------------------------------------

describe('C. applyTextareaCleanup', () => {
    function makeTextarea(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        return ta;
    }

    it('C1: replaces textarea value with only the inner content when wrapper present', () => {
        const wrapped =
            '<system-prompt>\nSys\n</system-prompt>\n\n' +
            '<user-input>\nmy message\n</user-input>';
        const ta = makeTextarea(wrapped);

        applyTextareaCleanup(ta);

        expect(ta.value).toBe('my message');
    });

    it('C2: dispatches an input event after rewriting value', () => {
        const wrapped = '<user-input>\nhello\n</user-input>';
        const ta = makeTextarea(wrapped);

        const listener = vi.fn();
        ta.addEventListener('input', listener);

        applyTextareaCleanup(ta);

        expect(listener).toHaveBeenCalledOnce();
    });

    it('C3: dispatches a change event after rewriting value', () => {
        const wrapped = '<user-input>\nhello\n</user-input>';
        const ta = makeTextarea(wrapped);

        const listener = vi.fn();
        ta.addEventListener('change', listener);

        applyTextareaCleanup(ta);

        expect(listener).toHaveBeenCalledOnce();
    });

    it('C4: does NOT modify value when no wrapper present (critical requirement)', () => {
        const original = 'plain text without wrapper';
        const ta = makeTextarea(original);

        applyTextareaCleanup(ta);

        expect(ta.value).toBe(original);
    });

    it('C5: does NOT dispatch input event when no wrapper present', () => {
        const ta = makeTextarea('plain text');
        const listener = vi.fn();
        ta.addEventListener('input', listener);

        applyTextareaCleanup(ta);

        expect(listener).not.toHaveBeenCalled();
    });

    it('C6: does NOT modify an already-clean value (empty textarea)', () => {
        const ta = makeTextarea('');
        applyTextareaCleanup(ta);
        expect(ta.value).toBe('');
    });

    it('C7: returns without error when passed a non-textarea element', () => {
        const div = document.createElement('div');
        expect(() => applyTextareaCleanup(div)).not.toThrow();
    });

    it('C8: returns without error when passed null', () => {
        expect(() => applyTextareaCleanup(null)).not.toThrow();
    });

    it('C9: multi-line inner content is preserved after cleanup', () => {
        const wrapped = '<user-input>\nLine 1\nLine 2\n</user-input>';
        const ta = makeTextarea(wrapped);

        applyTextareaCleanup(ta);

        expect(ta.value).toBe('Line 1\nLine 2');
    });
});

// ---------------------------------------------------------------------------
// Group D: findMessageContainer
// ---------------------------------------------------------------------------

describe('D. findMessageContainer', () => {
    afterEach(() => {
        // Clean up any nodes appended to body
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });

    it('D1: returns the direct parent when it contains a textarea', () => {
        const parent = document.createElement('div');
        const textarea = document.createElement('textarea');
        const btn = document.createElement('button');
        parent.appendChild(textarea);
        parent.appendChild(btn);
        document.body.appendChild(parent);

        expect(findMessageContainer(btn)).toBe(parent);
    });

    it('D2: returns a grandparent when textarea is nested higher up', () => {
        // Structure: grandparent > middle > button;  grandparent contains textarea
        const grandparent = document.createElement('div');
        const middle = document.createElement('div');
        const btn = document.createElement('button');
        const textarea = document.createElement('textarea');

        grandparent.appendChild(textarea);
        grandparent.appendChild(middle);
        middle.appendChild(btn);
        document.body.appendChild(grandparent);

        expect(findMessageContainer(btn)).toBe(grandparent);
    });

    it('D3: returns the closest ancestor that contains a textarea (not a higher one)', () => {
        // grandparent > outer-div > inner-div > button
        // inner-div contains textarea — should return inner-div
        const grandparent = document.createElement('div');
        const outerDiv = document.createElement('div');
        const innerDiv = document.createElement('div');
        const btn = document.createElement('button');
        const textarea = document.createElement('textarea');

        innerDiv.appendChild(textarea);
        innerDiv.appendChild(btn);
        outerDiv.appendChild(innerDiv);
        grandparent.appendChild(outerDiv);
        document.body.appendChild(grandparent);

        expect(findMessageContainer(btn)).toBe(innerDiv);
    });

    it('D4: returns null when no ancestor contains a textarea', () => {
        const parent = document.createElement('div');
        const btn = document.createElement('button');
        parent.appendChild(btn);
        document.body.appendChild(parent);

        expect(findMessageContainer(btn)).toBeNull();
    });

    it('D5: returns null when editButton is null', () => {
        expect(findMessageContainer(null)).toBeNull();
    });

    it('D6: returns null when editButton is undefined', () => {
        expect(findMessageContainer(undefined)).toBeNull();
    });

    it('D7: stops traversal at document.body and returns null', () => {
        // Button is direct child of body with no textarea anywhere in ancestors
        const btn = document.createElement('button');
        document.body.appendChild(btn);

        expect(findMessageContainer(btn)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Group E: waitForTextareaInContainer
// ---------------------------------------------------------------------------

describe('E. waitForTextareaInContainer', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
        vi.restoreAllMocks();
    });

    it('E1: calls onFound synchronously when textarea already exists in container', () => {
        const textarea = document.createElement('textarea');
        container.appendChild(textarea);

        const onFound = vi.fn();
        waitForTextareaInContainer(container, onFound);

        expect(onFound).toHaveBeenCalledOnce();
        expect(onFound).toHaveBeenCalledWith(textarea);
    });

    it('E2: does not call onFound when container is empty (no async yet)', () => {
        const onFound = vi.fn();
        waitForTextareaInContainer(container, onFound);

        // Synchronous check only — nothing appended yet
        expect(onFound).not.toHaveBeenCalled();
    });

    it('E3: calls onFound via MutationObserver when textarea is appended after the call', async () => {
        const onFound = vi.fn();
        waitForTextareaInContainer(container, onFound);

        // Append a textarea asynchronously
        const textarea = document.createElement('textarea');
        container.appendChild(textarea);

        // Allow MutationObserver microtasks to flush
        await new Promise(r => setTimeout(r, 0));

        expect(onFound).toHaveBeenCalledOnce();
        expect(onFound).toHaveBeenCalledWith(textarea);
    });

    it('E4: calls onFound with the first textarea found (not a later one)', async () => {
        const onFound = vi.fn();
        waitForTextareaInContainer(container, onFound);

        const first = document.createElement('textarea');
        container.appendChild(first);

        await new Promise(r => setTimeout(r, 0));

        // Second textarea added later should not trigger a second call
        const second = document.createElement('textarea');
        container.appendChild(second);
        await new Promise(r => setTimeout(r, 0));

        expect(onFound).toHaveBeenCalledOnce();
        expect(onFound).toHaveBeenCalledWith(first);
    });

    it('E5: does nothing when container is null', () => {
        expect(() => waitForTextareaInContainer(null, vi.fn())).not.toThrow();
    });

    it('E6: does nothing when onFound is not a function', () => {
        expect(() => waitForTextareaInContainer(container, null)).not.toThrow();
        expect(() => waitForTextareaInContainer(container, 'not-a-fn')).not.toThrow();
    });

    it('E7: observer auto-disconnects after DETECTION_TIMEOUT_MS without finding a textarea', async () => {
        vi.useFakeTimers();

        const onFound = vi.fn();
        waitForTextareaInContainer(container, onFound);

        // Advance past the 2000ms timeout
        vi.advanceTimersByTime(DETECTION_TIMEOUT_MS + 1);

        // Append a textarea AFTER the timeout — should be ignored
        const ta = document.createElement('textarea');
        container.appendChild(ta);

        await vi.runAllTimersAsync();

        expect(onFound).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('E8: deeply nested textarea (inside child div) is still found by the observer', async () => {
        const onFound = vi.fn();
        waitForTextareaInContainer(container, onFound);

        const nested = document.createElement('div');
        const ta = document.createElement('textarea');
        nested.appendChild(ta);
        container.appendChild(nested);

        await new Promise(r => setTimeout(r, 0));

        expect(onFound).toHaveBeenCalledOnce();
        expect(onFound).toHaveBeenCalledWith(ta);
    });
});

// ---------------------------------------------------------------------------
// Group F: handleEditButtonClick
// ---------------------------------------------------------------------------

describe('F. handleEditButtonClick', () => {
    let cleanup;

    afterEach(() => {
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
        vi.restoreAllMocks();
    });

    function buildEditButtonDom(textareaValue) {
        // Structure:
        //   container (.message-container)
        //     textarea[value=textareaValue]
        //     editButton (.d4910adc)
        //       inner span (click target)
        const container = document.createElement('div');
        container.className = 'message-container';

        const textarea = document.createElement('textarea');
        textarea.value = textareaValue;

        const editButton = document.createElement('div');
        editButton.className = EDIT_BUTTON_CLASS;

        const inner = document.createElement('span');
        editButton.appendChild(inner);

        container.appendChild(textarea);
        container.appendChild(editButton);
        document.body.appendChild(container);

        cleanup = () => document.body.removeChild(container);

        return { container, textarea, editButton, inner };
    }

    it('F1: no-op when click target is not inside .d4910adc', () => {
        const unrelated = document.createElement('div');
        document.body.appendChild(unrelated);

        const evt = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(evt, 'target', { value: unrelated, writable: false });

        // Should not throw and should not interact with anything
        expect(() => handleEditButtonClick(evt)).not.toThrow();

        document.body.removeChild(unrelated);
    });

    it('F2: removes max-height on matching elements when edit button is clicked', () => {
        const { inner } = buildEditButtonDom('plain text');

        // Add a constrained element inside the document
        const constrained = document.createElement('div');
        constrained.className = 'cc852ac5';
        constrained.style.maxHeight = '300px';
        document.body.appendChild(constrained);

        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'target', { value: inner, writable: false });
        handleEditButtonClick(evt);

        expect(constrained.style.maxHeight).toBe('none');

        document.body.removeChild(constrained);
    });

    it('F3: cleans up textarea when it contains wrapped content (sync path)', async () => {
        const wrapped =
            '<system-prompt>\nSys\n</system-prompt>\n\n' +
            '<user-input>\noriginal text\n</user-input>';
        const { inner, textarea } = buildEditButtonDom(wrapped);

        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'target', { value: inner, writable: false });
        handleEditButtonClick(evt);

        // waitForTextareaInContainer should detect existing textarea synchronously
        // and applyTextareaCleanup should run before next tick
        await new Promise(r => setTimeout(r, 0));

        expect(textarea.value).toBe('original text');
    });

    it('F4: does NOT modify textarea value when it contains plain text (no wrapper)', async () => {
        const { inner, textarea } = buildEditButtonDom('plain user text');

        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'target', { value: inner, writable: false });
        handleEditButtonClick(evt);

        await new Promise(r => setTimeout(r, 0));

        expect(textarea.value).toBe('plain user text');
    });

    it('F5: no-op when findMessageContainer returns null (no textarea ancestor)', () => {
        // Edit button with no textarea ancestor
        const editButton = document.createElement('div');
        editButton.className = EDIT_BUTTON_CLASS;
        const inner = document.createElement('span');
        editButton.appendChild(inner);
        document.body.appendChild(editButton);

        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'target', { value: inner, writable: false });

        expect(() => handleEditButtonClick(evt)).not.toThrow();

        document.body.removeChild(editButton);
    });
});
