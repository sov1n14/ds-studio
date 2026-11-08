/**
 * Trust-boundary doubles for the "flush the editor before closing or navigating its window" scenarios.
 *
 * Doubles: chrome.storage.session, chrome.windows (get / create / update / remove), chrome.tabs (query / update) and chrome.runtime.sendMessage. Everything else (background/editor-window-routes.js, utils/window-control.js, the real editor page from test/helpers/editor-window-harness.js, StorageManager, the in-memory chrome.storage local and sync areas) stays real.
 *
 * Every boundary call lands in one ordered `events` log, so a test can assert that a flush request reached the editor before the window was removed or navigated. windows.remove and tabs.update also record a copy of chrome.storage local and sync taken at the instant of the call, the "persisted at the instant of close" rule of the testing-pitfalls skill.
 *
 * Copy semantics follow the real APIs: session values, runtime messages and runtime responses cross the boundary as structuredClone copies.
 */
import { vi } from 'vitest';

export const NO_RECEIVER_ERROR = 'Could not establish connection. Receiving end does not exist.';
const STEP_MS = 25;

function snapshotStorage() {
    return {
        local: structuredClone(chrome.storage.local._data),
        sync: structuredClone(chrome.storage.sync._data),
    };
}

export function createEditorWindowFlushDoubles() {
    const events = [];
    const sessionData = {};
    const windowsById = new Map();
    const saved = {
        session: chrome.storage.session,
        windowsGet: chrome.windows.get,
        windowsCreate: chrome.windows.create,
        windowsUpdate: chrome.windows.update,
        windowsRemove: chrome.windows.remove,
        tabsQuery: chrome.tabs.query,
        tabsUpdate: chrome.tabs.update,
        sendMessage: chrome.runtime.sendMessage,
    };

    const pick = (keys) => {
        if (keys === null || keys === undefined) return structuredClone(sessionData);
        const list = Array.isArray(keys) ? keys : [keys];
        const result = {};
        list.forEach((key) => { if (key in sessionData) result[key] = structuredClone(sessionData[key]); });
        return result;
    };
    chrome.storage.session = {
        get: vi.fn(async (keys) => pick(keys)),
        set: vi.fn(async (items) => { Object.assign(sessionData, structuredClone(items)); }),
        remove: vi.fn(async (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((key) => { delete sessionData[key]; }); }),
    };
    chrome.windows.get = vi.fn(async (id) => {
        if (!windowsById.has(id)) throw new Error(`No window with id: ${id}.`);
        return structuredClone(windowsById.get(id));
    });
    chrome.windows.create = vi.fn(async (options) => {
        events.push({ kind: 'windows.create', options: structuredClone(options) });
        return { id: 9999, tabs: [{ id: 99990, active: true, windowId: 9999, url: options?.url }] };
    });
    chrome.windows.update = vi.fn(async (id, props) => {
        events.push({ kind: 'windows.update', id, props: structuredClone(props) });
        return { id };
    });
    chrome.windows.remove = vi.fn(async (id) => {
        events.push({ kind: 'windows.remove', id, storage: snapshotStorage() });
        windowsById.delete(id);
    });
    chrome.tabs.query = vi.fn(async (query) => {
        const tabs = [...windowsById.values()].flatMap((w) => w.tabs);
        return structuredClone(tabs.filter((tab) => query?.windowId === undefined || tab.windowId === query.windowId));
    });
    chrome.tabs.update = vi.fn(async (tabId, props) => {
        events.push({ kind: 'tabs.update', tabId, props: structuredClone(props), storage: snapshotStorage() });
        return { id: tabId, ...props };
    });

    /** Register an open window with one active tab showing `url`. */
    function addWindow(windowId, tabId, url) {
        windowsById.set(windowId, { id: windowId, tabs: [{ id: tabId, active: true, windowId, url }] });
    }

    /** Replace chrome.runtime.sendMessage with `impl`; every call is logged first (a synchronous throw from `impl` still propagates to the caller). */
    function installSendMessage(impl) {
        chrome.runtime.sendMessage = vi.fn((message) => {
            events.push({ kind: 'runtime.sendMessage', message: structuredClone(message) });
            return impl(message);
        });
    }

    /**
     * Route chrome.runtime.sendMessage to the onMessage listeners of the open extension pages (the editor window), as Chrome delivers a message from the service worker or the popup.
     * - No page listener at all: the promise rejects with NO_RECEIVER_ERROR.
     * - Delivery is asynchronous (after the current microtask of the sender), and the listener receives a copy of the message.
     * - A listener answers by calling sendResponse synchronously, or by returning true and calling sendResponse later; the first response wins and reaches the sender as a copy.
     * - Listeners exist but none answers synchronously and none returned true: the promise resolves undefined.
     */
    function connectRuntimeBus(getPageListeners, sender = { id: chrome.runtime.id }) {
        installSendMessage((message) => new Promise((resolve, reject) => {
            Promise.resolve().then(() => {
                const listeners = [...getPageListeners()];
                if (listeners.length === 0) { reject(new Error(NO_RECEIVER_ERROR)); return; }
                let isSettled = false;
                let isKeptOpen = false;
                const sendResponse = (response) => {
                    if (isSettled) return;
                    isSettled = true;
                    resolve(response === undefined ? undefined : structuredClone(response));
                };
                for (const listener of listeners) {
                    try {
                        if (listener(structuredClone(message), structuredClone(sender), sendResponse) === true) isKeptOpen = true;
                    } catch (err) {
                        // A throwing listener is an error in the receiving page; Chrome does not forward it to the sender.
                    }
                }
                if (!isSettled && !isKeptOpen) { isSettled = true; resolve(undefined); }
            });
        }));
    }

    const isFlushRequest = (message) => typeof globalThis.DSS_EDITOR_WINDOW?.FLUSH_MESSAGE_TYPE === 'string'
        && message?.type === globalThis.DSS_EDITOR_WINDOW.FLUSH_MESSAGE_TYPE;
    const flushRequests = () => events.filter((e) => e.kind === 'runtime.sendMessage' && isFlushRequest(e.message)).map((e) => e.message);
    const indexOfEvent = (predicate) => events.findIndex(predicate);
    const indexOfFlushRequest = (slot) => indexOfEvent((e) => e.kind === 'runtime.sendMessage' && isFlushRequest(e.message) && e.message.slot === slot);
    const removals = () => events.filter((e) => e.kind === 'windows.remove');
    const navigations = () => events.filter((e) => e.kind === 'tabs.update');
    const focusCalls = () => events.filter((e) => e.kind === 'windows.update' && e.props?.focused === true);

    /** Advance fake time in small steps until predicate() holds or maxMs elapses; returns whether it held. Requires vi.useFakeTimers(). */
    async function advanceUntil(predicate, maxMs) {
        for (let elapsed = 0; elapsed < maxMs; elapsed += STEP_MS) {
            if (predicate()) return true;
            await vi.advanceTimersByTimeAsync(STEP_MS);
        }
        return predicate();
    }

    function restore() {
        if (saved.session === undefined) delete chrome.storage.session; else chrome.storage.session = saved.session;
        chrome.windows.get = saved.windowsGet;
        chrome.windows.create = saved.windowsCreate;
        chrome.windows.update = saved.windowsUpdate;
        chrome.windows.remove = saved.windowsRemove;
        chrome.tabs.query = saved.tabsQuery;
        chrome.tabs.update = saved.tabsUpdate;
        chrome.runtime.sendMessage = saved.sendMessage;
    }

    return {
        events, sessionData, addWindow, installSendMessage, connectRuntimeBus,
        flushRequests, indexOfEvent, indexOfFlushRequest, removals, navigations, focusCalls,
        advanceUntil, restore,
    };
}

/**
 * Every way a flush request can end other than a 'duplicate' answer; each one lets the window close or navigate.
 * Rows: [label, sendMessage implementation, isPrompt]. isPrompt false marks the request that never settles, which only the wait cap of about 1000 ms ends.
 */
export const NON_BLOCKING_FLUSH_OUTCOMES = [
    ['the editor answers clean', () => Promise.resolve({ status: 'clean' }), true],
    ['the editor answers saved', () => Promise.resolve({ status: 'saved' }), true],
    ['the editor answers failed', () => Promise.resolve({ status: 'failed' }), true],
    ['the editor answers timeout', () => Promise.resolve({ status: 'timeout' }), true],
    ['sendMessage resolves undefined (listeners exist, none answered)', () => Promise.resolve(undefined), true],
    ['sendMessage rejects (no receiver)', () => Promise.reject(new Error(NO_RECEIVER_ERROR)), true],
    ['sendMessage throws synchronously', () => { throw new Error('Extension context invalidated.'); }, true],
    ['sendMessage never settles', () => new Promise(() => {}), false],
];
