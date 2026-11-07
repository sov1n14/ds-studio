// @vitest-environment jsdom
/**
 * Scenario: a message edit window is open while the user works in the main composer.
 *
 * Live fact (chat.deepseek.com, captured in test/fixtures/ds-snapshots/edit-window-chat-pane.html): while a user message is being edited, the page holds TWO textareas, the edit box textarea[name="user query"] FIRST in document order and the main input textarea[name="search"] after it.
 *
 * Requirement: every composer path targets the main input; every edit-window path targets the edit box.
 *   - composer Send click: the prompt prefix goes into the main input, the edit box is untouched, and the re-dispatched send reads the main input.
 *   - quote-reply button: the quote goes into the main input, the edit box is untouched.
 *   - edit Send click: the prompt prefix goes into the edit box, the main input is untouched (regression guard, green before and after the fix).
 *
 * Elements are located by page structure (name attribute, the send-icon path), never through the selectors under test.
 * Real modules share one document; only requestAnimationFrame is replaced by a manual queue so the suppress-then-redispatch cycle is observable.
 * jsdom, not happy-dom, because this spec asserts selector-driven element choice (testing-pitfalls: DOM Fixture Completeness).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import '../../content/ds-selectors.js';
import '../../content/prompt-injector.send-button.js';
import '../../content/prompt-injector.controller.js';
import quoteReply from '../../content/quote-reply.js';

const SNAPSHOT_DIR = path.resolve(__dirname, '../fixtures/ds-snapshots');
const EDIT_PANE_HTML = fs.readFileSync(path.join(SNAPSHOT_DIR, 'edit-window-chat-pane.html'), 'utf8');
const IDLE_PANE_HTML = fs.readFileSync(path.join(SNAPSHOT_DIR, 'conv2-finished-chat-pane.html'), 'utf8');

const SB = globalThis.__DS_PromptInjectorSendButton;
const { createPromptInjector } = globalThis.__DS_PromptInjector;

// createPromptInjector registers document listeners that cannot be removed, so one injector serves the whole file; its ctx reads a mutable state reset before each test.
const state = {};
function resetState() {
    Object.assign(state, {
        isEnabled: true,
        promptPrefix: '',
        globalDefaultPrompt: 'GLOBAL',
        isGlobalPromptEnabled: true,
        isShowSystemTime: false,
        isInjecting: false,
    });
}
createPromptInjector({
    getIsEnabled: () => state.isEnabled,
    getPromptPrefix: () => state.promptPrefix,
    getGlobalDefaultPrompt: () => state.globalDefaultPrompt,
    getIsGlobalPromptEnabled: () => state.isGlobalPromptEnabled,
    getIsShowSystemTime: () => state.isShowSystemTime,
    getIsInjecting: () => state.isInjecting,
    setIsInjecting: (v) => { state.isInjecting = v; },
    markChatCreationAttempt: () => {},
    formatSystemTime: () => 'STUB-TIME',
});

const injected = (text) => '<system-reminder>\nGLOBAL\n</system-reminder>\n\n<user-input>\n' + text + '\n</user-input>';

/** Mount a chat-pane snapshot and return its landmarks, located by structure. */
function mountPane(html) {
    document.body.innerHTML = html;
    const sendIconPaths = Array.from(document.querySelectorAll('path')).filter((p) => (p.getAttribute('d') || '').startsWith('M8.3125'));
    expect(sendIconPaths, 'snapshot holds exactly one composer send icon').toHaveLength(1);
    const sendSvg = sendIconPaths[0].closest('svg');
    const editTextarea = document.querySelector('textarea[name="user query"]');
    const editItem = editTextarea ? editTextarea.closest('[data-virtual-list-item-key]') : null;
    const editSendButton = editItem
        ? Array.from(editItem.querySelectorAll('[role="button"]')).find((b) => b.classList.contains('ds-button--filled'))
        : null;
    return {
        mainTextarea: document.querySelector('textarea[name="search"]'),
        editTextarea,
        editSendButton,
        sendSvg,
        sendButton: sendSvg.closest('[role="button"]'),
        assistantParagraph: document.querySelector('.ds-virtual-list-visible-items .ds-markdown-paragraph'),
    };
}

/** Model the user typing into the main input: React writes the value and drops the disabled class from the send button. */
function typeIntoMain(page, text) {
    page.mainTextarea.value = text;
    page.sendButton.classList.remove('ds-button--disabled');
}

/** Count clicks that reach the host send button itself (the intercepted original is stopped at document capture). */
function countClicksReaching(el) {
    const counter = { count: 0 };
    el.addEventListener('click', () => { counter.count += 1; });
    return counter;
}

function dispatchClick(target) {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}

let rafQueue;
let originalRaf;
beforeEach(() => {
    resetState();
    rafQueue = [];
    originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
});
afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});
function flushRaf() {
    rafQueue.splice(0, rafQueue.length).forEach((cb) => cb(0));
}

describe('fixture self-check', () => {
    it('the edit-window snapshot holds the edit box first, then the main input', () => {
        const page = mountPane(EDIT_PANE_HTML);
        const all = Array.from(document.querySelectorAll('textarea'));
        expect(all).toEqual([page.editTextarea, page.mainTextarea]);
        expect(page.editSendButton, 'edit Send button located').toBeTruthy();
    });
});

describe('composer send while an edit window is open', () => {
    it('resolveTextareaForButton(composer send button) returns the main input, not the edit box that precedes it', () => {
        const page = mountPane(EDIT_PANE_HTML);
        const resolved = SB.resolveTextareaForButton(page.sendButton, false);
        expect(resolved && resolved.getAttribute('name'), 'composer path must resolve the main input').toBe('search');
        expect(resolved).toBe(page.mainTextarea);
    });

    it('clicking the composer Send injects into the main input and leaves the edit box text unchanged', () => {
        const page = mountPane(EDIT_PANE_HTML);
        const editBefore = page.editTextarea.value;
        typeIntoMain(page, 'hello');
        const clicks = countClicksReaching(page.sendButton);

        const ev = dispatchClick(page.sendSvg);

        expect(ev.defaultPrevented, 'the original click is suppressed for injection').toBe(true);
        expect(page.editTextarea.value, 'edit box must not receive the composer prefix').toBe(editBefore);
        expect(page.mainTextarea.value, 'main input receives the prefix').toBe(injected('hello'));
        flushRaf();
        expect(clicks.count, 're-dispatched send reaches the composer send button once').toBe(1);
    });

    it('the re-dispatched send reads the main input: an empty edit box does not cancel the send', () => {
        const page = mountPane(EDIT_PANE_HTML);
        page.editTextarea.value = '';
        typeIntoMain(page, 'hello');
        const clicks = countClicksReaching(page.sendButton);

        dispatchClick(page.sendSvg);

        expect(page.mainTextarea.value, 'main input receives the prefix').toBe(injected('hello'));
        expect(page.editTextarea.value, 'edit box stays empty').toBe('');
        flushRaf();
        expect(clicks.count, 're-dispatch must re-read the main input (non-empty) and click send').toBe(1);
        expect(state.isInjecting, 'injecting flag released after the cycle').toBe(false);
    });

    it('control: on the idle pane (no edit window) the composer Send injects into the main input and re-dispatches once', () => {
        const page = mountPane(IDLE_PANE_HTML);
        typeIntoMain(page, 'hello');
        const clicks = countClicksReaching(page.sendButton);

        dispatchClick(page.sendSvg);

        expect(page.mainTextarea.value).toBe(injected('hello'));
        flushRaf();
        expect(clicks.count).toBe(1);
    });
});

describe('edit-window send keeps targeting the edit box (regression guard)', () => {
    it('resolveTextareaForButton(edit Send button) returns the edit box even when the main input holds a draft', () => {
        const page = mountPane(EDIT_PANE_HTML);
        page.mainTextarea.value = 'composer draft';
        const resolved = SB.resolveTextareaForButton(page.editSendButton, true);
        expect(resolved).toBe(page.editTextarea);
    });

    it('clicking the edit Send injects into the edit box and leaves the main input draft unchanged', () => {
        const page = mountPane(EDIT_PANE_HTML);
        const editBefore = page.editTextarea.value;
        page.mainTextarea.value = 'composer draft';

        const ev = dispatchClick(page.editSendButton.querySelector('.ds-button__content'));

        expect(ev.defaultPrevented).toBe(true);
        expect(page.editTextarea.value).toBe(injected(editBefore));
        expect(page.mainTextarea.value).toBe('composer draft');
    });
});

describe('quote-reply while an edit window is open', () => {
    beforeEach(() => {
        quoteReply.state.btnEl = null;
        quoteReply.state.selectedText = '';
        quoteReply.state.isScrollAttached = false;
        if (quoteReply.state.debounceTimer) clearTimeout(quoteReply.state.debounceTimer);
        quoteReply.state.debounceTimer = null;
    });

    /** Select text in the assistant reply, then click the quote button with the event sequence of a real mouse click. */
    function quoteFromAssistant(page, text) {
        const selection = {
            toString: () => text,
            anchorNode: page.assistantParagraph,
            focusNode: page.assistantParagraph,
            getRangeAt: () => ({ getClientRects: () => [{ top: 300, bottom: 320, left: 50, width: 200, right: 250 }] }),
        };
        quoteReply.handleSelectionChange(selection);
        const btn = document.querySelector('.dss-quote-btn');
        expect(btn, 'quote button shown for a selection in the assistant reply').not.toBeNull();
        const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        btn.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    it('the quote lands in the main input and the edit box text is unchanged', () => {
        const page = mountPane(EDIT_PANE_HTML);
        const editBefore = page.editTextarea.value;

        quoteFromAssistant(page, 'quoted line');

        expect(page.editTextarea.value, 'edit box must not receive the quote').toBe(editBefore);
        expect(page.mainTextarea.value, 'main input receives the quote').toContain('> quoted line');
    });

    it('control: on the idle pane (no edit window) the quote lands in the main input', () => {
        const page = mountPane(IDLE_PANE_HTML);

        quoteFromAssistant(page, 'quoted line');

        expect(page.mainTextarea.value).toContain('> quoted line');
    });
});
