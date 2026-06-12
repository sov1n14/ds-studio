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

const {
    extractUserInput,
    computeDynamicMaxHeight,
    applyMaxHeightAdjustments,
    applyTextareaCleanup,
    waitForNewTextarea,
    handleEditButtonClick,
    applyEditScrollPosition,
    computeScrollDelta,
    EDIT_BUTTON_CLASS,
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
// Group A: extractUserInput + constant exports
// ---------------------------------------------------------------------------

describe('A. extractUserInput', () => {
    it('A1: exports the correct constant values', () => {
        expect(EDIT_BUTTON_CLASS).toBe('d4910adc');
        expect(REMOVE_MAX_HEIGHT_SELECTOR).toBe('.cc852ac5');
        expect(DYNAMIC_MAX_HEIGHT_SELECTOR).toBe('._646a522');
        expect(HEIGHT_SOURCE_SELECTOR_A).toBe('._2be88ba');
        expect(HEIGHT_SOURCE_SELECTOR_B).toBe('._871cbca');
        expect(MAX_HEIGHT_OFFSET_PX).toBe(32);
        expect(DETECTION_TIMEOUT_MS).toBe(2000);
        expect(VALUE_WAIT_TIMEOUT_MS).toBe(800);
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
        const text = '<user-input>\nhello\n</user-input> trailing';
        expect(extractUserInput(text)).toBeNull();
    });

    it('A12: trailing newline after </user-input> prevents a match', () => {
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
// Group B: computeDynamicMaxHeight — pure arithmetic
// ---------------------------------------------------------------------------

describe('B. computeDynamicMaxHeight', () => {
    it('B1: MAX_HEIGHT_OFFSET_PX constant is 32 (used by the formula)', () => {
        expect(MAX_HEIGHT_OFFSET_PX).toBe(32);
    });

    it('B2: typical case — 1000 window, 100 sourceA, 200 sourceB → 668', () => {
        expect(computeDynamicMaxHeight(1000, 100, 200)).toBe(668);
    });

    it('B3: zero source heights — result is windowHeight minus offset', () => {
        expect(computeDynamicMaxHeight(800, 0, 0)).toBe(768);
    });

    it('B4: all zeros — result is negative offset', () => {
        expect(computeDynamicMaxHeight(0, 0, 0)).toBe(-32);
    });

    it('B5: large source heights can produce a negative result (no clamping)', () => {
        // Source heights larger than window — function returns raw arithmetic, no clamp
        const result = computeDynamicMaxHeight(500, 400, 200);
        expect(result).toBe(-132);
    });

    it('B6: formula is windowHeight - sourceHeightA - sourceHeightB - 32', () => {
        const wh = 1080;
        const a = 56;
        const b = 72;
        expect(computeDynamicMaxHeight(wh, a, b)).toBe(wh - a - b - 32);
    });

    it('B7: fractional pixel heights produce fractional result (no rounding)', () => {
        expect(computeDynamicMaxHeight(900, 50.5, 49.5)).toBe(768);
    });

    it('B8: sourceHeightA only contributes correctly when sourceHeightB is zero', () => {
        expect(computeDynamicMaxHeight(600, 80, 0)).toBe(488);
    });

    it('B9: sourceHeightB only contributes correctly when sourceHeightA is zero', () => {
        expect(computeDynamicMaxHeight(600, 0, 80)).toBe(488);
    });
});

// ---------------------------------------------------------------------------
// Group C: applyMaxHeightAdjustments — DOM style mutations
// ---------------------------------------------------------------------------

describe('C. applyMaxHeightAdjustments', () => {
    let container;

    // Save and restore getBoundingClientRect and window.innerHeight between tests
    let originalGetBCR;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        originalGetBCR = Element.prototype.getBoundingClientRect;
    });

    afterEach(() => {
        document.body.removeChild(container);
        Element.prototype.getBoundingClientRect = originalGetBCR;
        vi.restoreAllMocks();
        // Remove any lingering source elements added directly to body
        document.querySelectorAll('._2be88ba, ._871cbca').forEach(el => el.remove());
    });

    // Helper: append a source element to document.body so document.querySelector can find it
    function appendSourceA(height = 0) {
        const el = document.createElement('div');
        el.className = '_2be88ba';
        el.getBoundingClientRect = () => ({ height });
        document.body.appendChild(el);
        return el;
    }

    function appendSourceB(height = 0) {
        const el = document.createElement('div');
        el.className = '_871cbca';
        el.getBoundingClientRect = () => ({ height });
        document.body.appendChild(el);
        return el;
    }

    // ---- .cc852ac5 always cleared ----

    it('C1: sets maxHeight=none on all .cc852ac5 elements inside root', () => {
        const a = document.createElement('div');
        a.className = 'cc852ac5';
        a.style.maxHeight = '300px';
        const b = document.createElement('div');
        b.className = 'cc852ac5';
        b.style.maxHeight = '150px';
        container.append(a, b);

        applyMaxHeightAdjustments(container);

        expect(a.style.maxHeight).toBe('none');
        expect(b.style.maxHeight).toBe('none');
    });

    it('C2: .cc852ac5 is cleared EVEN when source elements are absent (no sources in DOM)', () => {
        const el = document.createElement('div');
        el.className = 'cc852ac5';
        el.style.maxHeight = '200px';
        container.appendChild(el);

        // No ._2be88ba or ._871cbca in DOM
        applyMaxHeightAdjustments(container);

        expect(el.style.maxHeight).toBe('none');
    });

    it('C3: does NOT touch an unrelated element', () => {
        const el = document.createElement('div');
        el.className = 'some-other-class';
        el.style.maxHeight = '200px';
        container.appendChild(el);

        applyMaxHeightAdjustments(container);

        expect(el.style.maxHeight).toBe('200px');
    });

    // ---- ._646a522 skipped when source missing ----

    it('C4: ._646a522 left untouched when HEIGHT_SOURCE_SELECTOR_A is missing', () => {
        appendSourceB(50);

        const target = document.createElement('div');
        target.className = '_646a522';
        target.style.maxHeight = '400px';
        container.appendChild(target);

        applyMaxHeightAdjustments(container);

        // .cc852ac5 cleared (none here); ._646a522 untouched because A is absent
        expect(target.style.maxHeight).toBe('400px');
    });

    it('C5: ._646a522 left untouched when HEIGHT_SOURCE_SELECTOR_B is missing', () => {
        appendSourceA(50);

        const target = document.createElement('div');
        target.className = '_646a522';
        target.style.maxHeight = '400px';
        container.appendChild(target);

        applyMaxHeightAdjustments(container);

        expect(target.style.maxHeight).toBe('400px');
    });

    it('C6: ._646a522 left untouched when BOTH source elements are missing', () => {
        const target = document.createElement('div');
        target.className = '_646a522';
        target.style.maxHeight = '400px';
        container.appendChild(target);

        applyMaxHeightAdjustments(container);

        expect(target.style.maxHeight).toBe('400px');
    });

    it('C7: .cc852ac5 is still cleared when ._646a522 is left untouched (missing sources)', () => {
        const cc = document.createElement('div');
        cc.className = 'cc852ac5';
        cc.style.maxHeight = '300px';
        container.appendChild(cc);

        const dyn = document.createElement('div');
        dyn.className = '_646a522';
        dyn.style.maxHeight = '400px';
        container.appendChild(dyn);

        // No sources — ._646a522 must be untouched; .cc852ac5 must be cleared
        applyMaxHeightAdjustments(container);

        expect(cc.style.maxHeight).toBe('none');
        expect(dyn.style.maxHeight).toBe('400px');
    });

    // ---- ._646a522 set when both sources present ----

    it('C8: sets correct maxHeight on ._646a522 when both sources are present', () => {
        const winHeight = 900;
        const aHeight = 60;
        const bHeight = 40;
        const expected = winHeight - aHeight - bHeight - 32; // 768

        Object.defineProperty(window, 'innerHeight', { value: winHeight, configurable: true });
        appendSourceA(aHeight);
        appendSourceB(bHeight);

        const target = document.createElement('div');
        target.className = '_646a522';
        container.appendChild(target);

        applyMaxHeightAdjustments(container);

        expect(target.style.maxHeight).toBe(expected + 'px');
    });

    it('C9: sets the same computed value on ALL ._646a522 elements under root', () => {
        const winHeight = 800;
        const aHeight = 50;
        const bHeight = 50;
        const expected = winHeight - aHeight - bHeight - 32; // 668

        Object.defineProperty(window, 'innerHeight', { value: winHeight, configurable: true });
        appendSourceA(aHeight);
        appendSourceB(bHeight);

        const t1 = document.createElement('div');
        t1.className = '_646a522';
        const t2 = document.createElement('div');
        t2.className = '_646a522';
        const t3 = document.createElement('div');
        t3.className = '_646a522';
        container.append(t1, t2, t3);

        applyMaxHeightAdjustments(container);

        expect(t1.style.maxHeight).toBe(expected + 'px');
        expect(t2.style.maxHeight).toBe(expected + 'px');
        expect(t3.style.maxHeight).toBe(expected + 'px');
    });

    // ---- root scoping ----

    it('C10: root parameter scoping — does not affect .cc852ac5 elements outside root', () => {
        const inside = document.createElement('div');
        inside.className = 'cc852ac5';
        container.appendChild(inside);

        const outside = document.createElement('div');
        outside.className = 'cc852ac5';
        outside.style.maxHeight = '100px';
        document.body.appendChild(outside);

        applyMaxHeightAdjustments(container);

        expect(inside.style.maxHeight).toBe('none');
        expect(outside.style.maxHeight).toBe('100px');

        document.body.removeChild(outside);
    });

    it('C11: root parameter scoping — does not affect ._646a522 elements outside root', () => {
        const winHeight = 700;
        Object.defineProperty(window, 'innerHeight', { value: winHeight, configurable: true });
        appendSourceA(30);
        appendSourceB(20);

        const inside = document.createElement('div');
        inside.className = '_646a522';
        container.appendChild(inside);

        const outside = document.createElement('div');
        outside.className = '_646a522';
        outside.style.maxHeight = '999px';
        document.body.appendChild(outside);

        applyMaxHeightAdjustments(container);

        const expected = winHeight - 30 - 20 - 32;
        expect(inside.style.maxHeight).toBe(expected + 'px');
        expect(outside.style.maxHeight).toBe('999px');

        document.body.removeChild(outside);
    });

    // ---- fallback when root is null / omitted ----

    it('C12: falls back to document when root is null (no throw)', () => {
        expect(() => applyMaxHeightAdjustments(null)).not.toThrow();
    });

    it('C13: falls back to document when called with no argument (no throw)', () => {
        expect(() => applyMaxHeightAdjustments()).not.toThrow();
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
            '<system-prompt>\nSys\n</system-prompt>\n\n' +
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

    it('D2: dispatches an input event after rewriting value', () => {
        const wrapped = '<user-input>\nhello\n</user-input>';
        const ta = makeTextarea(wrapped);

        const listener = vi.fn();
        ta.addEventListener('input', listener);

        applyTextareaCleanup(ta);

        expect(listener).toHaveBeenCalledOnce();
    });

    it('D3: dispatches a change event after rewriting value', () => {
        const wrapped = '<user-input>\nhello\n</user-input>';
        const ta = makeTextarea(wrapped);

        const listener = vi.fn();
        ta.addEventListener('change', listener);

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

    it('D7: returns false without error when passed a non-textarea element', () => {
        const div = document.createElement('div');
        expect(applyTextareaCleanup(div)).toBe(false);
    });

    it('D8: returns false without error when passed null', () => {
        expect(applyTextareaCleanup(null)).toBe(false);
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
// Group F: handleEditButtonClick
// ---------------------------------------------------------------------------

describe('F. handleEditButtonClick', () => {
    let originalGetBCR;

    beforeEach(() => {
        originalGetBCR = Element.prototype.getBoundingClientRect;
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        Element.prototype.getBoundingClientRect = originalGetBCR;
        vi.restoreAllMocks();
        document.querySelectorAll('._2be88ba, ._871cbca').forEach(el => el.remove());
    });

    // Helper: fire a synthetic click event targeting a specific element
    function fireClick(target) {
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'target', { value: target, writable: false });
        handleEditButtonClick(evt);
        return evt;
    }

    it('F1: no-op when click target is not inside .d4910adc', () => {
        const unrelated = document.createElement('div');
        document.body.appendChild(unrelated);

        expect(() => fireClick(unrelated)).not.toThrow();
    });

    // -------------------------------------------------------------------------
    // F2: REGRESSION TEST — the original bug
    //
    // Before the fix, handleEditButtonClick used waitForTextareaInContainer which
    // traversed ancestors to find a container, then grabbed the first textarea
    // inside it. When DeepSeek rendered the edit UI, the pre-existing main
    // composer textarea (empty) was sometimes found instead of the new edit
    // textarea that already contained the wrapped content. This caused
    // applyTextareaCleanup to run on the wrong element.
    //
    // The fix uses waitForNewTextarea with a pre-click snapshot, ensuring only
    // a textarea that did NOT exist at click-time is passed to the cleanup.
    // -------------------------------------------------------------------------
    it('F2: regression — pre-existing empty composer is ignored; NEW edit textarea is cleaned up', async () => {
        // Simulate the pre-existing main composer textarea (empty, always present)
        const composer = document.createElement('textarea');
        composer.value = '';
        document.body.appendChild(composer);

        // Build the edit button (click target)
        const editButton = document.createElement('div');
        editButton.className = EDIT_BUTTON_CLASS;
        const inner = document.createElement('span');
        editButton.appendChild(inner);
        document.body.appendChild(editButton);

        // Click — snapshot is taken at this point; composer is in it
        fireClick(inner);

        // DeepSeek asynchronously mounts the edit textarea pre-filled with wrapped content
        const wrappedValue =
            '<system-prompt>\nSys\n</system-prompt>\n\n' +
            '<user-input>\noriginal user text\n</user-input>';
        const editTextarea = document.createElement('textarea');
        editTextarea.value = wrappedValue;
        document.body.appendChild(editTextarea);

        // Allow MutationObserver callbacks to fire
        await new Promise(r => setTimeout(r, 0));

        // The NEW edit textarea must be cleaned up
        expect(editTextarea.value).toBe('original user text');

        // The pre-existing empty composer must be completely untouched
        expect(composer.value).toBe('');
    });

    it('F3: non-.d4910adc click is a no-op (guard clause)', () => {
        const randomEl = document.createElement('button');
        document.body.appendChild(randomEl);

        const composer = document.createElement('textarea');
        composer.value = 'unchanged';
        document.body.appendChild(composer);

        fireClick(randomEl);

        expect(composer.value).toBe('unchanged');
    });

    it('F4: applyMaxHeightAdjustments clears .cc852ac5 at detection time (sources absent — skip ._646a522)', async () => {
        // Build edit button
        const editButton = document.createElement('div');
        editButton.className = EDIT_BUTTON_CLASS;
        const inner = document.createElement('span');
        editButton.appendChild(inner);
        document.body.appendChild(editButton);

        // .cc852ac5 constrained element — must always be cleared
        const constrained1 = document.createElement('div');
        constrained1.className = 'cc852ac5';
        constrained1.style.maxHeight = '300px';
        document.body.appendChild(constrained1);

        // ._646a522 element — must be left untouched because no source elements exist
        const constrained2 = document.createElement('div');
        constrained2.className = '_646a522';
        constrained2.style.maxHeight = '150px';
        document.body.appendChild(constrained2);

        fireClick(inner);

        // Append edit textarea to trigger onFound callback
        const editTextarea = document.createElement('textarea');
        editTextarea.value = 'plain text';
        document.body.appendChild(editTextarea);

        await new Promise(r => setTimeout(r, 0));

        // .cc852ac5 must always be cleared
        expect(constrained1.style.maxHeight).toBe('none');
        // ._646a522 left untouched — no ._2be88ba / ._871cbca in DOM
        expect(constrained2.style.maxHeight).toBe('150px');
    });

    it('F5: applyMaxHeightAdjustments sets ._646a522 computed value when source elements are present', async () => {
        const winHeight = 900;
        const aHeight = 60;
        const bHeight = 40;
        const expectedPx = (winHeight - aHeight - bHeight - 32) + 'px'; // '768px'

        Object.defineProperty(window, 'innerHeight', { value: winHeight, configurable: true });

        // Source elements
        const sourceA = document.createElement('div');
        sourceA.className = '_2be88ba';
        sourceA.getBoundingClientRect = () => ({ height: aHeight });
        document.body.appendChild(sourceA);

        const sourceB = document.createElement('div');
        sourceB.className = '_871cbca';
        sourceB.getBoundingClientRect = () => ({ height: bHeight });
        document.body.appendChild(sourceB);

        // Build edit button
        const editButton = document.createElement('div');
        editButton.className = EDIT_BUTTON_CLASS;
        const inner = document.createElement('span');
        editButton.appendChild(inner);
        document.body.appendChild(editButton);

        // ._646a522 target
        const dynEl = document.createElement('div');
        dynEl.className = '_646a522';
        document.body.appendChild(dynEl);

        fireClick(inner);

        const editTextarea = document.createElement('textarea');
        editTextarea.value = 'plain text';
        document.body.appendChild(editTextarea);

        await new Promise(r => setTimeout(r, 0));

        expect(dynEl.style.maxHeight).toBe(expectedPx);
    });

    it('F6: applyTextareaCleanup does not modify textarea when value has no wrapper', async () => {
        const editButton = document.createElement('div');
        editButton.className = EDIT_BUTTON_CLASS;
        const inner = document.createElement('span');
        editButton.appendChild(inner);
        document.body.appendChild(editButton);

        fireClick(inner);

        const editTextarea = document.createElement('textarea');
        editTextarea.value = 'plain user message without wrapper';
        document.body.appendChild(editTextarea);

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
    // -------------------------------------------------------------------------
    // G1: EDIT_SCROLL_GAP_PX constant
    // -------------------------------------------------------------------------

    it('G1: EDIT_SCROLL_GAP_PX is 16', () => {
        expect(EDIT_SCROLL_GAP_PX).toBe(16);
    });

    // -------------------------------------------------------------------------
    // G2–G6: computeScrollDelta — pure arithmetic
    // -------------------------------------------------------------------------

    it('G2: positive delta — edit box below target position (scroll down)', () => {
        // editBoxTop=200, headerBottom=100, gap=16 → target=116, delta=84 (scroll down)
        expect(computeScrollDelta(200, 100, 16)).toBe(84);
    });

    it('G3: negative delta — edit box above target position (scroll up)', () => {
        // editBoxTop=50, headerBottom=100, gap=16 → target=116, delta=-66 (scroll up)
        expect(computeScrollDelta(50, 100, 16)).toBe(-66);
    });

    it('G4: zero delta — edit box is already perfectly aligned', () => {
        // editBoxTop=116, headerBottom=100, gap=16 → target=116, delta=0
        expect(computeScrollDelta(116, 100, 16)).toBe(0);
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
    // G7–G14: applyEditScrollPosition — DOM behaviour
    //
    // Selector map:
    //   edit box        → .cc852ac5
    //   header          → ._2be88ba
    //   virtual list    → .ds-virtual-list-items._6f2c522  (also just ._6f2c522)
    //
    // Geometry is mocked via per-element getBoundingClientRect overrides,
    // exactly as Group C does for source elements.
    // -------------------------------------------------------------------------

    let originalGetBCR;

    beforeEach(() => {
        originalGetBCR = Element.prototype.getBoundingClientRect;
    });

    afterEach(() => {
        Element.prototype.getBoundingClientRect = originalGetBCR;
        // Clean up any elements appended directly to body
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        vi.restoreAllMocks();
    });

    /**
     * Build a minimal DOM with edit box, header, and a scroll container.
     *
     * @param {object} opts
     * @param {number} opts.editBoxTop        – mocked getBoundingClientRect().top for edit box
     * @param {number} opts.headerBottom      – mocked getBoundingClientRect().bottom for header
     * @param {number} opts.initialScrollTop  – starting scrollTop of the container
     * @param {boolean} [opts.containerScrollable=true] – whether the ._6f2c522 element itself is scrollable
     * @returns {{ editBox, header, listEl, container }}
     */
    function buildScrollDOM({
        editBoxTop,
        headerBottom,
        initialScrollTop = 0,
        containerScrollable = true,
    }) {
        // Header (._2be88ba) — placed directly on body so document.querySelector finds it
        const header = document.createElement('div');
        header.className = '_2be88ba';
        header.getBoundingClientRect = () => ({ bottom: headerBottom, top: 0, height: headerBottom });
        document.body.appendChild(header);

        // Scroll container — either ._6f2c522 itself or an ancestor wrapper
        const listEl = document.createElement('div');
        listEl.className = 'ds-virtual-list-items _6f2c522';

        // Mock scrollHeight/clientHeight to control scrollability
        Object.defineProperty(listEl, 'scrollHeight', {
            get: () => containerScrollable ? 2000 : 100,
            configurable: true,
        });
        Object.defineProperty(listEl, 'clientHeight', {
            get: () => 100,
            configurable: true,
        });
        listEl.scrollTop = initialScrollTop;

        // Edit box (.cc852ac5) — child of the list element
        const editBox = document.createElement('div');
        editBox.className = 'cc852ac5';
        editBox.getBoundingClientRect = () => ({ top: editBoxTop, bottom: editBoxTop + 50, height: 50 });
        listEl.appendChild(editBox);

        document.body.appendChild(listEl);

        return { editBox, header, listEl };
    }

    it('G7: scrollTop is incremented by the correct computed delta', () => {
        // editBoxTop=200, headerBottom=100, gap=16 → delta=84
        const { listEl } = buildScrollDOM({ editBoxTop: 200, headerBottom: 100, initialScrollTop: 300 });

        applyEditScrollPosition(document);

        expect(listEl.scrollTop).toBe(300 + 84);
    });

    it('G8: negative delta scrolls the container upward (scrollTop decreases)', () => {
        // editBoxTop=50, headerBottom=100, gap=16 → delta=-66
        const { listEl } = buildScrollDOM({ editBoxTop: 50, headerBottom: 100, initialScrollTop: 200 });

        applyEditScrollPosition(document);

        expect(listEl.scrollTop).toBe(200 + (-66));
    });

    it('G9: zero delta leaves scrollTop unchanged', () => {
        // editBoxTop=116, headerBottom=100, gap=16 → delta=0
        const { listEl } = buildScrollDOM({ editBoxTop: 116, headerBottom: 100, initialScrollTop: 500 });

        applyEditScrollPosition(document);

        expect(listEl.scrollTop).toBe(500);
    });

    it('G10: scrollable-ancestor detection — when ._6f2c522 is not scrollable, walks up to scrollable ancestor', () => {
        // Header
        const header = document.createElement('div');
        header.className = '_2be88ba';
        header.getBoundingClientRect = () => ({ bottom: 100, top: 0, height: 100 });
        document.body.appendChild(header);

        // Ancestor wrapper — scrollable
        const ancestor = document.createElement('div');
        Object.defineProperty(ancestor, 'scrollHeight', { get: () => 2000, configurable: true });
        Object.defineProperty(ancestor, 'clientHeight', { get: () => 100, configurable: true });
        ancestor.scrollTop = 400;

        // ._6f2c522 — NOT scrollable (scrollHeight === clientHeight)
        const listEl = document.createElement('div');
        listEl.className = 'ds-virtual-list-items _6f2c522';
        Object.defineProperty(listEl, 'scrollHeight', { get: () => 100, configurable: true });
        Object.defineProperty(listEl, 'clientHeight', { get: () => 100, configurable: true });
        listEl.scrollTop = 0;

        // Edit box
        const editBox = document.createElement('div');
        editBox.className = 'cc852ac5';
        editBox.getBoundingClientRect = () => ({ top: 200, bottom: 250, height: 50 });

        listEl.appendChild(editBox);
        ancestor.appendChild(listEl);
        document.body.appendChild(ancestor);

        applyEditScrollPosition(document);

        // delta = 200 - (100 + 16) = 84; ancestor.scrollTop should increase by 84
        expect(ancestor.scrollTop).toBe(400 + 84);
        // ._6f2c522's own scrollTop must be untouched
        expect(listEl.scrollTop).toBe(0);
    });

    it('G11: fallback to ._6f2c522 itself when no ancestor is scrollable', () => {
        // Header
        const header = document.createElement('div');
        header.className = '_2be88ba';
        header.getBoundingClientRect = () => ({ bottom: 100, top: 0, height: 100 });
        document.body.appendChild(header);

        // ._6f2c522 — NOT scrollable; no scrollable ancestor exists
        const listEl = document.createElement('div');
        listEl.className = 'ds-virtual-list-items _6f2c522';
        Object.defineProperty(listEl, 'scrollHeight', { get: () => 100, configurable: true });
        Object.defineProperty(listEl, 'clientHeight', { get: () => 100, configurable: true });
        listEl.scrollTop = 50;

        // Edit box
        const editBox = document.createElement('div');
        editBox.className = 'cc852ac5';
        editBox.getBoundingClientRect = () => ({ top: 200, bottom: 250, height: 50 });
        listEl.appendChild(editBox);

        document.body.appendChild(listEl);

        // Should fall back to listEl and still apply delta without throwing
        expect(() => applyEditScrollPosition(document)).not.toThrow();
        // delta = 84; fallback element's scrollTop is updated
        expect(listEl.scrollTop).toBe(50 + 84);
    });

    it('G12: guard — missing .cc852ac5 edit box is a no-op (no throw, no scrollTop change)', () => {
        // Header present, list with NO edit box
        const header = document.createElement('div');
        header.className = '_2be88ba';
        header.getBoundingClientRect = () => ({ bottom: 100 });
        document.body.appendChild(header);

        const listEl = document.createElement('div');
        listEl.className = 'ds-virtual-list-items _6f2c522';
        Object.defineProperty(listEl, 'scrollHeight', { get: () => 2000, configurable: true });
        Object.defineProperty(listEl, 'clientHeight', { get: () => 100, configurable: true });
        listEl.scrollTop = 300;
        document.body.appendChild(listEl);

        expect(() => applyEditScrollPosition(document)).not.toThrow();
        expect(listEl.scrollTop).toBe(300);
    });

    it('G13: guard — missing ._2be88ba header is a no-op (no throw, no scrollTop change)', () => {
        // List with edit box but NO header
        const listEl = document.createElement('div');
        listEl.className = 'ds-virtual-list-items _6f2c522';
        Object.defineProperty(listEl, 'scrollHeight', { get: () => 2000, configurable: true });
        Object.defineProperty(listEl, 'clientHeight', { get: () => 100, configurable: true });
        listEl.scrollTop = 200;

        const editBox = document.createElement('div');
        editBox.className = 'cc852ac5';
        editBox.getBoundingClientRect = () => ({ top: 150 });
        listEl.appendChild(editBox);
        document.body.appendChild(listEl);

        expect(() => applyEditScrollPosition(document)).not.toThrow();
        expect(listEl.scrollTop).toBe(200);
    });

    it('G14: guard — missing ._6f2c522 scroll container element is a no-op (no throw)', () => {
        // Header and edit box present but NO ._6f2c522 in DOM
        const header = document.createElement('div');
        header.className = '_2be88ba';
        header.getBoundingClientRect = () => ({ bottom: 100 });
        document.body.appendChild(header);

        const editBox = document.createElement('div');
        editBox.className = 'cc852ac5';
        editBox.getBoundingClientRect = () => ({ top: 200 });
        document.body.appendChild(editBox);

        expect(() => applyEditScrollPosition(document)).not.toThrow();
    });

    it('G15: searchRoot null falls back to document without throwing', () => {
        // Minimal DOM so the function can actually execute
        buildScrollDOM({ editBoxTop: 200, headerBottom: 100, initialScrollTop: 0 });

        expect(() => applyEditScrollPosition(null)).not.toThrow();
    });

    it('G16: searchRoot undefined falls back to document without throwing', () => {
        buildScrollDOM({ editBoxTop: 200, headerBottom: 100, initialScrollTop: 0 });

        expect(() => applyEditScrollPosition(undefined)).not.toThrow();
    });
});
