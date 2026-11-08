// @vitest-environment jsdom
/**
 * offscreen/clipboard-offscreen.js — offscreen document (reason CLIPBOARD) script that writes text to the clipboard with textarea + select + document.execCommand('copy') for the service worker (red phase: the module does not exist yet and was NOT read).
 *
 * Basis: DECISIONS U6-14 (the service worker writes unfocused auto-copy text through an offscreen document with textarea + select + execCommand('copy')).
 *
 * Contract under test: the classic script, loaded by offscreen/clipboard-offscreen.html, publishes globalThis.DSSClipboardOffscreen.writeViaExecCommand(doc, text) and registers one chrome.runtime.onMessage listener at load. writeViaExecCommand returns the boolean execCommand('copy') returned; when execCommand runs, the selected textarea text equals text exactly; afterwards no textarea it created remains in doc; a throwing execCommand yields false and still leaves no textarea. The listener answers { type: 'DSS_OFFSCREEN_WRITE_CLIPBOARD', text } with { ok: <execCommand result> }, answers a non-string text with { ok: false } without calling execCommand, and for any other message returns a falsy value and never answers.
 *
 * Trust boundaries only: document.execCommand is stubbed and records the selected text at call time; chrome.runtime.onMessage.addListener is faked to capture the listener. Assertions read return values, the recorded selection, sendResponse payloads and the textareas left in the document. The script is evaluated fresh per test (vi.resetModules + import.meta.glob loader) so load-time registration is observable.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MODULE_REL = 'offscreen/clipboard-offscreen.js';
const MODULE_FILE = path.resolve(__dirname, '../..', MODULE_REL);
const moduleLoaders = import.meta.glob('../../offscreen/clipboard-offscreen.js');
const WRITE_TYPE = 'DSS_OFFSCREEN_WRITE_CLIPBOARD';

const FENCE = String.fromCharCode(96).repeat(3);
const MARKDOWN = '  # 標題 Title\n\n這是一段中文說明，含全形標點：「引號」。\n\n' + FENCE + 'js\nconst a = 1;\n\tconsole.log("你好");\n' + FENCE + '\n\n- 項目一\n- item two\n';

/** Loads the script fresh, capturing every chrome.runtime.onMessage listener it registers. A missing file, a loader miss and a missing published API are distinct errors, so a broken loader cannot pass for "not implemented yet". */
async function loadFresh() {
    if (!fs.existsSync(MODULE_FILE)) throw new Error(MODULE_REL + ' does not exist (red phase: module not implemented yet)');
    const load = Object.values(moduleLoaders)[0];
    if (!load) throw new Error(MODULE_REL + ' exists but import.meta.glob did not pick it up; fix the glob in clipboard-offscreen.spec.js');
    delete globalThis.DSSClipboardOffscreen;
    const listeners = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { listeners.push(fn); });
    vi.resetModules();
    try {
        await load();
    } finally {
        addSpy.mockRestore();
    }
    const api = globalThis.DSSClipboardOffscreen;
    if (typeof api?.writeViaExecCommand !== 'function') throw new Error(MODULE_REL + ' loaded but globalThis.DSSClipboardOffscreen.writeViaExecCommand is not a function');
    return { api, listeners };
}

/** The single listener registered at load. */
async function loadListener() {
    const { listeners } = await loadFresh();
    expect(listeners.length, 'loading the script must register exactly one chrome.runtime.onMessage listener').toBe(1);
    return listeners[0];
}

/** The text currently selected in doc: a textarea or input selection (the focused one first), else the document selection. */
function selectedTextIn(doc) {
    const active = doc.activeElement;
    const fields = [active, ...doc.querySelectorAll('textarea, input')].filter((el) => el && typeof el.value === 'string');
    for (const el of fields) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && end > start) return el.value.slice(start, end);
    }
    const selection = typeof doc.getSelection === 'function' ? doc.getSelection() : null;
    return selection ? selection.toString() : '';
}

const stubbedDocs = new Set();

/** Stubs doc.execCommand as the trust boundary; outcome is a boolean to return or 'throw'. Each call records its command and the selection at that moment. */
function stubExecCommand(doc, outcome) {
    const calls = [];
    const fn = vi.fn((command) => {
        calls.push({ command, selected: selectedTextIn(doc) });
        if (outcome === 'throw') throw new Error('execCommand failed (test stub)');
        return outcome;
    });
    Object.defineProperty(doc, 'execCommand', { value: fn, configurable: true, writable: true });
    stubbedDocs.add(doc);
    return { fn, calls, copyCalls: () => calls.filter((c) => c.command === 'copy') };
}

/** The selection recorded by the single execCommand('copy') call. */
function selectionAtCopy(stub) {
    const copies = stub.copyCalls();
    expect(copies.length, 'execCommand("copy") must be called exactly once, calls: ' + JSON.stringify(stub.calls)).toBe(1);
    return copies[0].selected;
}

const textareaCount = (doc) => doc.querySelectorAll('textarea').length;

const flush = async (ticks = 6) => {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Delivers a message to the listener the way chrome.runtime.onMessage would. */
async function deliver(listener, message) {
    const sendResponse = vi.fn();
    const returned = listener(message, { id: 'test-extension-id' }, sendResponse);
    const answeredSynchronously = sendResponse.mock.calls.length > 0;
    await flush();
    return { returned, sendResponse, answeredSynchronously };
}

/** The single answer; an answer sent after the listener returned is delivered by Chrome only when the listener returned true. */
function onlyAnswer({ returned, sendResponse, answeredSynchronously }) {
    expect(sendResponse, 'sendResponse must be called exactly once').toHaveBeenCalledTimes(1);
    if (!answeredSynchronously) expect(returned, 'an asynchronous answer needs the listener to return true or Chrome drops it').toBe(true);
    return sendResponse.mock.calls[0][0];
}

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    for (const doc of stubbedDocs) delete doc.execCommand;
    stubbedDocs.clear();
    delete globalThis.DSSClipboardOffscreen;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('writeViaExecCommand(doc, text)', () => {
    it.each([
        ['a single-line string', 'hello clipboard 123'],
        ['multi-line markdown with code fences, CJK, tabs and leading spaces', MARKDOWN],
    ])('selects exactly the text when execCommand("copy") runs: %s', async (_label, text) => {
        const { api } = await loadFresh();
        const stub = stubExecCommand(document, true);

        api.writeViaExecCommand(document, text);

        expect(selectionAtCopy(stub)).toBe(text);
    });

    it('returns true when execCommand("copy") returns true, and leaves no textarea behind', async () => {
        const { api } = await loadFresh();
        const stub = stubExecCommand(document, true);

        const result = api.writeViaExecCommand(document, MARKDOWN);

        expect(result).toBe(true);
        expect(selectionAtCopy(stub)).toBe(MARKDOWN);
        expect(textareaCount(document), 'the textarea created for the copy must be removed').toBe(0);
    });

    it('returns false when execCommand("copy") returns false, and leaves no textarea behind', async () => {
        const { api } = await loadFresh();
        const stub = stubExecCommand(document, false);

        const result = api.writeViaExecCommand(document, 'copy refused');

        expect(result).toBe(false);
        expect(selectionAtCopy(stub)).toBe('copy refused');
        expect(textareaCount(document), 'the textarea created for the copy must be removed').toBe(0);
    });

    it('returns false without throwing when execCommand throws, and leaves no textarea behind', async () => {
        const { api } = await loadFresh();
        const stub = stubExecCommand(document, 'throw');

        let result;
        expect(() => { result = api.writeViaExecCommand(document, 'boom text'); }).not.toThrow();

        expect(result).toBe(false);
        expect(selectionAtCopy(stub)).toBe('boom text');
        expect(textareaCount(document), 'the textarea must be removed even when execCommand throws').toBe(0);
    });

    it('writes through the document it is given, not the global document', async () => {
        const { api } = await loadFresh();
        const other = document.implementation.createHTMLDocument('offscreen');
        const globalStub = stubExecCommand(document, true);
        const otherStub = stubExecCommand(other, true);

        const result = api.writeViaExecCommand(other, 'only in the given document');

        expect(result).toBe(true);
        expect(globalStub.fn, 'the global document must not be used').not.toHaveBeenCalled();
        expect(selectionAtCopy(otherStub)).toBe('only in the given document');
        expect(textareaCount(other)).toBe(0);
        expect(textareaCount(document)).toBe(0);
    });

    it('selects only the new text on a second call (no leftover from the first)', async () => {
        const { api } = await loadFresh();
        const stub = stubExecCommand(document, true);

        api.writeViaExecCommand(document, 'first value');
        api.writeViaExecCommand(document, 'second');

        const copies = stub.copyCalls();
        expect(copies.map((c) => c.selected)).toEqual(['first value', 'second']);
        expect(textareaCount(document)).toBe(0);
    });
});

describe('chrome.runtime.onMessage listener', () => {
    it('is registered when the script loads, with no init call', async () => {
        const { listeners } = await loadFresh();

        expect(listeners.length).toBe(1);
        expect(typeof listeners[0]).toBe('function');
    });

    it.each([
        ['execCommand returns true', true, true],
        ['execCommand returns false', false, false],
        ['execCommand throws', 'throw', false],
    ])('answers a write message with ok = the copy result when %s', async (_label, outcome, expectedOk) => {
        const listener = await loadListener();
        const stub = stubExecCommand(document, outcome);

        const delivery = await deliver(listener, { type: WRITE_TYPE, text: MARKDOWN });

        const answer = onlyAnswer(delivery);
        expect(answer?.ok, 'answer was ' + JSON.stringify(answer)).toBe(expectedOk);
        expect(selectionAtCopy(stub)).toBe(MARKDOWN);
        expect(textareaCount(document)).toBe(0);
    });

    it.each([
        ['undefined', undefined],
        ['a number', 42],
        ['null', null],
        ['an object', { text: 'nested' }],
    ])('answers { ok: false } without calling execCommand when text is %s', async (_label, text) => {
        const listener = await loadListener();
        const stub = stubExecCommand(document, true);

        const delivery = await deliver(listener, { type: WRITE_TYPE, text });

        const answer = onlyAnswer(delivery);
        expect(answer?.ok, 'answer was ' + JSON.stringify(answer)).toBe(false);
        expect(stub.fn).not.toHaveBeenCalled();
    });

    it.each([
        ['another message type', { type: 'DSS_SHOW_NOTIFICATION', text: 'not for the clipboard' }],
        ['a message without a type', { text: 'no type' }],
        ['a near-miss type', { type: WRITE_TYPE.toLowerCase(), text: 'case differs' }],
    ])('ignores %s: falsy return, no answer, no execCommand', async (_label, message) => {
        const listener = await loadListener();
        const stub = stubExecCommand(document, true);

        const { returned, sendResponse } = await deliver(listener, message);

        expect(returned, 'the listener must return a falsy value for a message it does not handle').toBeFalsy();
        expect(sendResponse).not.toHaveBeenCalled();
        expect(stub.fn).not.toHaveBeenCalled();
    });
});

describe('edge contracts', () => {
    it('writes in a document that has no body: returns the copy result, selects the text, leaves no textarea', async () => {
        const { api } = await loadFresh();
        const bodiless = document.implementation.createHTMLDocument('no body');
        bodiless.body.remove();
        expect(bodiless.body, 'precondition: the document has no body').toBeNull();
        const stub = stubExecCommand(bodiless, true);

        let result;
        expect(() => { result = api.writeViaExecCommand(bodiless, 'no body text'); }).not.toThrow();

        expect(result).toBe(true);
        expect(selectionAtCopy(stub)).toBe('no body text');
        expect(textareaCount(bodiless)).toBe(0);
    });

    it("a throwing execCommand logs a console.error whose first argument starts with '[DSS] clipboard-offscreen.writeViaExecCommand'", async () => {
        const { api } = await loadFresh();
        stubExecCommand(document, 'throw');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        api.writeViaExecCommand(document, 'boom text');

        const firsts = errorSpy.mock.calls.map(([first]) => first);
        expect(firsts.some((first) => typeof first === 'string' && first.startsWith('[DSS] clipboard-offscreen.writeViaExecCommand')), JSON.stringify(firsts)).toBe(true);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
    ])('a %s message: no throw, falsy return, no answer, no execCommand', async (_label, message) => {
        const listener = await loadListener();
        const stub = stubExecCommand(document, true);
        const sendResponse = vi.fn();

        let returned;
        expect(() => { returned = listener(message, { id: 'test-extension-id' }, sendResponse); }).not.toThrow();

        expect(returned).toBeFalsy();
        expect(sendResponse).not.toHaveBeenCalled();
        expect(stub.fn).not.toHaveBeenCalled();
    });

    it.each([
        ['a write message', 'some text'],
        ['a write message with a non-string text', 42],
    ])('answers %s synchronously and returns false (documented @returns {false}: no channel kept open)', async (_label, text) => {
        const listener = await loadListener();
        stubExecCommand(document, true);

        const { returned, answeredSynchronously } = await deliver(listener, { type: WRITE_TYPE, text });

        expect(answeredSynchronously, 'precondition: the answer was synchronous').toBe(true);
        expect(returned).toBe(false);
    });
});
