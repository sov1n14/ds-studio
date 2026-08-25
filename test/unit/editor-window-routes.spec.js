/**
 * background/editor-window-routes.js -- SW message route that closes the
 * editor-window popups (global / preset) tracked in chrome.storage.session.
 *
 * Contract under test (derived from the requirements; the implementation
 * does not exist yet and was NOT read):
 *  - install() registers exactly ONE chrome.runtime.onMessage listener.
 *  - For { type: DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE } it returns true
 *    (async response), reads BOTH session keys
 *    (DSS_EDITOR_WINDOW.STORAGE_KEYS.global / .preset); for each key holding
 *    a numeric window id it calls chrome.windows.remove(id) and removes that
 *    key from chrome.storage.session -- a rejection from windows.remove for
 *    one id MUST NOT block removal of that key nor handling of the other id.
 *    When neither key is set, chrome.windows.remove is never called.
 *    It always finishes with sendResponse({ ok: true }).
 *  - For any other message type it returns false and touches neither
 *    chrome.windows nor chrome.storage.session.
 *
 * Assertions go through OBSERVABLE state: the in-memory session storage
 * object and the chrome.windows.remove call arguments, plus the exact
 * sendResponse payload and the listener's own return value -- not through
 * "was some internal helper called".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

let listener;

beforeAll(async () => {
    const captured = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener')
        .mockImplementation((fn) => { captured.push(fn); });

    // Dynamic import: a static import is hoisted above the spy above.
    await import('../../utils/editor-window-constants.js');
    await import('../../background/editor-window-routes.js');
    globalThis.DSSEditorWindowRoutes.install();

    addSpy.mockRestore();
    listener = captured[0];
});

/** Drain the route's promise chains. */
const flush = async (ticks = 8) => {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
};

let sessionData;

beforeEach(() => {
    // The shared vitest chrome mock has no `session` storage area and no
    // `windows.remove` stub (test/setup/vitest.setup.js) -- both installed here.
    sessionData = {};
    chrome.storage.session = {
        get: vi.fn((keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const result = {};
            list.forEach((key) => { if (key in sessionData) result[key] = sessionData[key]; });
            return Promise.resolve(result);
        }),
        set: vi.fn((obj) => {
            Object.assign(sessionData, obj);
            return Promise.resolve();
        }),
        remove: vi.fn((keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            list.forEach((key) => { delete sessionData[key]; });
            return Promise.resolve();
        }),
    };
    chrome.windows.remove = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
    delete chrome.storage.session;
});

/** Invoke the route listener directly; returns its value and the response spy. */
async function send(message) {
    const sendResponse = vi.fn();
    const result = listener(message, { id: 'test-extension-id' }, sendResponse);
    await flush();
    return { result, sendResponse };
}

const firstResponse = (sendResponse) => sendResponse.mock.calls[0][0];

describe('background/editor-window-routes', () => {
    it('registers exactly one chrome.runtime.onMessage listener', () => {
        expect(typeof listener).toBe('function');
    });

    it('both ids stored: removes both windows by their exact stored ids, removes both keys, responds ok:true, returns true', async () => {
        const KEYS = globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS;
        sessionData[KEYS.global] = 111;
        sessionData[KEYS.preset] = 222;

        const { result, sendResponse } = await send({ type: globalThis.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE });

        expect(result).toBe(true);
        expect(chrome.windows.remove).toHaveBeenCalledWith(111);
        expect(chrome.windows.remove).toHaveBeenCalledWith(222);
        expect(sessionData).not.toHaveProperty(KEYS.global);
        expect(sessionData).not.toHaveProperty(KEYS.preset);
        expect(firstResponse(sendResponse)).toEqual({ ok: true });
    });

    it('only preset id stored: removes only that window, removes only that key, responds ok:true', async () => {
        const KEYS = globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS;
        sessionData[KEYS.preset] = 333;

        const { sendResponse } = await send({ type: globalThis.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE });

        expect(chrome.windows.remove).toHaveBeenCalledTimes(1);
        expect(chrome.windows.remove).toHaveBeenCalledWith(333);
        expect(sessionData).not.toHaveProperty(KEYS.preset);
        expect(firstResponse(sendResponse)).toEqual({ ok: true });
    });

    it('no ids stored: chrome.windows.remove is never called, responds ok:true', async () => {
        const { sendResponse } = await send({ type: globalThis.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE });

        expect(chrome.windows.remove).not.toHaveBeenCalled();
        expect(firstResponse(sendResponse)).toEqual({ ok: true });
    });

    it('one windows.remove rejects: its key is still removed, the other stored id is still removed, responds ok:true', async () => {
        const KEYS = globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS;
        sessionData[KEYS.global] = 444;
        sessionData[KEYS.preset] = 555;
        chrome.windows.remove = vi.fn((id) => (
            id === 444 ? Promise.reject(new Error('window already gone')) : Promise.resolve()
        ));

        const { sendResponse } = await send({ type: globalThis.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE });

        expect(chrome.windows.remove).toHaveBeenCalledWith(444);
        expect(chrome.windows.remove).toHaveBeenCalledWith(555);
        expect(sessionData).not.toHaveProperty(KEYS.global);
        expect(sessionData).not.toHaveProperty(KEYS.preset);
        expect(firstResponse(sendResponse)).toEqual({ ok: true });
    });

    it('unknown message type: listener returns false, no windows.remove call, stored key survives untouched', async () => {
        sessionData[globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS.global] = 999;

        const { result, sendResponse } = await send({ type: 'DSS_SOME_OTHER_TYPE' });

        expect(result).toBe(false);
        expect(chrome.windows.remove).not.toHaveBeenCalled();
        expect(sessionData).toHaveProperty(globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS.global, 999);
        expect(sendResponse).not.toHaveBeenCalled();
    });
});
