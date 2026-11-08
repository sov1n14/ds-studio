/**
 * utils/editor-flush-channel.js evaluated fresh inside every test, so the CommonJS export guard, the chrome.runtime guard and the constants check are attributed to the test that observes them.
 *
 * Contract (file header and JSDoc): requestEditorFlush(slot) sends { type: FLUSH_MESSAGE_TYPE, slot } and resolves the status the editor answered; a rejection, a synchronous throw, a missing reply or no reply within about 1 s all resolve undefined, and no timer stays pending once it settles. listenForFlushRequests(slot, answerFlush) registers nothing outside an extension context (no chrome.runtime); its listener answers only its own slot's flush request, keeps the channel open (returns true) for it and replies { status }, returns false for any other message, and a rejected answerFlush is logged on the '[DSS]' prefix and still answered with FLUSH_STATUS.FAILED. Missing DSS_EDITOR_WINDOW flush constants throw an Error naming utils/message-constants.js. The channel is published on globalThis.DSSEditorFlushChannel and, where CommonJS `module` exists, on module.exports.
 *
 * Sandbox: the source runs through new Function in this realm with globalThis, chrome and module passed as parameters; globalThis is an object inheriting the real global, so Stryker's namespace and the setup's DSS_EDITOR_WINDOW stay reachable while a test can shadow chrome or the constants with an own property. chrome is a plain trust-boundary double per test.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MODULE_FILE = path.resolve(__dirname, '../../utils/editor-flush-channel.js');
const { FLUSH_MESSAGE_TYPE, FLUSH_STATUS } = globalThis.DSS_EDITOR_WINDOW;
const NO_RECEIVER_ERROR = 'Could not establish connection. Receiving end does not exist.';
const MISSING_CONSTANTS = /DSS_EDITOR_WINDOW[\s\S]*utils\/message-constants\.js/;
const ABOUT_ONE_SECOND_MS = 1100;

/** chrome double: sendMessage runs `send` (default: never settles); onMessage collects listeners. */
function makeChrome(send = () => new Promise(() => {})) {
    const listeners = [];
    const sent = [];
    const chrome = {
        runtime: {
            sendMessage: (message) => { sent.push(structuredClone(message)); return send(message); },
            onMessage: { addListener: (fn) => { listeners.push(fn); } },
        },
    };
    return { chrome, listeners, sent };
}

/**
 * Evaluate the source fresh. Options use 'in' checks so an explicit undefined reaches the sandbox.
 * - chrome: the free `chrome` binding and globalThis.chrome (undefined = no extension API at all).
 * - constants: own globalThis.DSS_EDITOR_WINDOW (omit to inherit the real one).
 * - module: the CommonJS binding (undefined = classic script / importScripts, no module system).
 */
function evaluate(options = {}) {
    const sandboxGlobal = Object.create(globalThis);
    const chrome = 'chrome' in options ? options.chrome : makeChrome().chrome;
    Object.defineProperty(sandboxGlobal, 'chrome', { value: chrome, writable: true, configurable: true });
    if ('constants' in options) Object.defineProperty(sandboxGlobal, 'DSS_EDITOR_WINDOW', { value: options.constants, writable: true, configurable: true });
    const module = 'module' in options ? options.module : { exports: {} };
    new Function('globalThis', 'chrome', 'module', fs.readFileSync(MODULE_FILE, 'utf8'))(sandboxGlobal, chrome, module);
    return { channel: sandboxGlobal.DSSEditorFlushChannel, module };
}

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

/** Invoke a registered listener as Chrome does; record its return value and every sendResponse call. */
function deliver(listener, message) {
    const responses = [];
    const returnValue = listener(message, { id: 'test-extension-id' }, (response) => { responses.push(response); });
    return { returnValue, responses };
}

let errorSpy;
let unhandled;
const onUnhandled = (reason) => unhandled.push(reason);

beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('requestEditorFlush: what the caller receives', () => {
    beforeEach(() => { vi.useFakeTimers(); });

    it('a prompt reply resolves its status, sends the slot request once, and leaves no timer pending', async () => {
        let answer;
        const { chrome, sent } = makeChrome(() => new Promise((resolve) => { answer = resolve; }));
        const { channel } = evaluate({ chrome });

        const pending = channel.requestEditorFlush('preset');
        await settle();
        expect(vi.getTimerCount(), 'the reply wait is armed while the editor has not answered').toBeGreaterThan(0);
        answer({ status: FLUSH_STATUS.SAVED });

        await expect(pending).resolves.toBe(FLUSH_STATUS.SAVED);
        expect(sent).toEqual([{ type: FLUSH_MESSAGE_TYPE, slot: 'preset' }]);
        expect(vi.getTimerCount(), 'no reply-wait timer left after the reply').toBe(0);
    });

    it.each([
        ['sendMessage rejects (no receiver)', () => Promise.reject(new Error(NO_RECEIVER_ERROR))],
        ['sendMessage throws synchronously', () => { throw new Error('Extension context invalidated.'); }],
        ['sendMessage resolves undefined (no listener answered)', () => Promise.resolve(undefined)],
        ['sendMessage resolves null', () => Promise.resolve(null)],
    ])('%s: resolves undefined (never rejects) and leaves no timer pending', async (_label, send) => {
        const { chrome } = makeChrome(send);
        const { channel } = evaluate({ chrome });

        await expect(channel.requestEditorFlush('global')).resolves.toBeUndefined();
        expect(vi.getTimerCount(), 'no reply-wait timer left after settling').toBe(0);
    });

    it('no reply at all: resolves undefined within about one second and leaves no timer pending', async () => {
        const { chrome } = makeChrome(() => new Promise(() => {}));
        const { channel } = evaluate({ chrome });
        let outcome = null;
        channel.requestEditorFlush('global').then((status) => { outcome = { status }; });

        await vi.advanceTimersByTimeAsync(ABOUT_ONE_SECOND_MS);

        expect(outcome).toEqual({ status: undefined });
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('flush constants missing', () => {
    it.each([
        ['DSS_EDITOR_WINDOW undefined', undefined],
        ['FLUSH_STATUS missing', { FLUSH_MESSAGE_TYPE }],
        ['FLUSH_MESSAGE_TYPE missing', { FLUSH_STATUS }],
    ])('%s: requestEditorFlush rejects with the error naming utils/message-constants.js and sends nothing', async (_label, constants) => {
        const { chrome, sent } = makeChrome(() => Promise.resolve({ status: FLUSH_STATUS.SAVED }));
        const { channel } = evaluate({ chrome, constants });

        await expect(channel.requestEditorFlush('global')).rejects.toThrow(MISSING_CONSTANTS);
        expect(sent).toEqual([]);
    });

    it('DSS_EDITOR_WINDOW undefined in an extension context: listenForFlushRequests throws the same error and registers nothing', () => {
        const { chrome, listeners } = makeChrome();
        const { channel } = evaluate({ chrome, constants: undefined });

        expect(() => channel.listenForFlushRequests('global', async () => FLUSH_STATUS.SAVED)).toThrow(MISSING_CONSTANTS);
        expect(listeners).toHaveLength(0);
    });
});

describe('listenForFlushRequests: outside an extension context', () => {
    it.each([
        ['no chrome at all', undefined],
        ['chrome without runtime (a regular web page in Chrome)', {}],
        ['chrome.runtime without onMessage', { runtime: {} }],
    ])('%s: returns without throwing', (_label, chrome) => {
        const { channel } = evaluate({ chrome });

        expect(() => channel.listenForFlushRequests('global', async () => FLUSH_STATUS.SAVED)).not.toThrow();
    });
});

describe('listenForFlushRequests: the registered listener (chrome.runtime.onMessage contract)', () => {
    function register(answerFlush) {
        const { chrome, listeners } = makeChrome();
        const { channel } = evaluate({ chrome });
        channel.listenForFlushRequests('global', answerFlush);
        expect(listeners, 'exactly one onMessage listener registered').toHaveLength(1);
        return listeners[0];
    }

    it('its own slot: keeps the channel open (returns true) and answers { status } from answerFlush', async () => {
        const listener = register(async () => FLUSH_STATUS.DUPLICATE);

        const call = deliver(listener, { type: FLUSH_MESSAGE_TYPE, slot: 'global' });
        await settle();

        expect(call.returnValue).toBe(true);
        expect(call.responses).toEqual([{ status: FLUSH_STATUS.DUPLICATE }]);
    });

    it.each([
        ['another message type for the same slot', { type: globalThis.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE, slot: 'global' }],
        ['a flush request for another slot', { type: FLUSH_MESSAGE_TYPE, slot: 'preset' }],
        ['a null message', null],
        ['an undefined message', undefined],
    ])('%s: returns false without throwing and never answers', async (_label, message) => {
        const listener = register(async () => FLUSH_STATUS.SAVED);

        let call;
        expect(() => { call = deliver(listener, message); }).not.toThrow();
        await settle();

        expect(call.returnValue).toBe(false);
        expect(call.responses).toEqual([]);
    });

    it('answerFlush rejects: logs the error on the [DSS] prefix, answers FLUSH_STATUS.FAILED, and nothing escapes as unhandled', async () => {
        const failure = new Error('storage write failed');
        const listener = register(() => Promise.reject(failure));

        const call = deliver(listener, { type: FLUSH_MESSAGE_TYPE, slot: 'global' });
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(call.returnValue).toBe(true);
        expect(call.responses).toEqual([{ status: FLUSH_STATUS.FAILED }]);
        const logged = errorSpy.mock.calls.filter(([first]) => typeof first === 'string' && first.startsWith('[DSS]'));
        expect(logged.map((args) => args.includes(failure))).toEqual([true]);
        expect(unhandled).toEqual([]);
    });
});

describe('loading utils/editor-flush-channel.js', () => {
    it('no module system (classic script or importScripts): loads without throwing and publishes both functions on globalThis', () => {
        let result;
        expect(() => { result = evaluate({ module: undefined }); }).not.toThrow();

        expect(result.channel.requestEditorFlush).toBeTypeOf('function');
        expect(result.channel.listenForFlushRequests).toBeTypeOf('function');
    });

    it('CommonJS: module.exports is the published DSSEditorFlushChannel object', () => {
        const { channel, module } = evaluate({ module: { exports: {} } });

        expect(module.exports).toBe(channel);
        expect(module.exports.requestEditorFlush).toBeTypeOf('function');
    });
});
