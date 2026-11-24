/**
 * background/service-worker.js — desktop-notification route wiring.
 *
 * Requirement (docs/spec/04-features.md §27, docs/ARCHITECTURE.md "Reply Notification Message Route"): the service worker loads background/notification-routes.js through importScripts and, at its top level, makes the DSS_SHOW_NOTIFICATION route live, so a { type: DSS_SHOW_NOTIFICATION, title, body } runtime message with string title and body shows a basic notification (icon assets/icons/icon128.png) through chrome.notifications.create and answers { ok: true }; a non-string title or body, a missing chrome.notifications (optional permission not granted) or a rejected create answers { ok: false, error }.
 *
 * Harness: each test runs the REAL service worker the way Chrome runs it: a fresh vm context acts as the worker global, background/service-worker.js runs in it as a classic script, and its own importScripts() call resolves every requested file relative to background/ and runs it in the same context, so top-level declarations are shared exactly as in a classic worker. Only trust boundaries are faked: chrome.* (in-memory storage, events that record listeners, notifications), fetch and console. No inter-module boundary is mocked and the suite-wide global from test/setup/vitest.setup.js is never touched.
 *
 * Observable assertions only: the message goes to every chrome.runtime.onMessage listener the worker registered, as Chrome dispatches it, and the test reads back what chrome.notifications.create received and which responses reached the sender. Chrome drops a sendResponse made after dispatch unless some listener returned true, and the fake dispatcher models that.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, it, expect, vi } from 'vitest';
import { InMemoryStorageMock } from '../fixtures/chrome-storage-mock.js';

const BACKGROUND_DIR = path.resolve(__dirname, '../../background');
const EXTENSION_ORIGIN = 'chrome-extension://test-extension-id/';
const ICON_PATH = 'assets/icons/icon128.png';
const TITLE = 'DeepSeek reply complete';
const BODY = 'The reply has finished generating';

function createEvent() {
    const listeners = [];
    return { listeners, addListener: (fn) => { listeners.push(fn); }, removeListener: (fn) => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }, hasListener: (fn) => listeners.includes(fn) };
}

/** Fake chrome.* for one worker. A null notificationsCreate models the optional notifications permission not granted (chrome.notifications absent). */
function createChrome(notificationsCreate) {
    const areas = { local: new InMemoryStorageMock('local'), sync: new InMemoryStorageMock('sync'), session: new InMemoryStorageMock('session') };
    const onChanged = createEvent();
    const fanIn = (changes, area) => onChanged.listeners.forEach((fn) => fn(changes, area));
    Object.values(areas).forEach((a) => a.onChanged.addListener(fanIn));
    const chrome = {
        storage: { ...areas, onChanged },
        runtime: { id: 'test-extension-id', lastError: undefined, getURL: (p) => EXTENSION_ORIGIN + p, sendMessage: vi.fn(async () => undefined), onMessage: createEvent(), onInstalled: createEvent(), onStartup: createEvent() },
        alarms: { create: vi.fn(), clear: vi.fn(async () => true), get: vi.fn(async () => undefined), onAlarm: createEvent() },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
        windows: { create: vi.fn(async () => ({ id: 1 })), update: vi.fn(async () => ({})), remove: vi.fn(async () => undefined) },
        // Chrome exposes chrome.permissions in every extension service worker (no manifest permission needed); background/permission-intent-routes.js registers onAdded on it at top level.
        permissions: { contains: vi.fn(async () => false), request: vi.fn(async () => false), getAll: vi.fn(async () => ({ permissions: [], origins: [] })), onAdded: createEvent(), onRemoved: createEvent() },
    };
    if (notificationsCreate) chrome.notifications = { create: notificationsCreate };
    return chrome;
}

/** Boots background/service-worker.js in a fresh worker global and returns its fake chrome and the worker global. A requested script that does not exist throws a named error, so a loader fault cannot pass for a wiring fault. */
function bootServiceWorker(notificationsCreate) {
    const chrome = createChrome(notificationsCreate);
    const worker = {
        chrome,
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        fetch: vi.fn(async () => { throw new Error('network disabled in service-worker.notification-wiring.spec.js'); }),
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
    return { chrome, worker };
}

const flush = async (ticks = 10) => {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Delivers a runtime message to every registered onMessage listener the way Chrome does and returns the responses that reach the sender, copied out of the worker realm. */
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
    await flush();
    return responses;
}

/** The single NotificationOptions object chrome.notifications.create received, copied out of the worker realm. */
function onlyCreatedOptions(create) {
    expect(create, 'chrome.notifications.create must be called exactly once').toHaveBeenCalledTimes(1);
    const options = create.mock.calls[0].find((arg) => arg && typeof arg === 'object');
    expect(options, 'chrome.notifications.create must receive a NotificationOptions object').toBeTruthy();
    return { ...options };
}

const failureShape = (responses) => responses.map((r) => ({ ok: r.ok, hasError: typeof r.error === 'string' && r.error.length > 0 }));

describe('service worker wires the DSS_SHOW_NOTIFICATION route', () => {
    it('shows a basic notification with the message title and body and answers ok', async () => {
        const create = vi.fn(async () => 'notification-id');
        const { chrome, worker } = bootServiceWorker(create);
        expect(worker.DSS_SHOW_NOTIFICATION, 'utils/message-constants.js must publish DSS_SHOW_NOTIFICATION in the worker').toBe('DSS_SHOW_NOTIFICATION');

        const responses = await dispatchRuntimeMessage(chrome, { type: worker.DSS_SHOW_NOTIFICATION, title: TITLE, body: BODY });

        expect(onlyCreatedOptions(create)).toMatchObject({ type: 'basic', iconUrl: EXTENSION_ORIGIN + ICON_PATH, title: TITLE, message: BODY });
        expect(responses, 'the sender must receive exactly one { ok: true } answer').toEqual([{ ok: true }]);
    });

    it('answers ok false without creating a notification when the title is not a string', async () => {
        const create = vi.fn(async () => 'notification-id');
        const { chrome } = bootServiceWorker(create);

        const responses = await dispatchRuntimeMessage(chrome, { type: 'DSS_SHOW_NOTIFICATION', title: 42, body: BODY });

        expect(create).not.toHaveBeenCalled();
        expect(failureShape(responses), 'the sender must receive exactly one { ok: false, error } answer').toEqual([{ ok: false, hasError: true }]);
    });

    it('answers ok false when the notifications permission is not granted (chrome.notifications absent)', async () => {
        const { chrome } = bootServiceWorker(null);
        expect(chrome.notifications, 'precondition: chrome.notifications is absent').toBeUndefined();

        const responses = await dispatchRuntimeMessage(chrome, { type: 'DSS_SHOW_NOTIFICATION', title: TITLE, body: BODY });

        expect(failureShape(responses), 'the sender must receive exactly one { ok: false, error } answer').toEqual([{ ok: false, hasError: true }]);
    });

    it('answers ok false when chrome.notifications.create rejects', async () => {
        const create = vi.fn(async () => { throw new Error('Unable to show notification'); });
        const { chrome } = bootServiceWorker(create);

        const responses = await dispatchRuntimeMessage(chrome, { type: 'DSS_SHOW_NOTIFICATION', title: TITLE, body: BODY });

        expect(create).toHaveBeenCalledTimes(1);
        expect(failureShape(responses), 'the sender must receive exactly one { ok: false, error } answer').toEqual([{ ok: false, hasError: true }]);
    });
});
