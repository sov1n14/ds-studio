// @vitest-environment jsdom
/**
 * content/auto-copy.relay.js evaluated fresh inside every test, so load-time state (the pending list, the started flag, the auto-start, the module.exports guard) is attributed to the test that observes it.
 *
 * Contract: the relay forwards a string dss:auto-copy-captured detail as exactly one { type: DSS_COPY_TO_CLIPBOARD, text } only while consuming one live pending entry (notePending() opens one entry for 1500 ms, the end instant excluded); entries are consumed first in, first out, one per capture; start() registers its listener once however often it runs; a missing DSS_COPY_TO_CLIPBOARD constant makes loading throw an Error naming utils/message-constants.js; a sendMessage rejection or synchronous throw and an exception while handling a capture are logged with the '[DSS] auto-copy-relay' prefix and never escape; the relay is published on globalThis.DSSAutoCopyRelay and, where CommonJS `module` exists, on module.exports.
 *
 * Sandbox: the source runs through new Function in this realm with globalThis, document, chrome and module passed as parameters (globalThis is an object inheriting the real global, so Stryker's namespace stays reachable). document is a fresh HTML document per test, so no listener survives into the next test; chrome.runtime.sendMessage is a plain routing function, never a vi.fn, because a vi.fn marks rejections as handled.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const RELAY_FILE = path.resolve(__dirname, '../../content/auto-copy.relay.js');
const COPY_TYPE = 'DSS_COPY_TO_CLIPBOARD';
const CAPTURED_EVENT = 'dss:auto-copy-captured';
const WINDOW_MS = 1500;
const LOG_PREFIX = '[DSS] auto-copy-relay';
const T0 = Date.UTC(2031, 5, 1);

/** sendMessage behaviour per call: 'ok' resolves { ok: true }, 'reject' rejects, 'throw' throws synchronously; the last mode repeats. */
function makeChrome(modes = ['ok']) {
    const sent = [];
    const sendMessage = (message) => {
        sent.push(structuredClone(message));
        const mode = modes[Math.min(sent.length - 1, modes.length - 1)];
        if (mode === 'throw') throw new Error('Extension context invalidated.');
        if (mode === 'reject') return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
        return Promise.resolve({ ok: true });
    };
    return { chrome: { runtime: { sendMessage } }, sent };
}

/** Evaluate the relay source fresh. `constant` is the DSS_COPY_TO_CLIPBOARD value the sandbox global carries; `module` is the CommonJS binding (pass undefined for a browser). */
function evalRelay(options = {}) {
    // 'in' checks, not destructuring defaults: an explicit undefined must reach the sandbox
    const constant = 'constant' in options ? options.constant : COPY_TYPE;
    const module = 'module' in options ? options.module : { exports: {} };
    const { modes } = options;
    const src = fs.readFileSync(RELAY_FILE, 'utf8');
    const sandboxGlobal = Object.create(globalThis);
    sandboxGlobal.DSS_COPY_TO_CLIPBOARD = constant;
    const doc = document.implementation.createHTMLDocument('relay sandbox');
    const { chrome, sent } = makeChrome(modes);
    new Function('globalThis', 'document', 'chrome', 'module', src)(sandboxGlobal, doc, chrome, module);
    return { relay: sandboxGlobal.DSSAutoCopyRelay, sandboxGlobal, doc, sent, module };
}

const capture = (doc, detail) => doc.dispatchEvent(new CustomEvent(CAPTURED_EVENT, { detail }));
const copyMessage = (text) => ({ type: COPY_TYPE, text });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const prefixedErrors = (spy) => spy.mock.calls.filter(([first]) => typeof first === 'string' && first.startsWith(LOG_PREFIX));

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

describe('pending entries (fresh relay per test)', () => {
    it('a string capture with nothing pending right after load is not forwarded; one after notePending() is', async () => {
        const { relay, doc, sent } = evalRelay();

        capture(doc, 'forged text');
        await flush();
        expect(sent, 'capture with no pending entry').toEqual([]);

        relay.notePending();
        capture(doc, 'real text');
        await flush();
        expect(sent, 'positive control').toEqual([copyMessage('real text')]);
    });

    it('a capture exactly 1500 ms after notePending() is not forwarded; one 1499 ms after is', async () => {
        const { relay, doc, sent } = evalRelay();

        relay.notePending();
        vi.setSystemTime(T0 + WINDOW_MS);
        capture(doc, 'at the window end');
        await flush();
        expect(sent, 'capture at the excluded end instant').toEqual([]);

        const t1 = T0 + 60_000;
        vi.setSystemTime(t1);
        relay.notePending();
        vi.setSystemTime(t1 + WINDOW_MS - 1);
        capture(doc, 'inside the window');
        await flush();
        expect(sent, 'positive control').toEqual([copyMessage('inside the window')]);
    });

    it('one pending entry forwards exactly one of two string captures', async () => {
        const { relay, doc, sent } = evalRelay();

        relay.notePending();
        capture(doc, 'first');
        capture(doc, 'second');
        await flush();

        expect(sent).toEqual([copyMessage('first')]);
    });

    it('start() called again after the auto-start keeps a single listener: two pending entries, one capture, one message', async () => {
        const { relay, doc, sent } = evalRelay();

        relay.start();
        relay.notePending();
        relay.notePending();
        capture(doc, 'once');
        await flush();

        expect(sent).toEqual([copyMessage('once')]);
    });
});

describe('load-time dependency check', () => {
    it('loading without DSS_COPY_TO_CLIPBOARD throws an Error naming utils/message-constants.js', () => {
        let thrown;
        try {
            evalRelay({ constant: undefined });
        } catch (error) {
            thrown = error;
        }

        expect(thrown, 'loading must throw').toBeInstanceOf(Error);
        expect(thrown).not.toBeInstanceOf(TypeError);
        expect(String(thrown.message)).toContain('utils/message-constants.js');
    });
});

describe('failures are logged with the module prefix and never escape', () => {
    it.each([
        ['rejects', 'reject'],
        ['throws synchronously', 'throw'],
    ])('sendMessage %s: one prefixed console.error, nothing uncaught, the next capture is still sent', async (_name, mode) => {
        const { relay, doc, sent } = evalRelay({ modes: [mode, 'ok'] });

        relay.notePending();
        expect(() => capture(doc, 'first')).not.toThrow();
        await flush();
        expect(prefixedErrors(errorSpy), JSON.stringify(errorSpy.mock.calls.map(([first]) => first))).toHaveLength(1);

        relay.notePending();
        capture(doc, 'second');
        await flush();
        expect(sent).toEqual([copyMessage('first'), copyMessage('second')]);
        expect(prefixedErrors(errorSpy), 'a successful send logs nothing').toHaveLength(1);
        expect(unhandled, 'unhandled rejections').toEqual([]);
    });

    it('a capture event whose detail cannot be read: one prefixed console.error, dispatch does not throw, the next capture is still sent', async () => {
        const { relay, doc, sent } = evalRelay();
        const hostile = new CustomEvent(CAPTURED_EVENT, { detail: 'unused' });
        Object.defineProperty(hostile, 'detail', { get() { throw new Error('detail getter (hostile page)'); } });

        relay.notePending();
        expect(() => doc.dispatchEvent(hostile)).not.toThrow();
        await flush();
        expect(prefixedErrors(errorSpy), JSON.stringify(errorSpy.mock.calls.map(([first]) => first))).toHaveLength(1);

        capture(doc, 'after the failure');
        await flush();
        expect(sent, 'the pending entry survives the failed handling and the listener stays registered').toEqual([copyMessage('after the failure')]);
    });
});

describe('published API', () => {
    it('without a CommonJS module (browser), loading does not throw and publishes globalThis.DSSAutoCopyRelay', () => {
        let loaded;
        expect(() => { loaded = evalRelay({ module: undefined }); }).not.toThrow();

        expect(typeof loaded.relay?.notePending).toBe('function');
    });

    it('with a CommonJS module, module.exports is the published relay', () => {
        const { relay, module } = evalRelay({ module: { exports: {} } });

        expect(typeof relay?.notePending).toBe('function');
        expect(module.exports).toBe(relay);
    });
});
