/**
 * background/route-dispatch.js — the one runtime-message dispatcher every background route file installs through.
 *
 * Contract: DSSRouteDispatch.install(routes, label) registers exactly one chrome.runtime.onMessage listener. For a message whose type is a key of routes the listener returns true (async answer), awaits route(message) and answers { ok: true, ...result } when the route resolves an object, { ok: true } for any other resolved value, and { ok: false, error } when the route rejects or throws synchronously, where error is the error's message when it has a non-empty one and String(error) otherwise; a failing route logs console.error with the first argument `[DSS] <label> <type>:`. A message whose type is not a key of routes (or that is not an object) gets false and no answer, so other onMessage listeners can answer it.
 *
 * Assertions go through the trust boundaries only: the listener return value, the sendResponse payloads and console.error.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../background/route-dispatch.js';

const LABEL = 'demo-routes';
const TYPE = 'DSS_DEMO';

let errorSpy;

/** Installs the routes with chrome.runtime.onMessage.addListener captured and returns the captured listeners. */
function installCapturing(routes) {
    const captured = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { captured.push(fn); });
    try {
        globalThis.DSSRouteDispatch.install(routes, LABEL);
    } finally {
        addSpy.mockRestore();
    }
    return captured;
}

/** Sends one message through the single installed listener and resolves with what the sender received plus the listener return value. */
async function dispatch(routes, message) {
    const [listener] = installCapturing(routes);
    const answers = [];
    const returned = listener(message, {}, (response) => answers.push(response));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return { returned, answers };
}

beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('DSSRouteDispatch.install', () => {
    it('registers exactly one onMessage listener', () => {
        expect(installCapturing({ [TYPE]: async () => {} })).toHaveLength(1);
    });

    it('answers { ok: true } merged with the object a route resolves, and returns true for the async answer', async () => {
        const { returned, answers } = await dispatch({ [TYPE]: async () => ({ uuids: ['a'] }) }, { type: TYPE });
        expect(returned).toBe(true);
        expect(answers).toEqual([{ ok: true, uuids: ['a'] }]);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a string', 'done'],
        ['a number', 7],
    ])('answers a bare { ok: true } when the route resolves %s', async (_name, resolved) => {
        const { answers } = await dispatch({ [TYPE]: async () => resolved }, { type: TYPE });
        expect(answers).toEqual([{ ok: true }]);
    });

    it('hands the received message to the route', async () => {
        const received = [];
        await dispatch({ [TYPE]: async (message) => { received.push(message); } }, { type: TYPE, text: 'x' });
        expect(received).toEqual([{ type: TYPE, text: 'x' }]);
    });

    it('answers the message of a rejected Error and logs it under the label and message type', async () => {
        const failure = new Error('boom');
        const { answers } = await dispatch({ [TYPE]: async () => { throw failure; } }, { type: TYPE });
        expect(answers).toEqual([{ ok: false, error: 'boom' }]);
        expect(errorSpy.mock.calls).toEqual([[`[DSS] ${LABEL} ${TYPE}:`, failure]]);
    });

    it('answers an error for a route that throws synchronously instead of returning a promise', async () => {
        const { answers } = await dispatch({ [TYPE]: () => { throw new TypeError('bad input'); } }, { type: TYPE });
        expect(answers).toEqual([{ ok: false, error: 'bad input' }]);
    });

    it.each([
        ['a thrown string', 'plain text', 'plain text'],
        ['an Error with an empty message', new Error(''), 'Error'],
        ['a thrown undefined', undefined, 'undefined'],
    ])('answers a readable error string for %s', async (_name, thrown, expected) => {
        const { answers } = await dispatch({ [TYPE]: async () => { throw thrown; } }, { type: TYPE });
        expect(answers).toEqual([{ ok: false, error: expected }]);
    });

    it.each([
        ['an unknown type', { type: 'OTHER' }],
        ['a message without a type', {}],
        ['an undefined message', undefined],
        ['a null message', null],
    ])('returns false and leaves %s unanswered so other listeners can handle it', async (_name, message) => {
        const route = vi.fn(async () => {});
        const { returned, answers } = await dispatch({ [TYPE]: route }, message);
        expect(returned).toBe(false);
        expect(answers).toEqual([]);
        expect(route).not.toHaveBeenCalled();
    });
});
