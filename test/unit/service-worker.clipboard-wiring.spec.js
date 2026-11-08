/**
 * background/service-worker.js — clipboard route wiring.
 *
 * Requirement (DECISIONS U6-14): the content script sends { type: DSS_COPY_TO_CLIPBOARD, text } to the service worker, which loads background/clipboard-routes.js through importScripts and, at its top level, makes that route live: the worker makes sure an offscreen document exists (chrome.offscreen.createDocument), sends { type: DSS_OFFSCREEN_WRITE_CLIPBOARD, text } to it through chrome.runtime.sendMessage and answers the sender exactly once, { ok: true } when the offscreen page wrote the text; without chrome.offscreen (optional permission not granted) it answers { ok: false, error }.
 *
 * Harness: cloned from test/unit/service-worker.notification-wiring.spec.js. Each test runs the REAL service worker the way Chrome runs it: a fresh vm context acts as the worker global, background/service-worker.js runs in it as a classic script, and its own importScripts() call resolves every requested file relative to background/ and runs it in the same context. Only trust boundaries are faked: chrome.* (in-memory storage, events that record listeners, and an offscreen world for chrome.offscreen plus chrome.runtime.sendMessage / getContexts), fetch and console. The offscreen page is a fake responder reachable only through chrome.runtime.sendMessage once createDocument has finished loading it, as in Chrome. No inter-module boundary is mocked and the suite-wide global from test/setup/vitest.setup.js is never touched.
 *
 * Observable assertions only: the message goes to every chrome.runtime.onMessage listener the worker registered, as Chrome dispatches it, and the test reads back what the offscreen responder received and which responses reached the sender. Chrome drops a sendResponse made after dispatch unless some listener returned true, and the fake dispatcher models that.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, it, expect, vi } from 'vitest';
import { InMemoryStorageMock } from '../fixtures/chrome-storage-mock.js';

const BACKGROUND_DIR = path.resolve(__dirname, '../../background');
const EXTENSION_ORIGIN = 'chrome-extension://test-extension-id/';
const COPY_TYPE = 'DSS_COPY_TO_CLIPBOARD';
const OFFSCREEN_TYPE = 'DSS_OFFSCREEN_WRITE_CLIPBOARD';
const SINGLE_DOC_ERROR = 'Only a single offscreen document may be created.';
const NO_RECEIVER_ERROR = 'Could not establish connection. Receiving end does not exist.';
const TEXT = 'line 1\n  const s = "é中";\n';
const fakeUrl = (p) => EXTENSION_ORIGIN + String(p).replace(/^\//, '');
const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

function createEvent() {
    const listeners = [];
    return { listeners, addListener: (fn) => { listeners.push(fn); }, removeListener: (fn) => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }, hasListener: (fn) => listeners.includes(fn) };
}

/**
 * Fake offscreen trust boundary for one worker. phase is 'none', 'creating' (createDocument called, page still loading) or 'ready'. createDocument while a document exists or loads rejects with Chrome's single-document error; an offscreen-bound message sent before the page is ready rejects with "Receiving end does not exist". The ready page is the fake responder: it records a structured copy of each message of type DSS_OFFSCREEN_WRITE_CLIPBOARD and answers { ok: true }. Other runtime messages have no offscreen receiver and resolve undefined, as the notification-wiring fake does.
 */
function createOffscreenWorld() {
    const world = { phase: 'none', documentUrl: null, createCalls: [], received: [] };
    world.createDocument = (params) => {
        world.createCalls.push(structuredClone(params));
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
        const copy = structuredClone(message);
        await macrotask();
        if (world.phase !== 'ready') throw new Error(NO_RECEIVER_ERROR);
        world.received.push(copy);
        await macrotask();
        return { ok: true };
    }
    /** chrome.runtime.sendMessage, promise form and callback form; lastError exists only while a failing call's callback runs. */
    world.sendMessage = (chrome, ...args) => {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const message = typeof args[0] === 'string' ? args[1] : args[0];
        const result = message?.type === OFFSCREEN_TYPE ? deliver(message) : Promise.resolve(undefined);
        if (!callback) return result;
        result.then((response) => callback(response), (error) => {
            chrome.runtime.lastError = { message: error.message };
            try { callback(); } finally { chrome.runtime.lastError = undefined; }
        });
        return undefined;
    };
    return world;
}

/** Fake chrome.* for one worker. hasOffscreen false models the optional offscreen permission not granted (chrome.offscreen absent). */
function createChrome(world, hasOffscreen) {
    const areas = { local: new InMemoryStorageMock('local'), sync: new InMemoryStorageMock('sync'), session: new InMemoryStorageMock('session') };
    const onChanged = createEvent();
    const fanIn = (changes, area) => onChanged.listeners.forEach((fn) => fn(changes, area));
    Object.values(areas).forEach((a) => a.onChanged.addListener(fanIn));
    const chrome = {
        storage: { ...areas, onChanged },
        runtime: { id: 'test-extension-id', lastError: undefined, getURL: fakeUrl, getContexts: world.getContexts, ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT', SERVICE_WORKER: 'SERVICE_WORKER' }, onMessage: createEvent(), onInstalled: createEvent(), onStartup: createEvent() },
        alarms: { create: vi.fn(), clear: vi.fn(async () => true), get: vi.fn(async () => undefined), onAlarm: createEvent() },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
        windows: { create: vi.fn(async () => ({ id: 1 })), update: vi.fn(async () => ({})), remove: vi.fn(async () => undefined) },
        // Chrome exposes chrome.permissions in every extension service worker (no manifest permission needed); background/permission-intent-routes.js registers onAdded on it at top level.
        permissions: { contains: vi.fn(async () => false), request: vi.fn(async () => false), getAll: vi.fn(async () => ({ permissions: [], origins: [] })), onAdded: createEvent(), onRemoved: createEvent() },
    };
    chrome.runtime.sendMessage = (...args) => world.sendMessage(chrome, ...args);
    if (hasOffscreen) {
        chrome.offscreen = { createDocument: world.createDocument, closeDocument: world.closeDocument, hasDocument: world.hasDocument, Reason: { CLIPBOARD: 'CLIPBOARD', DOM_PARSER: 'DOM_PARSER', BLOBS: 'BLOBS' } };
    }
    return chrome;
}

/** Boots background/service-worker.js in a fresh worker global and returns its fake chrome, the offscreen world and the worker global. A requested script that does not exist throws a named error, so a loader fault cannot pass for a wiring fault. */
function bootServiceWorker({ hasOffscreen = true } = {}) {
    const world = createOffscreenWorld();
    const chrome = createChrome(world, hasOffscreen);
    const worker = {
        chrome,
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        fetch: vi.fn(async () => { throw new Error('network disabled in service-worker.clipboard-wiring.spec.js'); }),
        setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone, crypto,
    };
    vm.createContext(worker);
    worker.self = vm.runInContext('globalThis', worker);
    const runScript = (file) => {
        if (!fs.existsSync(file)) throw new Error('service worker requested ' + path.relative(BACKGROUND_DIR, file) + ', which does not exist');
        vm.runInContext(fs.readFileSync(file, 'utf-8'), worker, { filename: file });
    };
    worker.importScripts = (...urls) => urls.forEach((url) => runScript(path.resolve(BACKGROUND_DIR, url)));
    runScript(path.join(BACKGROUND_DIR, 'service-worker.js'));
    return { chrome, world, worker };
}

/** Delivers a runtime message to every registered onMessage listener the way Chrome does and returns the responses that reach the sender, copied out of the worker realm. Waits until an answer arrives (or the tick budget runs out), then a few more ticks so a duplicate answer would be recorded. */
async function dispatchRuntimeMessage(chrome, message) {
    const responses = [];
    let isDispatching = true;
    let isChannelOpen = false;
    const sendResponse = (payload) => { if (isDispatching || isChannelOpen) responses.push({ ...payload }); };
    const sender = { id: 'test-extension-id', tab: { id: 7, url: 'https://chat.deepseek.com/a/chat/s/aaa-111' } };
    for (const listener of [...chrome.runtime.onMessage.listeners]) {
        if (listener(message, sender, sendResponse) === true) isChannelOpen = true;
    }
    isDispatching = false;
    for (let i = 0; i < 80 && responses.length === 0; i++) await macrotask();
    for (let i = 0; i < 10; i++) await macrotask();
    return responses;
}

const failureShape = (responses) => responses.map((r) => ({ ok: r.ok, hasError: typeof r.error === 'string' && r.error.length > 0 }));

describe('service worker wires the DSS_COPY_TO_CLIPBOARD route', () => {
    it('delivers the text to the offscreen page as DSS_OFFSCREEN_WRITE_CLIPBOARD and answers the sender with exactly one ok:true', async () => {
        const { chrome, world, worker } = bootServiceWorker();
        expect(worker.DSS_COPY_TO_CLIPBOARD, 'utils/message-constants.js must publish DSS_COPY_TO_CLIPBOARD in the worker').toBe(COPY_TYPE);

        const responses = await dispatchRuntimeMessage(chrome, { type: COPY_TYPE, text: TEXT });

        expect(world.received, 'the offscreen responder must receive exactly one message').toHaveLength(1);
        expect(world.received[0]).toMatchObject({ type: OFFSCREEN_TYPE, text: TEXT });
        expect(responses, 'the sender must receive exactly one { ok: true } answer').toEqual([{ ok: true }]);
    });

    it('answers ok false when the offscreen permission is not granted (chrome.offscreen absent), and nothing reaches an offscreen page', async () => {
        const { chrome, world } = bootServiceWorker({ hasOffscreen: false });
        expect(chrome.offscreen, 'precondition: chrome.offscreen is absent').toBeUndefined();

        const responses = await dispatchRuntimeMessage(chrome, { type: COPY_TYPE, text: TEXT });

        expect(failureShape(responses), 'the sender must receive exactly one { ok: false, error } answer').toEqual([{ ok: false, hasError: true }]);
        expect(world.received, 'no offscreen delivery without chrome.offscreen').toHaveLength(0);
    });
});
