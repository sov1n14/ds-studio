// @vitest-environment jsdom
/**
 * Clipboard capture of content/react-click-bridge.main.js (DECISIONS U6-14) observed on its own output: the dss:auto-copy-captured events it dispatches and what navigator.clipboard.writeText returns to the site. The relay is deliberately absent, so its own 1500 ms window cannot mask a bridge defect.
 *
 * Contract: a dss:react-click with detail 'auto-copy' opens one capture entry for 1500 ms (the end instant excluded); each writeText call consumes the oldest live entry; only a string text whose writeText promise rejects while consuming a live entry is dispatched as one dss:auto-copy-captured with that text; the wrapper returns exactly what the original writeText returned, thenable or not, and never throws because of it; a failure while dispatching the captured event is logged with the '[DSS] react-click-bridge' prefix and never escapes as an unhandled rejection.
 *
 * Sandbox: the source runs fresh per test through new Function in this realm with window, document, navigator and CustomEvent passed as parameters (MAIN-world page globals). window is a fresh object (no install flag), document a fresh HTML document, navigator.clipboard a fake whose writeText result is chosen per test.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const BRIDGE_FILE = path.resolve(__dirname, '../../content/react-click-bridge.main.js');
const CAPTURED_EVENT = 'dss:auto-copy-captured';
const WINDOW_MS = 1500;
const LOG_PREFIX = '[DSS] react-click-bridge';
const T0 = Date.UTC(2031, 6, 1);

/** Fake Clipboard: writeText records the text and returns per `outcome`: 'reject' (unfocused NotAllowedError), 'resolve', or { value } for any other return value. */
function makeClipboard() {
    const state = { outcome: 'reject', writes: [] };
    class FakeClipboard {
        writeText(text) {
            if (!(this instanceof FakeClipboard)) throw new TypeError('Illegal invocation');
            state.writes.push(text);
            if (state.outcome === 'reject') return Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError'));
            if (state.outcome === 'resolve') return Promise.resolve(undefined);
            return state.outcome.value;
        }
    }
    return { clipboard: new FakeClipboard(), state };
}

/** Evaluate the bridge fresh; `CustomEventImpl` stands in for the page's CustomEvent global. */
function evalBridge({ CustomEventImpl = CustomEvent } = {}) {
    const src = fs.readFileSync(BRIDGE_FILE, 'utf8');
    const doc = document.implementation.createHTMLDocument('bridge sandbox');
    const { clipboard, state } = makeClipboard();
    const navigatorFake = { clipboard };
    new Function('window', 'document', 'navigator', 'CustomEvent', src)({}, doc, navigatorFake, CustomEventImpl);
    const captured = [];
    doc.addEventListener(CAPTURED_EVENT, (e) => captured.push(e.detail));
    return { doc, clipboard, state, captured };
}

/** The site's own writeText call: what it got back or threw. */
function siteWrite(clipboard, text) {
    try {
        const value = clipboard.writeText(text);
        if (value && typeof value.catch === 'function') value.catch(() => {});
        return { value };
    } catch (error) {
        return { error };
    }
}

/** A dss:react-click with detail 'auto-copy' on a button without React props (the bridge falls back to click()); it only opens the capture entry. */
function autoCopyClick(doc) {
    const button = doc.createElement('div');
    doc.body.appendChild(button);
    button.dispatchEvent(new CustomEvent('dss:react-click', { bubbles: true, detail: 'auto-copy' }));
}

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

let errorSpy;
let unhandled;
const onUnhandled = (reason) => unhandled.push(reason);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('capture entries (fresh bridge per test)', () => {
    it('a rejected writeText right after load with no auto-copy click is not captured; one after an auto-copy click is', async () => {
        const { doc, clipboard, captured } = evalBridge();

        siteWrite(clipboard, 'site write without a click');
        await flush();
        expect(captured, 'write with no capture entry').toEqual([]);

        autoCopyClick(doc);
        siteWrite(clipboard, 'auto-copy write');
        await flush();
        expect(captured, 'positive control').toEqual(['auto-copy write']);
    });

    it.each([WINDOW_MS, WINDOW_MS + 5000])('a write %i ms after the auto-copy click is not captured; a later click inside its window is', async (delay) => {
        const { doc, clipboard, captured } = evalBridge();

        autoCopyClick(doc);
        vi.setSystemTime(T0 + delay);
        siteWrite(clipboard, 'late write');
        await flush();
        expect(captured, 'write after the window').toEqual([]);

        const t1 = T0 + 60_000;
        vi.setSystemTime(t1);
        autoCopyClick(doc);
        vi.setSystemTime(t1 + WINDOW_MS - 1);
        siteWrite(clipboard, 'in time');
        await flush();
        expect(captured, 'positive control').toEqual(['in time']);
    });

    it.each([
        ['a number', 42],
        ['an object', { text: 'not a string' }],
        ['undefined', undefined],
    ])('a rejected writeText of %s during an auto-copy click is not captured', async (_name, text) => {
        const { doc, clipboard, state, captured } = evalBridge();

        autoCopyClick(doc);
        siteWrite(clipboard, text);
        await flush();
        expect(state.writes, 'precondition: the write reached the clipboard').toHaveLength(1);
        expect(captured, 'non-string write').toEqual([]);

        autoCopyClick(doc);
        siteWrite(clipboard, 'string write');
        await flush();
        expect(captured, 'positive control').toEqual(['string write']);
    });
});

describe('the site gets the original writeText result', () => {
    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a plain object without then', { status: 'not a promise' }],
        ['an object whose then is not a function', { then: 'nope' }],
    ])('writeText returning %s during an auto-copy click: returned unchanged, nothing thrown, nothing captured', async (_name, value) => {
        const { doc, clipboard, state, captured } = evalBridge();
        state.outcome = { value };

        autoCopyClick(doc);
        const result = siteWrite(clipboard, 'text');
        await flush();

        expect(result.error, 'the wrapper must not throw').toBeUndefined();
        expect(result.value).toBe(value);
        expect(captured).toEqual([]);
    });
});

describe('a failing captured-event dispatch', () => {
    it('the page broke CustomEvent: one prefixed console.error, nothing unhandled, the site still sees its rejection', async () => {
        class BrokenCustomEvent {
            constructor() { throw new TypeError('CustomEvent replaced by the page'); }
        }
        const { doc, clipboard } = evalBridge({ CustomEventImpl: BrokenCustomEvent });

        autoCopyClick(doc);
        const { value, error } = siteWrite(clipboard, 'text');
        expect(error).toBeUndefined();
        await expect(value).rejects.toMatchObject({ name: 'NotAllowedError' });
        await flush();

        const prefixed = errorSpy.mock.calls.filter(([first]) => typeof first === 'string' && first.startsWith(LOG_PREFIX));
        expect(prefixed, JSON.stringify(errorSpy.mock.calls.map(([first]) => String(first)))).toHaveLength(1);
        expect(unhandled, 'unhandled rejections').toEqual([]);
    });
});
