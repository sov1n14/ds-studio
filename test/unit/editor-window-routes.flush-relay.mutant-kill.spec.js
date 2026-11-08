/**
 * background/editor-window-routes.js — how install() finds the flush request channel in each load context, and that the close route it registers really closes the tracked editor windows.
 *
 * Requirements (file header of the route module; docs/ARCHITECTURE.md "Editor Window Auto-Close"; docs/architecture/POPUP.md "Flush requests"):
 *  - The service worker loads the route with importScripts after utils/editor-flush-channel.js, so the route takes requestEditorFlush from globalThis.DSSEditorFlushChannel. A classic importScripts context has no `require`; when the channel global is missing there, install() throws the named load-order error that names utils/editor-flush-channel.js, and registers no listener.
 *  - Node.js tests load the route with require, and the route requires the channel module itself.
 *  - DSS_CLOSE_EDITOR_WINDOWS: for each editor-window id stored in chrome.storage.session, send DSS_FLUSH_EDITOR_WINDOW { slot } first, then chrome.windows.remove() the window and remove its key; reply { ok: true }.
 *
 * Load per test: every test loads a fresh copy of the route module inside the test body, so install() (and the route table it builds) runs while the test is active.
 *  - The importScripts context is reproduced by evaluating the module file in a function whose `require` and `module` parameters are undefined, the only way to run the module where `require` does not exist. The file is executed, never matched as text.
 *  - The Node context deletes the module from require.cache and requires it again.
 *
 * Trust boundaries only: chrome.runtime.onMessage.addListener (captures the listener), chrome.runtime.sendMessage (the editor page answering the flush request), chrome.windows.remove and chrome.storage.session (in-memory, structuredClone on the way in and out). The real utils/editor-flush-channel.js and utils/message-constants.js run unmocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const ROUTES_PATH = require.resolve('../../background/editor-window-routes.js');
const CHANNEL_PATH = require.resolve('../../utils/editor-flush-channel.js');
const { STORAGE_KEYS, CLOSE_MESSAGE_TYPE, FLUSH_MESSAGE_TYPE, FLUSH_STATUS } = globalThis.DSS_EDITOR_WINDOW;

/** Evaluate the route file the way importScripts does: classic script, no `require`, no `module`. Returns the published install(). */
function loadAsServiceWorkerScript() {
    delete globalThis.DSSEditorWindowRoutes;
    new Function('require', 'module', 'exports', readFileSync(ROUTES_PATH, 'utf8'))(undefined, undefined, undefined);
    return globalThis.DSSEditorWindowRoutes.install;
}

/** Load the route through Node require after dropping its cached copy. Returns the exported install(). */
function loadWithFreshRequire() {
    delete require.cache[ROUTES_PATH];
    return require('../../background/editor-window-routes.js').install;
}

let savedRoutesGlobal;
let savedChannelGlobal;
let savedSendMessage;
let listeners;
let addListenerSpy;
let sessionData;
/** Ordered record of what crossed the trust boundaries: ['flush', slot] and ['remove', windowId, keysStillStored]. */
let boundaryLog;

beforeEach(() => {
    savedRoutesGlobal = globalThis.DSSEditorWindowRoutes;
    savedChannelGlobal = globalThis.DSSEditorFlushChannel;
    savedSendMessage = chrome.runtime.sendMessage;
    listeners = [];
    boundaryLog = [];
    addListenerSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { listeners.push(fn); });

    sessionData = {};
    chrome.storage.session = {
        get: vi.fn(async (keys) => {
            const result = {};
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => { if (key in sessionData) result[key] = structuredClone(sessionData[key]); });
            return result;
        }),
        set: vi.fn(async (items) => { Object.assign(sessionData, structuredClone(items)); }),
        remove: vi.fn(async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((key) => { delete sessionData[key]; }); }),
    };
    chrome.windows.remove = vi.fn(async (windowId) => { boundaryLog.push(['remove', windowId, Object.keys(sessionData).sort()]); });
    // The editor page answering the flush request: it saved its pending edits.
    chrome.runtime.sendMessage = vi.fn(async (message) => {
        if (message?.type === FLUSH_MESSAGE_TYPE) {
            boundaryLog.push(['flush', message.slot]);
            return { status: FLUSH_STATUS.SAVED };
        }
        return undefined;
    });
});

afterEach(() => {
    addListenerSpy.mockRestore();
    chrome.runtime.sendMessage = savedSendMessage;
    delete chrome.storage.session;
    delete chrome.windows.remove;
    if (savedRoutesGlobal) globalThis.DSSEditorWindowRoutes = savedRoutesGlobal; else delete globalThis.DSSEditorWindowRoutes;
    if (savedChannelGlobal) globalThis.DSSEditorFlushChannel = savedChannelGlobal; else delete globalThis.DSSEditorFlushChannel;
    delete require.cache[ROUTES_PATH];
});

/** Deliver a message to the captured listener and resolve with its sendResponse payload. */
function dispatch(message) {
    expect(listeners, 'install() registered exactly one chrome.runtime.onMessage listener').toHaveLength(1);
    return new Promise((resolve) => {
        const isAsync = listeners[0](message, { id: 'test-extension-id' }, resolve);
        expect(isAsync, 'the close route answers asynchronously (listener returns true)').toBe(true);
    });
}

describe('editor-window-routes flush channel lookup and close relay', () => {
    it('service-worker context without the channel global: install() throws the named load-order error, not a require or null-access error, and registers no listener', () => {
        delete globalThis.DSSEditorFlushChannel;
        const install = loadAsServiceWorkerScript();

        let thrown;
        try {
            install();
        } catch (err) {
            thrown = err;
        }

        expect(thrown, 'install() throws when the channel global is missing and require does not exist').toBeInstanceOf(Error);
        expect(thrown.message, 'the error names the missing global').toContain('DSSEditorFlushChannel');
        expect(thrown.message, 'the error names the file to importScripts before the route').toContain('utils/editor-flush-channel.js');
        expect(listeners, 'listeners registered by a failed install()').toHaveLength(0);
    });

    it('service-worker context with the channel global (loader control): install() registers the route, and DSS_CLOSE_EDITOR_WINDOWS flushes then closes the tracked window', async () => {
        globalThis.DSSEditorFlushChannel = require('../../utils/editor-flush-channel.js');
        const install = loadAsServiceWorkerScript();
        sessionData[STORAGE_KEYS.preset] = 42;

        expect(() => install(), 'install() with the channel global present').not.toThrow();
        const response = await dispatch({ type: CLOSE_MESSAGE_TYPE });

        expect(response, 'close route reply').toEqual({ ok: true });
        expect(boundaryLog, 'flush request for the preset editor, then removal of window 42 while its key was still stored').toEqual([
            ['flush', 'preset'],
            ['remove', 42, [STORAGE_KEYS.preset]],
        ]);
        expect(sessionData, 'session storage after the close: the tracked id is gone').toEqual({});
    });

    it('Node context (fresh require): DSS_CLOSE_EDITOR_WINDOWS asks each tracked editor to save, closes both windows and clears both keys', async () => {
        delete globalThis.DSSEditorFlushChannel;
        delete require.cache[CHANNEL_PATH];
        const install = loadWithFreshRequire();
        sessionData[STORAGE_KEYS.global] = 7;
        sessionData[STORAGE_KEYS.preset] = 8;

        install();
        const response = await dispatch({ type: CLOSE_MESSAGE_TYPE });

        expect(response, 'close route reply').toEqual({ ok: true });
        const flushes = boundaryLog.filter(([kind]) => kind === 'flush').map(([, slot]) => slot).sort();
        const removedIds = boundaryLog.filter(([kind]) => kind === 'remove').map(([, id]) => id).sort();
        expect(flushes, 'flush requests sent, one per tracked slot').toEqual(['global', 'preset']);
        expect(removedIds, 'windows closed').toEqual([7, 8]);
        for (const [slot, id] of [['global', 7], ['preset', 8]]) {
            const flushAt = boundaryLog.findIndex(([kind, value]) => kind === 'flush' && value === slot);
            const removeAt = boundaryLog.findIndex(([kind, value]) => kind === 'remove' && value === id);
            expect(flushAt, 'flush request for ' + slot + ' precedes the removal of window ' + id).toBeLessThan(removeAt);
        }
        expect(sessionData, 'session storage after the close: both tracked ids are gone').toEqual({});
    });
});
