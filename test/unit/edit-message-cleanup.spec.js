/**
 * Unit tests for content/edit-message-cleanup.js
 *
 * Coverage groups:
 *   A. extractUserInput — pure regex extraction + constant exports
 *   B. computeDynamicMaxHeight — pure arithmetic formula
 *   C. applyMaxHeightAdjustments — DOM max-height mutations
 *   D. applyTextareaCleanup — conditional textarea rewrite (returns boolean)
 *   E. waitForNewTextarea — MutationObserver-based new-textarea detection
 *   F. handleEditButtonClick — delegated click handler (regression + integration)
 *   G. scroll-into-position — EDIT_SCROLL_GAP_PX, computeScrollDelta, applyEditScrollPosition
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Module loading
//
// edit-message-cleanup.js uses the `module.exports` guard pattern; we load it
// with createRequire so that Node.js CJS semantics apply in the ESM test
// environment, which is the same strategy used elsewhere in the project.
// ---------------------------------------------------------------------------
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const DSSelectors = require('../../content/ds-selectors.js');

const {
    extractUserInput,
    computeDynamicMaxHeight,
    applyMaxHeightAdjustments,
    applyTextareaCleanup,
    waitForNewTextarea,
    handleEditButtonClick,
    applyEditScrollPosition,
    computeScrollDelta,
    EDIT_BUTTON_SELECTOR,
    REMOVE_MAX_HEIGHT_SELECTOR,
    DYNAMIC_MAX_HEIGHT_SELECTOR,
    HEIGHT_SOURCE_SELECTOR_A,
    HEIGHT_SOURCE_SELECTOR_B,
    MAX_HEIGHT_OFFSET_PX,
    EDIT_SCROLL_GAP_PX,
    USER_INPUT_REGEX,
    DETECTION_TIMEOUT_MS,
    VALUE_WAIT_TIMEOUT_MS,
} = require('../../content/edit-message-cleanup.js');

// ---------------------------------------------------------------------------
// Real-markup fixtures (test/fixtures/ds-snapshots/)
//
// Both files hold the chat pane (header, message list, composer column) copied from live DeepSeek snapshots, with title and message text replaced by placeholders:
//   conv2-finished-chat-pane.html — idle conversation: a user message with its toolbar (copy and edit buttons) and an assistant message with its six-button toolbar.
//   edit-window-chat-pane.html    — the same pane while the user message is being edited: the user item holds the edit box (textarea[name="user query"]); the assistant message body is reduced to one placeholder paragraph.
// Tests locate elements by page structure (parent of .the-header, ancestors of the edit textarea, toolbar button order), never through the selectors under test, so a selector that drifts from the real markup fails the assertions instead of agreeing with them.
// ---------------------------------------------------------------------------
const SNAPSHOT_DIR = path.resolve(__dirname, '../fixtures/ds-snapshots');
const CONV_PANE_HTML = fs.readFileSync(path.join(SNAPSHOT_DIR, 'conv2-finished-chat-pane.html'), 'utf8');
const EDIT_PANE_HTML = fs.readFileSync(path.join(SNAPSHOT_DIR, 'edit-window-chat-pane.html'), 'utf8');

/** Mount a chat-pane fixture as the page body and return its landmark elements. */
function mountPane(html) {
    document.body.innerHTML = html;
    const listRoot = document.querySelector('.ds-virtual-list');
    const mainTextarea = document.querySelector('textarea[name="search"]');
    const editTextarea = document.querySelector('textarea[name="user query"]');
    return {
        header: document.querySelector('.the-header').parentElement,
        listRoot,
        list: listRoot.querySelector('.ds-virtual-list-items'),
        column: Array.from(listRoot.children).find((child) => child.contains(mainTextarea)),
        mainTextarea,
        editTextarea,
        editBox: editTextarea ? editTextarea.closest('.ds-textarea') : null,
        heightContainer: editTextarea ? editTextarea.parentElement : null,
        userItem: document.querySelector('[data-virtual-list-item-key="-2"]'),
        assistantItem: document.querySelector('[data-virtual-list-item-key="2"]'),
    };
}

/** Give a real element a fixed measured height. */
function setMeasuredHeight(el, height) {
    el.getBoundingClientRect = () => ({ height });
}

// ---------------------------------------------------------------------------
// Group A: extractUserInput + constant exports
// ---------------------------------------------------------------------------

describe('A. extractUserInput', () => {
    // Only constants with no independent behavior coverage are asserted here.
    // REMOVE_MAX_HEIGHT_SELECTOR / DYNAMIC_MAX_HEIGHT_SELECTOR / HEIGHT_SOURCE_SELECTOR_A/B / MAX_HEIGHT_OFFSET_PX are exercised against real snapshot markup by Group C/F (e.g. C1, C8); USER_INPUT_REGEX's matching behavior is exercised by A2-A14 — a value change there already fails those tests, so re-asserting the literal here would be a redundant mirror.
    it('A1: exports the correct constant values (constants with no other tripwire)', () => {
        expect(EDIT_BUTTON_SELECTOR).toBe(DSSelectors.EDIT_MESSAGE_BUTTON_SELECTOR);
        expect(DETECTION_TIMEOUT_MS).toBe(2000);
        expect(VALUE_WAIT_TIMEOUT_MS).toBe(800);
    });

    it.each([
        [
            'A2: extracts inner content from a real injected message shape',
            '<system-reminder>\nYou are helpful.\n</system-reminder>\n\n<user-input>\n你好\n</user-input>',
            '你好',
        ],
        [
            'A3: extracts multi-line inner content correctly',
            '<system-reminder>\nSys\n</system-reminder>\n\n<user-input>\nLine 1\nLine 2\nLine 3\n</user-input>',
            'Line 1\nLine 2\nLine 3',
        ],
    ])('%s', (_title, text, expected) => {
        expect(extractUserInput(text)).toBe(expected);
    });

    it.each([
        ['A4: returns null when no <user-input> wrapper is present (plain text)', 'hello world'],
        ['A5: returns null for an empty string', ''],
        ['A6: returns null for null input', null],
        ['A7: returns null for undefined input', undefined],
        ['A8: returns null for a number input', 42],
        ['A9: returns null for an object input', {}],
    ])('%s', (_title, input) => {
        expect(extractUserInput(input)).toBeNull();
    });

    it('A10: wrapper without system-reminder preamble is still matched', () => {
        const text = '<user-input>\nbare input\n</user-input>';
        expect(extractUserInput(text)).toBe('bare input');
    });

    it.each([
        [
            'A11: trailing content after </user-input> prevents a match (regex is end-anchored)',
            '<user-input>\nhello\n</user-input> trailing',
        ],
        [
            'A12: trailing newline after </user-input> prevents a match',
            '<user-input>\nhello\n</user-input>\n',
        ],
    ])('%s', (_title, text) => {
        expect(extractUserInput(text)).toBeNull();
    });

    it.each([
        [
            'A13: whitespace-only inner content is returned as-is (not coerced)',
            '<user-input>\n   \n</user-input>',
            '   ',
        ],
        [
            'A14: Korean inner content preserved exactly',
            'Current Time: 2026/06/07 18:10:26\n\n<user-input>\n중국은 왜?\n</user-input>',
            '중국은 왜?',
        ],
    ])('%s', (_title, text, expected) => {
        expect(extractUserInput(text)).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// Group B: computeDynamicMaxHeight — pure arithmetic
// ---------------------------------------------------------------------------

describe('B. computeDynamicMaxHeight', () => {
    // B1 (MAX_HEIGHT_OFFSET_PX mirror) removed: the constant's value is already the
    // sole determinant of every expected result below (e.g. B2's 668 bakes in "-32"),
    // so a wrong/changed offset already fails B2-B9 — a standalone mirror was redundant.
    it.each([
        ['B2: typical case — 1000 window, 100 sourceA, 200 sourceB → 668', 1000, 100, 200, 668],
        ['B3: zero source heights — result is windowHeight minus offset', 800, 0, 0, 768],
        ['B4: all zeros — result is negative offset', 0, 0, 0, -32],
        // Source heights larger than window — function returns raw arithmetic, no clamp
        ['B5: large source heights can produce a negative result (no clamping)', 500, 400, 200, -132],
        ['B6: formula is windowHeight - sourceHeightA - sourceHeightB - 32', 1080, 56, 72, 1080 - 56 - 72 - 32],
        ['B7: fractional pixel heights produce fractional result (no rounding)', 900, 50.5, 49.5, 768],
        ['B8: sourceHeightA only contributes correctly when sourceHeightB is zero', 600, 80, 0, 488],
        ['B9: sourceHeightB only contributes correctly when sourceHeightA is zero', 600, 0, 80, 488],
    ])('%s', (_title, windowHeight, sourceA, sourceB, expected) => {
        expect(computeDynamicMaxHeight(windowHeight, sourceA, sourceB)).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// Group C: applyMaxHeightAdjustments — DOM style mutations on real edit-window markup
// ---------------------------------------------------------------------------

describe('C. applyMaxHeightAdjustments', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    // ---- edit box always cleared ----

    it('C1: sets maxHeight=none on every edit box under root', () => {
        const pane = mountPane(EDIT_PANE_HTML);
        pane.editBox.style.maxHeight = '300px';
        const second = pane.editBox.cloneNode(true);
        second.style.maxHeight = '150px';
        pane.editBox.after(second);

        applyMaxHeightAdjustments(document);

        expect(pane.editBox.style.maxHeight).toBe('none');
        expect(second.style.maxHeight).toBe('none');
    });

    it('C2: edit box is cleared EVEN when the header and content column are absent', () => {
        const pane = mountPane(EDIT_PANE_HTML);
        pane.header.remove();
        pane.column.remove();
        pane.editBox.style.maxHeight = '200px';

        applyMaxHeightAdjustments(document);

        expect(pane.editBox.style.maxHeight).toBe('none');
    });

    it('C3: does NOT touch the main composer scroll area (real neighbouring element)', () => {
        const pane = mountPane(EDIT_PANE_HTML);
        const composerScrollArea = pane.mainTextarea.parentElement;
        composerScrollArea.style.maxHeight = '200px';

        applyMaxHeightAdjustments(document);

        expect(composerScrollArea.style.maxHeight).toBe('200px');
    });

    // ---- height container skipped when a source is missing ----

    it('C4: height container left untouched when the chat header is missing', () => {
        const pane = mountPane(EDIT_PANE_HTML);
        setMeasuredHeight(pane.column, 50);
        pane.header.remove();
        pane.heightContainer.style.maxHeight = '400px';

        applyMaxHeightAdjustments(document);

        expect(pane.heightContainer.style.maxHeight).toBe('400px');
    });

    it('C5: height container left untouched when the content column is missing', () => {
        const pane = mountPane(EDIT_PANE_HTML);
        setMeasuredHeight(pane.header, 50);
        pane.column.remove();
        pane.heightContainer.style.maxHeight = '400px';

        applyMaxHeightAdjustments(document);

        expect(pane.heightContainer.style.maxHeight).toBe('400px');
    });

    it('C6: height container left untouched when BOTH sources are missing', () => {
        const pane = mountPane(EDIT_PANE_HTML);
        pane.header.remove();
        pane.column.remove();
        pane.heightContainer.style.maxHeight = '400px';

        applyMaxHeightAdjustments(document);

        expect(pane.heightContainer.style.maxHeight).toBe('400px');
    });

    it('C7: edit box is still cleared when the height container is left untouched (missing sources)', () => {
        const pane = mountPane(EDIT_PANE_HTML);
        pane.header.remove();
        pane.column.remove();
        pane.editBox.style.maxHeight = '300px';
        pane.heightContainer.style.maxHeight = '400px';

        applyMaxHeightAdjustments(document);

        expect(pane.editBox.style.maxHeight).toBe('none');
        expect(pane.heightContainer.style.maxHeight).toBe('400px');
    });

    // ---- height container set when both sources are present ----

    it('C8: sets the computed maxHeight on the height container when header and content column are present', () => {
        const winHeight = 900;
        const aHeight = 60;
        const bHeight = 40;
        const expected = winHeight - aHeight - bHeight - 32; // 768

        Object.defineProperty(window, 'innerHeight', { value: winHeight, configurable: true });
        const pane = mountPane(EDIT_PANE_HTML);
        setMeasuredHeight(pane.header, aHeight);
        setMeasuredHeight(pane.column, bHeight);

        applyMaxHeightAdjustments(document);

        expect(pane.heightContainer.style.maxHeight).toBe(expected + 'px');
    });

    it('C9: sets the same computed value on ALL height containers under root', () => {
        const winHeight = 800;
        const aHeight = 50;
        const bHeight = 50;
        const expected = winHeight - aHeight - bHeight - 32; // 668

        Object.defineProperty(window, 'innerHeight', { value: winHeight, configurable: true });
        const pane = mountPane(EDIT_PANE_HTML);
        setMeasuredHeight(pane.header, aHeight);
        setMeasuredHeight(pane.column, bHeight);
        pane.editBox.after(pane.editBox.cloneNode(true), pane.editBox.cloneNode(true));
        const containers = Array.from(document.querySelectorAll('textarea[name="user query"]'), (ta) => ta.parentElement);
        expect(containers).toHaveLength(3);

        applyMaxHeightAdjustments(document);

        containers.forEach((el) => expect(el.style.maxHeight).toBe(expected + 'px'));
    });

    // ---- root scoping ----

    it('C10: root parameter scoping — does not affect an edit box outside root', () => {
        const pane = mountPane(EDIT_PANE_HTML);
        const outside = pane.editBox.cloneNode(true);
        outside.style.maxHeight = '100px';
        document.body.appendChild(outside);

        applyMaxHeightAdjustments(pane.userItem);

        expect(pane.editBox.style.maxHeight).toBe('none');
        expect(outside.style.maxHeight).toBe('100px');
    });

    it('C11: root parameter scoping — does not affect a height container outside root', () => {
        const winHeight = 700;
        Object.defineProperty(window, 'innerHeight', { value: winHeight, configurable: true });
        const pane = mountPane(EDIT_PANE_HTML);
        setMeasuredHeight(pane.header, 30);
        setMeasuredHeight(pane.column, 20);
        const outsideBox = pane.editBox.cloneNode(true);
        document.body.appendChild(outsideBox);
        const outside = outsideBox.querySelector('textarea[name="user query"]').parentElement;
        outside.style.maxHeight = '999px';

        applyMaxHeightAdjustments(pane.userItem);

        const expected = winHeight - 30 - 20 - 32;
        expect(pane.heightContainer.style.maxHeight).toBe(expected + 'px');
        expect(outside.style.maxHeight).toBe('999px');
    });

    // ---- fallback when root is null / omitted ----

    it.each([
        ['C12: falls back to document when root is null (no throw)', [null]],
        ['C13: falls back to document when called with no argument (no throw)', []],
    ])('%s', (_title, args) => {
        expect(() => applyMaxHeightAdjustments(...args)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Group D: applyTextareaCleanup
// ---------------------------------------------------------------------------

describe('D. applyTextareaCleanup', () => {
    function makeTextarea(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        return ta;
    }

    it('D1: replaces textarea value with only the inner content when wrapper present', () => {
        const wrapped =
            '<system-reminder>\nSys\n</system-reminder>\n\n' +
            '<user-input>\nmy message\n</user-input>';
        const ta = makeTextarea(wrapped);

        applyTextareaCleanup(ta);

        expect(ta.value).toBe('my message');
    });

    it('D1b: returns true when wrapper is present and rewrite succeeds', () => {
        const wrapped = '<user-input>\nhello\n</user-input>';
        const ta = makeTextarea(wrapped);
        expect(applyTextareaCleanup(ta)).toBe(true);
    });

    it.each([
        ['D2: dispatches an input event after rewriting value', 'input'],
        ['D3: dispatches a change event after rewriting value', 'change'],
    ])('%s', (_title, eventName) => {
        const wrapped = '<user-input>\nhello\n</user-input>';
        const ta = makeTextarea(wrapped);

        const listener = vi.fn();
        ta.addEventListener(eventName, listener);

        applyTextareaCleanup(ta);

        expect(listener).toHaveBeenCalledOnce();
    });

    it('D4: does NOT modify value when no wrapper present (critical requirement)', () => {
        const original = 'plain text without wrapper';
        const ta = makeTextarea(original);

        applyTextareaCleanup(ta);

        expect(ta.value).toBe(original);
    });

    it('D4b: returns false when no wrapper is present', () => {
        const ta = makeTextarea('plain text without wrapper');
        expect(applyTextareaCleanup(ta)).toBe(false);
    });

    it('D5: does NOT dispatch input event when no wrapper present', () => {
        const ta = makeTextarea('plain text');
        const listener = vi.fn();
        ta.addEventListener('input', listener);

        applyTextareaCleanup(ta);

        expect(listener).not.toHaveBeenCalled();
    });

    it('D6: does NOT modify an already-clean value (empty textarea)', () => {
        const ta = makeTextarea('');
        applyTextareaCleanup(ta);
        expect(ta.value).toBe('');
    });

    it('D6b: returns false for empty textarea (no wrapper)', () => {
        const ta = makeTextarea('');
        expect(applyTextareaCleanup(ta)).toBe(false);
    });

    it.each([
        ['D7: returns false without error when passed a non-textarea element', () => document.createElement('div')],
        ['D8: returns false without error when passed null', () => null],
    ])('%s', (_title, makeArg) => {
        expect(applyTextareaCleanup(makeArg())).toBe(false);
    });

    it('D9: multi-line inner content is preserved after cleanup', () => {
        const wrapped = '<user-input>\nLine 1\nLine 2\n</user-input>';
        const ta = makeTextarea(wrapped);

        applyTextareaCleanup(ta);

        expect(ta.value).toBe('Line 1\nLine 2');
    });
});

// ---------------------------------------------------------------------------
// Group E: waitForNewTextarea
// ---------------------------------------------------------------------------

describe('E. waitForNewTextarea', () => {
    afterEach(() => {
        // Remove all body children after each test to ensure DOM isolation
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        vi.restoreAllMocks();
    });

    it('E1: does not call onFound for a textarea already in preExisting set', async () => {
        // A pre-existing textarea is in the snapshot — it must be ignored
        const preExisting = document.createElement('textarea');
        document.body.appendChild(preExisting);

        const snapshot = new Set(document.querySelectorAll('textarea'));
        const onFound = vi.fn();

        waitForNewTextarea(snapshot, onFound);

        // MutationObserver fires asynchronously; allow microtasks + timer queue
        await new Promise(r => setTimeout(r, 0));

        expect(onFound).not.toHaveBeenCalled();
    });

    it('E2: calls onFound with a newly appended textarea not in preExisting', async () => {
        // Snapshot taken before the new textarea exists
        const snapshot = new Set(document.querySelectorAll('textarea'));
        const onFound = vi.fn();

        waitForNewTextarea(snapshot, onFound);

        // Simulate DeepSeek asynchronously mounting the edit textarea
        const newTextarea = document.createElement('textarea');
        newTextarea.value = '<user-input>\nhello\n</user-input>';
        document.body.appendChild(newTextarea);

        await new Promise(r => setTimeout(r, 0));

        expect(onFound).toHaveBeenCalledOnce();
        expect(onFound).toHaveBeenCalledWith(newTextarea);
    });

    it('E3: fires at most once — second new textarea does not trigger onFound again', async () => {
        const snapshot = new Set(document.querySelectorAll('textarea'));
        const onFound = vi.fn();

        waitForNewTextarea(snapshot, onFound);

        const first = document.createElement('textarea');
        first.value = '<user-input>\nfirst\n</user-input>';
        document.body.appendChild(first);

        await new Promise(r => setTimeout(r, 0));

        // Observer should have disconnected after first find
        const second = document.createElement('textarea');
        second.value = '<user-input>\nsecond\n</user-input>';
        document.body.appendChild(second);

        await new Promise(r => setTimeout(r, 0));

        expect(onFound).toHaveBeenCalledOnce();
        expect(onFound).toHaveBeenCalledWith(first);
    });

    it('E4: timeout — no new textarea within DETECTION_TIMEOUT_MS, onFound never called', async () => {
        vi.useFakeTimers();

        const snapshot = new Set(document.querySelectorAll('textarea'));
        const onFound = vi.fn();

        waitForNewTextarea(snapshot, onFound);

        // Advance past the 2000 ms hard timeout
        vi.advanceTimersByTime(DETECTION_TIMEOUT_MS + 1);
        await vi.runAllTimersAsync();

        // Append a textarea AFTER timeout — must be ignored because observer disconnected
        const late = document.createElement('textarea');
        late.value = 'too late';
        document.body.appendChild(late);

        await vi.runAllTimersAsync();

        expect(onFound).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('E5: does nothing when preExisting is not a Set', () => {
        expect(() => waitForNewTextarea(null, vi.fn())).not.toThrow();
        expect(() => waitForNewTextarea([], vi.fn())).not.toThrow();
    });

    it('E6: does nothing when onFound is not a function', () => {
        const snapshot = new Set();
        expect(() => waitForNewTextarea(snapshot, null)).not.toThrow();
        expect(() => waitForNewTextarea(snapshot, 'not-a-fn')).not.toThrow();
    });

    it('E7: handles immediate pre-check — textarea present before observer fires', () => {
        // The source does a synchronous findNewTextarea() check immediately after
        // setting up the observer. If a new textarea was already in the DOM at call
        // time (but NOT in preExisting), onFound should fire synchronously.
        const snapshot = new Set(); // empty snapshot — all textareas are "new"

        const existing = document.createElement('textarea');
        existing.value = '<user-input>\nimmediate\n</user-input>';
        document.body.appendChild(existing);

        const onFound = vi.fn();
        waitForNewTextarea(snapshot, onFound);

        // Synchronous pre-check should have fired onFound already
        expect(onFound).toHaveBeenCalledOnce();
        expect(onFound).toHaveBeenCalledWith(existing);
    });

    // E8: late value population path.
    //
    // happy-dom does NOT fire MutationObserver callbacks for programmatic
    // property assignments (textarea.value = '...') because those do not
    // mutate the DOM tree structure or characterData in a way that triggers
    // the observer. The secondary value-wait observer inside waitForNewTextarea
    // therefore cannot be exercised end-to-end in this environment.
    //
    // What we CAN verify: when a new textarea is found with a non-empty value,
    // onFound is called immediately (fast path). The slow/secondary path's
    // timeout fallback is also covered by the VALUE_WAIT_TIMEOUT_MS constant
    // export assertion in Group A (A1).
    it('E8: new textarea found with non-empty value calls onFound immediately (fast path)', async () => {
        const snapshot = new Set(document.querySelectorAll('textarea'));
        const onFound = vi.fn();

        waitForNewTextarea(snapshot, onFound);

        const ta = document.createElement('textarea');
        ta.value = 'already filled';
        document.body.appendChild(ta);

        await new Promise(r => setTimeout(r, 0));

        expect(onFound).toHaveBeenCalledOnce();
        expect(onFound).toHaveBeenCalledWith(ta);
    });
});

// ---------------------------------------------------------------------------
// Group F: handleEditButtonClick — on the real idle-conversation pane
// ---------------------------------------------------------------------------

describe('F. handleEditButtonClick', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    // Helper: fire a synthetic click event targeting a specific element
    function fireClick(target) {
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'target', { value: target, writable: false });
        handleEditButtonClick(evt);
        return evt;
    }

    /** Mount the idle conversation pane; the user toolbar holds two buttons, copy then edit (live snapshot order). */
    function mountConversation() {
        const pane = mountPane(CONV_PANE_HTML);
        const userButtons = pane.userItem.querySelectorAll('[role="button"]');
        expect(userButtons).toHaveLength(2);
        const [copyButton, editButton] = userButtons;
        return { ...pane, copyButton, editButton, editIcon: editButton.querySelector('svg') };
    }

    /**
     * Simulate DeepSeek entering edit mode: the user item is replaced by the edit-window snapshot's user item, which holds the edit box and a textarea that did not exist at click time.
     * Values are applied before insertion, as React renders them.
     */
    function renderEditBox({ value, editBoxMaxHeight, heightContainerMaxHeight } = {}) {
        const holder = document.createElement('div');
        holder.innerHTML = EDIT_PANE_HTML;
        const editTextarea = holder.querySelector('textarea[name="user query"]');
        const editBox = editTextarea.closest('.ds-textarea');
        const heightContainer = editTextarea.parentElement;
        if (value !== undefined) editTextarea.value = value;
        if (editBoxMaxHeight !== undefined) editBox.style.maxHeight = editBoxMaxHeight;
        if (heightContainerMaxHeight !== undefined) heightContainer.style.maxHeight = heightContainerMaxHeight;
        document.querySelector('[data-virtual-list-item-key="-2"]').replaceWith(editTextarea.closest('[data-virtual-list-item-key]'));
        return { editTextarea, editBox, heightContainer };
    }

    const WRAPPED_VALUE =
        '<system-reminder>\nSys\n</system-reminder>\n\n' +
        '<user-input>\noriginal user text\n</user-input>';

    it('F1: no-op when click target is not inside an edit button', () => {
        const unrelated = document.createElement('div');
        document.body.appendChild(unrelated);

        expect(() => fireClick(unrelated)).not.toThrow();
    });

    // -------------------------------------------------------------------------
    // F2: REGRESSION TEST — the original bug
    //
    // Before the fix, handleEditButtonClick used waitForTextareaInContainer which traversed ancestors to find a container, then grabbed the first textarea inside it. When DeepSeek rendered the edit UI, the pre-existing main composer textarea was sometimes found instead of the new edit textarea that already contained the wrapped content. This caused applyTextareaCleanup to run on the wrong element.
    //
    // The fix uses waitForNewTextarea with a pre-click snapshot, ensuring only a textarea that did NOT exist at click-time is passed to the cleanup.
    // -------------------------------------------------------------------------
    it('F2: regression — pre-existing main composer is ignored; NEW edit textarea is cleaned up', async () => {
        const page = mountConversation();
        // The composer exists before the click and holds wrapped text, so cleaning the wrong textarea is visible
        page.mainTextarea.value = WRAPPED_VALUE;

        // Click the icon inside the real edit button — snapshot is taken here; the composer is in it
        fireClick(page.editIcon);

        // DeepSeek asynchronously mounts the edit textarea pre-filled with wrapped content
        const { editTextarea } = renderEditBox({ value: WRAPPED_VALUE });

        // Allow MutationObserver callbacks to fire
        await new Promise(r => setTimeout(r, 0));

        expect(editTextarea.value).toBe('original user text');
        expect(page.mainTextarea.value).toBe(WRAPPED_VALUE);
    });

    // F3: the user toolbar's copy button and the assistant toolbar buttons share the edit button's classes (ds-button--icon inside a ds-flex row), so each must be rejected. The copy button differs from the edit button only by lacking aria-disabled; the assistant's second button carries aria-disabled like the edit button and differs only by sitting outside a user message item.
    it.each([
        ['F3a: user message copy button', (page) => page.copyButton],
        ['F3b: assistant toolbar first button', (page) => page.assistantItem.querySelectorAll('[role="button"]')[0]],
        ['F3c: assistant toolbar second button (carries aria-disabled)', (page) => page.assistantItem.querySelectorAll('[role="button"]')[1]],
    ])('%s click is a no-op — a later edit textarea is not cleaned', async (_title, pickButton) => {
        const page = mountConversation();
        const button = pickButton(page);
        expect(button).toBeTruthy();

        fireClick(button.querySelector('svg'));

        const { editTextarea } = renderEditBox({ value: WRAPPED_VALUE });
        await new Promise(r => setTimeout(r, 0));

        expect(editTextarea.value).toBe(WRAPPED_VALUE);
    });

    it('F4: max-height adjustment clears the edit box at detection time (sources absent — height container skipped)', async () => {
        const page = mountConversation();
        page.header.remove();
        page.column.remove();

        fireClick(page.editIcon);

        const { editBox, heightContainer } = renderEditBox({
            value: 'plain text',
            editBoxMaxHeight: '300px',
            heightContainerMaxHeight: '150px',
        });

        await new Promise(r => setTimeout(r, 0));

        expect(editBox.style.maxHeight).toBe('none');
        expect(heightContainer.style.maxHeight).toBe('150px');
    });

    it('F5: max-height adjustment sets the height container computed value when header and content column are present', async () => {
        const winHeight = 900;
        const aHeight = 60;
        const bHeight = 40;
        const expectedPx = (winHeight - aHeight - bHeight - 32) + 'px'; // '768px'

        Object.defineProperty(window, 'innerHeight', { value: winHeight, configurable: true });
        const page = mountConversation();
        setMeasuredHeight(page.header, aHeight);
        setMeasuredHeight(page.column, bHeight);

        fireClick(page.editIcon);

        const { heightContainer } = renderEditBox({ value: 'plain text' });

        await new Promise(r => setTimeout(r, 0));

        expect(heightContainer.style.maxHeight).toBe(expectedPx);
    });

    it('F6: applyTextareaCleanup does not modify the edit textarea when its value has no wrapper', async () => {
        const page = mountConversation();

        fireClick(page.editIcon);

        const { editTextarea } = renderEditBox({ value: 'plain user message without wrapper' });

        await new Promise(r => setTimeout(r, 0));

        expect(editTextarea.value).toBe('plain user message without wrapper');
    });
});

// ---------------------------------------------------------------------------
// Group G: scroll-into-position
//   EDIT_SCROLL_GAP_PX constant, computeScrollDelta pure function,
//   and applyEditScrollPosition DOM function.
// ---------------------------------------------------------------------------

describe('G. scroll-into-position', () => {
    // G1 (EDIT_SCROLL_GAP_PX mirror) removed: G7-G11 call applyEditScrollPosition and
    // assert a scrollTop delta computed with gap=16 hardcoded into the test's own
    // expected value (e.g. G7's "300 + 84"), so a wrong/changed gap already fails
    // those tests — a standalone mirror was redundant.

    // -------------------------------------------------------------------------
    // G2–G6: computeScrollDelta — pure arithmetic
    // -------------------------------------------------------------------------

    it.each([
        // editBoxTop=200, headerBottom=100, gap=16 → target=116, delta=84 (scroll down)
        ['G2: positive delta — edit box below target position (scroll down)', 200, 100, 16, 84],
        // editBoxTop=50, headerBottom=100, gap=16 → target=116, delta=-66 (scroll up)
        ['G3: negative delta — edit box above target position (scroll up)', 50, 100, 16, -66],
        // editBoxTop=116, headerBottom=100, gap=16 → target=116, delta=0
        ['G4: zero delta — edit box is already perfectly aligned', 116, 100, 16, 0],
    ])('%s', (_title, editBoxTop, headerBottom, gap, expected) => {
        expect(computeScrollDelta(editBoxTop, headerBottom, gap)).toBe(expected);
    });

    it('G5: fractional pixel values produce fractional result without rounding', () => {
        // editBoxTop=100.5, headerBottom=80.5, gap=16 → target=96.5, delta=4
        expect(computeScrollDelta(100.5, 80.5, 16)).toBeCloseTo(4, 5);
    });

    it('G6: gap parameter is respected — different gap values yield different deltas', () => {
        // With gap=16: 200 - (100 + 16) = 84
        expect(computeScrollDelta(200, 100, 16)).toBe(84);
        // With gap=32: 200 - (100 + 32) = 68
        expect(computeScrollDelta(200, 100, 32)).toBe(68);
        // With gap=0: 200 - (100 + 0) = 100
        expect(computeScrollDelta(200, 100, 0)).toBe(100);
    });

    // -------------------------------------------------------------------------
    // G7–G16: applyEditScrollPosition — DOM behaviour on real edit-window markup
    //
    // Landmarks (located structurally by mountPane):
    //   edit box      → .ds-textarea around textarea[name="user query"]
    //   header        → parent of .the-header
    //   items list    → .ds-virtual-list-items inside the .ds-virtual-list scroll root
    //
    // Geometry is mocked via per-element getBoundingClientRect overrides; scrollability via scrollHeight/clientHeight getters (happy-dom reports 0 for both, so unmocked elements are never scrollable).
    // -------------------------------------------------------------------------

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    function setScrollable(el, scrollable, scrollTop) {
        Object.defineProperty(el, 'scrollHeight', { get: () => (scrollable ? 2000 : 100), configurable: true });
        Object.defineProperty(el, 'clientHeight', { get: () => 100, configurable: true });
        el.scrollTop = scrollTop;
    }

    /**
     * Mount the edit-window pane with mocked edit-box top and header bottom.
     *
     * @param {object} opts
     * @param {number} opts.editBoxTop   – mocked getBoundingClientRect().top for the edit box
     * @param {number} opts.headerBottom – mocked getBoundingClientRect().bottom for the header
     */
    function mountEditGeometry({ editBoxTop, headerBottom }) {
        const pane = mountPane(EDIT_PANE_HTML);
        pane.header.getBoundingClientRect = () => ({ bottom: headerBottom, top: 0, height: headerBottom });
        pane.editBox.getBoundingClientRect = () => ({ top: editBoxTop, bottom: editBoxTop + 50, height: 50 });
        return pane;
    }

    it.each([
        // editBoxTop=200, headerBottom=100, gap=16 → delta=84
        ['G7: scrollTop is incremented by the correct computed delta', 200, 100, 300, 300 + 84],
        // editBoxTop=50, headerBottom=100, gap=16 → delta=-66
        ['G8: negative delta scrolls the container upward (scrollTop decreases)', 50, 100, 200, 200 + (-66)],
        // editBoxTop=116, headerBottom=100, gap=16 → delta=0
        ['G9: zero delta leaves scrollTop unchanged', 116, 100, 500, 500],
    ])('%s', (_title, editBoxTop, headerBottom, initialScrollTop, expectedScrollTop) => {
        const pane = mountEditGeometry({ editBoxTop, headerBottom });
        setScrollable(pane.list, true, initialScrollTop);

        applyEditScrollPosition(document);

        expect(pane.list.scrollTop).toBe(expectedScrollTop);
    });

    it('G10: scrollable-ancestor detection — when the items list is not scrollable, scrolls the message-list scroll root', () => {
        const pane = mountEditGeometry({ editBoxTop: 200, headerBottom: 100 });
        setScrollable(pane.list, false, 0);
        setScrollable(pane.listRoot, true, 400);

        applyEditScrollPosition(document);

        // delta = 200 - (100 + 16) = 84
        expect(pane.listRoot.scrollTop).toBe(400 + 84);
        expect(pane.list.scrollTop).toBe(0);
    });

    it('G11: fallback to the items list itself when no ancestor is scrollable', () => {
        const pane = mountEditGeometry({ editBoxTop: 200, headerBottom: 100 });
        setScrollable(pane.list, false, 50);

        expect(() => applyEditScrollPosition(document)).not.toThrow();
        // delta = 84; fallback element's scrollTop is updated
        expect(pane.list.scrollTop).toBe(50 + 84);
    });

    it('G12: guard — no edit box (idle conversation pane) is a no-op (no throw, no scrollTop change)', () => {
        const pane = mountPane(CONV_PANE_HTML);
        pane.header.getBoundingClientRect = () => ({ bottom: 100 });
        setScrollable(pane.list, true, 300);

        expect(() => applyEditScrollPosition(document)).not.toThrow();
        expect(pane.list.scrollTop).toBe(300);
    });

    it('G13: guard — missing chat header is a no-op (no throw, no scrollTop change)', () => {
        const pane = mountEditGeometry({ editBoxTop: 150, headerBottom: 100 });
        pane.header.remove();
        setScrollable(pane.list, true, 200);

        expect(() => applyEditScrollPosition(document)).not.toThrow();
        expect(pane.list.scrollTop).toBe(200);
    });

    it('G14: guard — missing items list container is a no-op (no throw, no scrollTop change)', () => {
        const pane = mountEditGeometry({ editBoxTop: 200, headerBottom: 100 });
        // Minimal mutation: the list element loses the class that identifies it; the edit box stays inside
        pane.list.classList.remove('ds-virtual-list-items');
        setScrollable(pane.listRoot, true, 300);

        expect(() => applyEditScrollPosition(document)).not.toThrow();
        expect(pane.listRoot.scrollTop).toBe(300);
    });

    it.each([
        ['G15: searchRoot null falls back to document', null],
        ['G16: searchRoot undefined falls back to document', undefined],
    ])('%s', (_title, searchRoot) => {
        const pane = mountEditGeometry({ editBoxTop: 200, headerBottom: 100 });
        setScrollable(pane.list, true, 0);

        expect(() => applyEditScrollPosition(searchRoot)).not.toThrow();
        // delta = 200 - (100 + 16) = 84 — the edit box was found through the document fallback
        expect(pane.list.scrollTop).toBe(84);
    });
});
