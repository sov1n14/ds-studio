/**
 * content/runtime-send.js — the guarded fire-and-forget send shared by the auto-copy relay and the reply notification.
 *
 * Contract: the message reaches chrome.runtime.sendMessage once, unchanged; a synchronous throw (extension context invalidated), a rejected promise and a thenable-less return are all absorbed; each failure is logged once as `[DSS] <label>:` followed by the error, and nothing escapes as an uncaught error or unhandled rejection.
 * chrome.runtime.sendMessage is a plain function, never a vi.fn, because a vi.fn marks the promises it returns as handled and would hide a caller that forgets to catch a rejection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../content/runtime-send.js';

const LABEL = 'unit-test-label:送出失敗';
const MESSAGE = { type: 'SOME_TYPE', text: 'payload' };

let errorSpy;
let unhandled;
const onUnhandled = (reason) => unhandled.push(reason);
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

/** Replaces chrome.runtime.sendMessage with `behaviour` and returns the messages it received. */
function stubSend(behaviour) {
    const received = [];
    vi.stubGlobal('chrome', { runtime: { sendMessage: (message) => { received.push(structuredClone(message)); return behaviour(); } } });
    return received;
}

beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('sendAndLogFailure', () => {
    it('delivers the message once and logs nothing when the send resolves', async () => {
        const received = stubSend(() => Promise.resolve({ ok: true }));

        globalThis.DSSRuntimeSend.sendAndLogFailure(MESSAGE, LABEL);
        await flush();

        expect(received).toEqual([MESSAGE]);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(unhandled).toEqual([]);
    });

    it('logs one prefixed line carrying the error when the send rejects, and nothing escapes', async () => {
        const failure = new Error('Could not establish connection. Receiving end does not exist.');
        stubSend(() => Promise.reject(failure));

        expect(() => globalThis.DSSRuntimeSend.sendAndLogFailure(MESSAGE, LABEL)).not.toThrow();
        await flush();

        expect(errorSpy.mock.calls).toEqual([[`[DSS] ${LABEL}:`, failure]]);
        expect(unhandled).toEqual([]);
    });

    it('logs one prefixed line carrying the error when the send throws synchronously, and nothing escapes', async () => {
        const failure = new Error('Extension context invalidated.');
        stubSend(() => { throw failure; });

        expect(() => globalThis.DSSRuntimeSend.sendAndLogFailure(MESSAGE, LABEL)).not.toThrow();
        await flush();

        expect(errorSpy.mock.calls).toEqual([[`[DSS] ${LABEL}:`, failure]]);
        expect(unhandled).toEqual([]);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a plain object without then', {}],
        ['an object whose then is not a function', { then: 1 }],
        ['an object whose catch is not a function', { catch: 1 }],
    ])('returns quietly when the send returns %s', async (_name, returned) => {
        const received = stubSend(() => returned);

        expect(() => globalThis.DSSRuntimeSend.sendAndLogFailure(MESSAGE, LABEL)).not.toThrow();
        await flush();

        expect(received).toEqual([MESSAGE]);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('is published frozen so a consumer cannot replace the helper', () => {
        expect(Object.isFrozen(globalThis.DSSRuntimeSend)).toBe(true);
    });
});
