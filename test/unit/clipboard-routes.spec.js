/**
 * background/clipboard-routes.js — service-worker route that writes text to the clipboard through an offscreen document (the content script sends the text to the service worker, which writes it through an offscreen document with reason CLIPBOARD), plus the DSS_COPY_TO_CLIPBOARD message type in utils/message-constants.js.
 *
 * Contract under test (derived from the requirement; the implementation did not exist and was NOT read): the module publishes globalThis.DSSClipboardRoutes = { install }. install() registers one chrome.runtime.onMessage listener. For { type: 'DSS_COPY_TO_CLIPBOARD', text } with string text, the route makes sure one offscreen document exists (chrome.offscreen.createDocument with reasons ['CLIPBOARD'], a url ending in offscreen/clipboard-offscreen.html and a non-empty justification), sends { type: 'DSS_OFFSCREEN_WRITE_CLIPBOARD', text } through chrome.runtime.sendMessage and answers the sender exactly once: { ok: true } when the offscreen page answered { ok: true }, otherwise { ok: false, error: <non-empty string> }. A createDocument rejection saying "Only a single offscreen document may be created" means the document exists. A delivery rejection "Receiving end does not exist" makes the route recreate the document and retry once. A failed message never blocks the next one. Any other message type gets a falsy return value and no answer.
 *
 * Trust boundary: chrome.offscreen and chrome.runtime.sendMessage / getContexts / getURL are replaced by a fake offscreen world (createOffscreenWorld) that follows Chrome's observable rules for one offscreen document: createDocument while a document exists or is still loading rejects with the single-document error, a message sent before the document finished loading rejects with "Receiving end does not exist", and hasDocument / getContexts report only a loaded document. Assertions read only what the fake received and the sendResponse payloads; every test reloads the module through vi.resetModules, so no state carries over between tests.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import messageConstants from '../../utils/message-constants.js';

const MODULE_REL = 'background/clipboard-routes.js';
const MODULE_FILE = path.resolve(__dirname, '../..', MODULE_REL);
const moduleLoaders = import.meta.glob('../../background/clipboard-routes.js');

const COPY_TYPE = 'DSS_COPY_TO_CLIPBOARD';
const OFFSCREEN_TYPE = 'DSS_OFFSCREEN_WRITE_CLIPBOARD';
const OFFSCREEN_PAGE = 'offscreen/clipboard-offscreen.html';
const SINGLE_DOC_ERROR = 'Only a single offscreen document may be created.';
const NO_RECEIVER_ERROR = 'Could not establish connection. Receiving end does not exist.';
const fakeUrl = (p) => 'chrome-extension://test-extension-id/' + String(p).replace(/^\//, '');
const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Fake of the offscreen trust boundary. phase is 'none', 'creating' (createDocument called, page still loading) or 'ready'. Knobs: createFailures queues one-shot createDocument outcomes ({ kind: 'reject' | 'throw', error } or { kind: 'concurrent-creator' }, where another creator wins the race so the document is ready and this call rejects with the single-document error); dropDeliveries makes the next N offscreen messages find the document gone (the send rejects with NO_RECEIVER_ERROR and the document is closed); offscreenAnswer is what the offscreen page answers. Records hold structured copies taken at call time.
 */
function createOffscreenWorld() {
    const world = {
        phase: 'none',
        documentUrl: null,
        createCalls: [],
        deliveries: [],
        deliveryAttempts: 0,
        createFailures: [],
        dropDeliveries: 0,
        offscreenAnswer: () => ({ ok: true }),
    };

    world.createDocument = (params) => {
        world.createCalls.push(structuredClone(params));
        const failure = world.createFailures.shift();
        if (failure?.kind === 'throw') throw failure.error;
        if (failure?.kind === 'reject') return Promise.reject(failure.error);
        if (failure?.kind === 'concurrent-creator') {
            world.phase = 'ready';
            world.documentUrl = fakeUrl(OFFSCREEN_PAGE);
            return Promise.reject(new Error(SINGLE_DOC_ERROR));
        }
        if (world.phase !== 'none') return Promise.reject(new Error(SINGLE_DOC_ERROR));
        world.phase = 'creating';
        const url = String(params?.url ?? '');
        return macrotask().then(() => {
            world.phase = 'ready';
            world.documentUrl = url.startsWith('chrome-extension://') ? url : fakeUrl(url);
        });
    };

    world.closeDocument = () => {
        if (world.phase === 'none') return Promise.reject(new Error('No current offscreen document.'));
        world.phase = 'none';
        world.documentUrl = null;
        return Promise.resolve();
    };

    world.hasDocument = () => Promise.resolve(world.phase === 'ready');

    world.getContexts = (filter = {}) => {
        const isOffscreenWanted = !filter.contextTypes || filter.contextTypes.includes('OFFSCREEN_DOCUMENT');
        const isUrlWanted = !filter.documentUrls || filter.documentUrls.includes(world.documentUrl);
        if (world.phase !== 'ready' || !isOffscreenWanted || !isUrlWanted) return Promise.resolve([]);
        return Promise.resolve([{ contextType: 'OFFSCREEN_DOCUMENT', documentUrl: world.documentUrl }]);
    };

    async function deliver(message) {
        world.deliveryAttempts += 1;
        const copy = structuredClone(message);
        await macrotask();
        if (world.dropDeliveries > 0) {
            world.dropDeliveries -= 1;
            world.phase = 'none';
            world.documentUrl = null;
            throw new Error(NO_RECEIVER_ERROR);
        }
        if (world.phase !== 'ready') throw new Error(NO_RECEIVER_ERROR);
        world.deliveries.push(copy);
        await macrotask();
        return structuredClone(world.offscreenAnswer(copy));
    }

    /** chrome.runtime.sendMessage, promise form and callback form; lastError exists only while a failing call's callback runs. */
    world.sendMessage = (...args) => {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const message = typeof args[0] === 'string' ? args[1] : args[0];
        const result = message?.type === OFFSCREEN_TYPE ? deliver(message) : Promise.reject(new Error(NO_RECEIVER_ERROR));
        if (!callback) return result;
        result.then((response) => callback(response), (error) => {
            chrome.runtime.lastError = { message: error.message };
            try { callback(); } finally { chrome.runtime.lastError = undefined; }
        });
        return undefined;
    };

    return world;
}

/** Installs the world as chrome.offscreen plus the chrome.runtime offscreen surface; returns a restore function. */
function installWorld(world) {
    const saved = { sendMessage: chrome.runtime.sendMessage, getContexts: chrome.runtime.getContexts, ContextType: chrome.runtime.ContextType };
    chrome.offscreen = {
        createDocument: world.createDocument,
        closeDocument: world.closeDocument,
        hasDocument: world.hasDocument,
        Reason: { CLIPBOARD: 'CLIPBOARD', DOM_PARSER: 'DOM_PARSER', BLOBS: 'BLOBS' },
    };
    chrome.runtime.sendMessage = world.sendMessage;
    chrome.runtime.getContexts = world.getContexts;
    chrome.runtime.ContextType = { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT', SERVICE_WORKER: 'SERVICE_WORKER' };
    chrome.runtime.getURL.mockImplementation(fakeUrl);
    return () => {
        delete chrome.offscreen;
        chrome.runtime.sendMessage = saved.sendMessage;
        chrome.runtime.getContexts = saved.getContexts;
        chrome.runtime.ContextType = saved.ContextType;
        chrome.runtime.lastError = undefined;
        chrome.runtime.getURL.mockReset();
    };
}

/** Loads a fresh copy of the module, installs it with chrome.runtime.onMessage.addListener captured and returns the single listener. A missing file, a loader miss and a bad published API are distinct errors, so a broken loader cannot pass for "not implemented yet". */
async function loadRoute() {
    if (!fs.existsSync(MODULE_FILE)) throw new Error(MODULE_REL + ' does not exist (red phase: module not implemented yet)');
    const load = Object.values(moduleLoaders)[0];
    if (!load) throw new Error(MODULE_REL + ' exists but import.meta.glob did not pick it up; fix the glob in clipboard-routes.spec.js');
    delete globalThis.DSSClipboardRoutes;
    vi.resetModules();
    await load();
    if (typeof globalThis.DSSClipboardRoutes?.install !== 'function') throw new Error(MODULE_REL + ' loaded but globalThis.DSSClipboardRoutes.install is not a function (or the module did not re-run after vi.resetModules)');
    const captured = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { captured.push(fn); });
    try {
        globalThis.DSSClipboardRoutes.install();
    } finally {
        addSpy.mockRestore();
    }
    if (captured.length !== 1) throw new Error('install() must register exactly one chrome.runtime.onMessage listener, registered ' + captured.length);
    return captured[0];
}

const SENDER = { id: 'test-extension-id', url: 'https://chat.deepseek.com/a/chat/s/abc', tab: { id: 7 } };

/** Delivers one message to the route the way Chrome does; records each answer (copied) and whether it arrived before the listener returned. */
function dispatch(route, message) {
    const call = { responses: [], returnValue: undefined, hasReturned: false, isAnsweredAfterReturn: false };
    const sendResponse = (response) => {
        call.responses.push(structuredClone(response));
        if (call.hasReturned) call.isAnsweredAfterReturn = true;
    };
    call.returnValue = route(message, SENDER, sendResponse);
    call.hasReturned = true;
    return call;
}

/** Waits until every call has an answer (or the tick budget runs out), then a few more ticks so a duplicate answer would be recorded. */
async function settle(calls, maxTicks = 80) {
    for (let i = 0; i < maxTicks && calls.some((call) => call.responses.length === 0); i++) await macrotask();
    for (let i = 0; i < 5; i++) await macrotask();
}

/** The single answer. An answer sent after the listener returned reaches the sender only when the listener returned true. */
function onlyResponse(call) {
    expect(call.responses, 'the sender must be answered exactly once, got ' + JSON.stringify(call.responses)).toHaveLength(1);
    if (call.isAnsweredAfterReturn) expect(call.returnValue, 'an asynchronous answer needs the listener to return true, or Chrome closes the channel').toBe(true);
    return call.responses[0];
}

function expectOk(call) {
    expect(onlyResponse(call)).toMatchObject({ ok: true });
}

function expectFailure(call) {
    const response = onlyResponse(call);
    expect(response?.ok, 'expected ok:false, got ' + JSON.stringify(response)).toBe(false);
    expect(typeof response.error, 'expected an error string, got ' + JSON.stringify(response)).toBe('string');
    expect(response.error.length, 'error string must not be empty').toBeGreaterThan(0);
}

/** Every createDocument call asks for the clipboard offscreen page with reason CLIPBOARD and a justification. */
function expectClipboardDocumentRequests(world, count) {
    expect(world.createCalls, 'createDocument calls').toHaveLength(count);
    for (const params of world.createCalls) {
        expect(params?.reasons, 'createDocument reasons').toEqual(['CLIPBOARD']);
        expect(typeof params?.url, 'createDocument url').toBe('string');
        expect(params.url.endsWith(OFFSCREEN_PAGE), 'url ' + params.url + ' must end with ' + OFFSCREEN_PAGE).toBe(true);
        expect(typeof params.justification, 'createDocument justification').toBe('string');
        expect(params.justification.trim().length, 'justification must not be empty').toBeGreaterThan(0);
    }
}

const deliveredTexts = (world) => world.deliveries.map((message) => message.text);

describe('DSS_COPY_TO_CLIPBOARD (utils/message-constants.js)', () => {
    it('globalThis.DSS_COPY_TO_CLIPBOARD is the string DSS_COPY_TO_CLIPBOARD', () => {
        expect(globalThis.DSS_COPY_TO_CLIPBOARD, 'globalThis.DSS_COPY_TO_CLIPBOARD is missing').toBe(COPY_TYPE);
    });

    it('module.exports.DSS_COPY_TO_CLIPBOARD equals the global', () => {
        expect(messageConstants.DSS_COPY_TO_CLIPBOARD, 'module.exports.DSS_COPY_TO_CLIPBOARD is missing').toBe(COPY_TYPE);
    });
});

describe('background/clipboard-routes', () => {
    let world;
    let restoreWorld;
    let consoleSpies;

    beforeEach(() => {
        world = createOffscreenWorld();
        restoreWorld = installWorld(world);
        // Silenced: logging is not part of this contract.
        consoleSpies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
    });

    afterEach(() => {
        restoreWorld();
        consoleSpies.forEach((spy) => spy.mockRestore());
    });

    it('success: one CLIPBOARD offscreen document, the offscreen page receives the text verbatim, listener returns true, sender gets exactly one ok:true', async () => {
        const route = await loadRoute();
        const text = 'line 1\n  const s = "é中";\n';

        const call = dispatch(route, { type: COPY_TYPE, text });
        await settle([call]);

        expect(call.returnValue).toBe(true);
        expectClipboardDocumentRequests(world, 1);
        expect(world.deliveries).toHaveLength(1);
        expect(world.deliveries[0]).toMatchObject({ type: OFFSCREEN_TYPE, text });
        expectOk(call);
    });

    it('two messages back to back: createDocument is called once, the offscreen page receives both texts in send order, each sender gets one ok:true', async () => {
        const route = await loadRoute();

        const first = dispatch(route, { type: COPY_TYPE, text: 'first' });
        const second = dispatch(route, { type: COPY_TYPE, text: 'second' });
        await settle([first, second]);

        expectClipboardDocumentRequests(world, 1);
        expect(deliveredTexts(world)).toEqual(['first', 'second']);
        expectOk(first);
        expectOk(second);
    });

    it('createDocument rejects with "Only a single offscreen document may be created" (another creator won the race): the document counts as existing, the text is delivered, ok:true', async () => {
        world.createFailures.push({ kind: 'concurrent-creator' });
        const route = await loadRoute();

        const call = dispatch(route, { type: COPY_TYPE, text: 'raced' });
        await settle([call]);

        expectClipboardDocumentRequests(world, 1);
        expect(deliveredTexts(world)).toEqual(['raced']);
        expectOk(call);
    });

    it('offscreen document left by a previous service-worker lifetime: the text is delivered without a second document, ok:true', async () => {
        world.phase = 'ready';
        world.documentUrl = fakeUrl(OFFSCREEN_PAGE);
        const route = await loadRoute();

        const call = dispatch(route, { type: COPY_TYPE, text: 'reused' });
        await settle([call]);

        expect(world.createCalls.length, 'at most one createDocument attempt (rejected as single-document)').toBeLessThanOrEqual(1);
        expect(deliveredTexts(world)).toEqual(['reused']);
        expectOk(call);
    });

    it('offscreen page answers ok:false: sender gets ok:false with a non-empty error', async () => {
        world.offscreenAnswer = () => ({ ok: false });
        const route = await loadRoute();

        const call = dispatch(route, { type: COPY_TYPE, text: 'denied' });
        await settle([call]);

        expect(deliveredTexts(world)).toEqual(['denied']);
        expectFailure(call);
    });

    it('first send finds no receiving end (document gone): the route recreates the document and retries once, the retry is delivered, ok:true', async () => {
        world.dropDeliveries = 1;
        const route = await loadRoute();

        const call = dispatch(route, { type: COPY_TYPE, text: 'retried' });
        await settle([call]);

        expectClipboardDocumentRequests(world, 2);
        expect(world.deliveryAttempts, 'offscreen sends: the failed one plus one retry').toBe(2);
        expect(deliveredTexts(world)).toEqual(['retried']);
        expectOk(call);
    });

    it('every send finds no receiving end: exactly one retry after recreating, then ok:false with a non-empty error', async () => {
        world.dropDeliveries = Infinity;
        const route = await loadRoute();

        const call = dispatch(route, { type: COPY_TYPE, text: 'lost' });
        await settle([call]);

        expectClipboardDocumentRequests(world, 2);
        expect(world.deliveryAttempts, 'offscreen sends: the failed one plus exactly one retry').toBe(2);
        expectFailure(call);
    });

    it('chrome.offscreen undefined (permission not granted): the listener does not throw, sender gets ok:false with a non-empty error, nothing reaches an offscreen page', async () => {
        delete chrome.offscreen;
        const route = await loadRoute();

        let call;
        expect(() => { call = dispatch(route, { type: COPY_TYPE, text: 'no permission' }); }).not.toThrow();
        await settle([call]);

        expectFailure(call);
        expect(world.deliveryAttempts, 'offscreen sends').toBe(0);
    });

    it.each([
        ['a number', 42],
        ['missing', undefined],
        ['null', null],
        ['an object', { text: 'nested' }],
    ])('text is %s: sender gets ok:false with a non-empty error, nothing is sent to the offscreen page', async (_label, text) => {
        const route = await loadRoute();

        const call = dispatch(route, { type: COPY_TYPE, text });
        await settle([call]);

        expectFailure(call);
        expect(world.deliveryAttempts, 'offscreen sends').toBe(0);
    });

    it.each([
        ['rejects with another error', { kind: 'reject', error: new Error('Failed to load offscreen document') }],
        ['throws synchronously', { kind: 'throw', error: new Error('Invalid offscreen parameters') }],
    ])('createDocument %s: the listener does not throw, sender gets ok:false; a following valid message still succeeds', async (_label, failure) => {
        world.createFailures.push(failure);
        const route = await loadRoute();

        let failed;
        expect(() => { failed = dispatch(route, { type: COPY_TYPE, text: 'during failure' }); }).not.toThrow();
        await settle([failed]);

        expectFailure(failed);
        expect(world.deliveries, 'nothing delivered while the document could not be created').toHaveLength(0);

        const next = dispatch(route, { type: COPY_TYPE, text: 'after failure' });
        await settle([next]);

        expect(deliveredTexts(world)).toEqual(['after failure']);
        expectOk(next);
    });

    it('unknown message type: the listener returns a falsy value and never answers; no document, no offscreen send', async () => {
        const route = await loadRoute();

        const call = dispatch(route, { type: 'DSS_SOME_OTHER_TYPE', text: 'ignored' });
        await settle([call], 20);

        expect(call.returnValue).toBeFalsy();
        expect(call.responses).toHaveLength(0);
        expect(world.createCalls).toHaveLength(0);
        expect(world.deliveryAttempts).toBe(0);
    });
});

describe('loading background/clipboard-routes.js', () => {
    /** Runs the file as a classic script with the given free-variable bindings (new Function parameters shadow the real globals). */
    function evaluate(bindings) {
        if (!fs.existsSync(MODULE_FILE)) throw new Error(MODULE_REL + ' does not exist (red phase: module not implemented yet)');
        const names = Object.keys(bindings);
        new Function(...names, fs.readFileSync(MODULE_FILE, 'utf8'))(...names.map((name) => bindings[name]));
    }

    it('no module system (service worker importScripts): loads without throwing and publishes DSSClipboardRoutes.install on globalThis', () => {
        const globals = {};

        evaluate({ globalThis: globals, module: undefined });

        expect(globals.DSSClipboardRoutes?.install).toBeTypeOf('function');
    });

    it('CommonJS: module.exports is the published DSSClipboardRoutes object', () => {
        const globals = {};
        const module = { exports: {} };

        evaluate({ globalThis: globals, module });

        expect(module.exports.install).toBeTypeOf('function');
        expect(module.exports).toBe(globals.DSSClipboardRoutes);
    });
});
