/**
 * background/notification-routes.js — service-worker message route that shows a desktop notification, plus the DSS_SHOW_NOTIFICATION message type in utils/message-constants.js.
 *
 * Contract under test (derived from the requirement; the implementation did not exist and was NOT read): the module publishes globalThis.DSSNotificationRoutes = { install }. install() registers one chrome.runtime.onMessage listener. For { type: DSS_SHOW_NOTIFICATION, title, body } with string title and body, the listener returns true and calls promise-form chrome.notifications.create with an options object holding type 'basic', iconUrl = chrome.runtime.getURL('assets/icons/icon128.png'), title and message = body, then answers an object with ok === true. It answers { ok: false, error: <non-empty string> } without throwing when chrome.notifications is unavailable or create rejects, and answers ok false without calling create when title or body is not a string. Any other message type gets false and no answer.
 *
 * Diagnostics: a failure answer's error string names its cause (the notifications API for an unavailable chrome.notifications, the offending field for bad input), and a failing route logs a console.error whose first argument starts with "[DSS] notification-routes" and includes the message type. install() without utils/message-constants.js loaded throws an Error naming that file. Loading the file publishes globalThis.DSSNotificationRoutes, works without a module system and sets module.exports to the same object when one exists.
 *
 * Assertions go through the trust boundaries only: the options object chrome.notifications.create receives, the sendResponse payload, the listener return value, console.error and what loading the file publishes.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import messageConstants from '../../utils/message-constants.js';

const MODULE_REL = 'background/notification-routes.js';
const MODULE_FILE = path.resolve(__dirname, '../..', MODULE_REL);
const moduleLoaders = import.meta.glob('../../background/notification-routes.js');
const ICON_PATH = 'assets/icons/icon128.png';
const fakeUrl = (p) => `chrome-extension://test-extension-id/${p}`;

let listener = null;

/** Loads the module once, installs it with chrome.runtime.onMessage.addListener captured, and returns the single listener. A missing file, a loader miss and a bad published API are distinct errors, so a broken loader cannot pass for "not implemented yet". */
async function getListener() {
    if (listener) return listener;
    if (!fs.existsSync(MODULE_FILE)) throw new Error(`${MODULE_REL} does not exist (red phase: module not implemented yet)`);
    const load = Object.values(moduleLoaders)[0];
    if (!load) throw new Error(`${MODULE_REL} exists but import.meta.glob did not pick it up; fix the glob in notification-routes.spec.js`);
    await load();
    if (typeof globalThis.DSSNotificationRoutes?.install !== 'function') throw new Error(`${MODULE_REL} loaded but globalThis.DSSNotificationRoutes.install is not a function`);
    const captured = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { captured.push(fn); });
    try {
        globalThis.DSSNotificationRoutes.install();
    } finally {
        addSpy.mockRestore();
    }
    if (captured.length !== 1) throw new Error(`install() must register exactly one chrome.runtime.onMessage listener, registered ${captured.length}`);
    listener = captured[0];
    return listener;
}

function showType() {
    const type = globalThis.DSS_SHOW_NOTIFICATION;
    if (typeof type !== 'string' || type === '') throw new Error('utils/message-constants.js must define globalThis.DSS_SHOW_NOTIFICATION as a non-empty string');
    return type;
}

/** Drain the route promise chains. */
const flush = async (ticks = 8) => {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Invoke the route listener directly; returns its value and the response spy. */
async function send(message) {
    const route = await getListener();
    const sendResponse = vi.fn();
    const result = route(message, { id: 'test-extension-id' }, sendResponse);
    await flush();
    return { result, sendResponse };
}

/** The single response, asserting the route answered exactly once. */
function onlyResponse(sendResponse) {
    expect(sendResponse, 'sendResponse must be called exactly once').toHaveBeenCalledTimes(1);
    return sendResponse.mock.calls[0][0];
}

function expectFailure(response) {
    expect(response?.ok, `expected ok:false, got ${JSON.stringify(response)}`).toBe(false);
    expect(typeof response.error, `expected an error string, got ${JSON.stringify(response)}`).toBe('string');
    expect(response.error.length, 'error string must not be empty').toBeGreaterThan(0);
}

/** The options object create() received, whichever position the optional notificationId leaves it in. */
function createdOptions() {
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const options = chrome.notifications.create.mock.calls[0].find((arg) => arg !== null && typeof arg === 'object');
    expect(options, 'chrome.notifications.create must receive an options object').toBeDefined();
    return options;
}

describe('DSS_SHOW_NOTIFICATION (utils/message-constants.js)', () => {
    it('globalThis.DSS_SHOW_NOTIFICATION is a non-empty string', () => {
        expect(typeof globalThis.DSS_SHOW_NOTIFICATION, 'globalThis.DSS_SHOW_NOTIFICATION is missing').toBe('string');
        expect(globalThis.DSS_SHOW_NOTIFICATION.length).toBeGreaterThan(0);
    });

    it('module.exports.DSS_SHOW_NOTIFICATION equals the global', () => {
        expect(messageConstants.DSS_SHOW_NOTIFICATION, 'module.exports.DSS_SHOW_NOTIFICATION is missing').toBeTypeOf('string');
        expect(messageConstants.DSS_SHOW_NOTIFICATION).toBe(globalThis.DSS_SHOW_NOTIFICATION);
    });
});

describe('background/notification-routes', () => {
    let errorSpy;

    beforeEach(() => {
        // The shared vitest chrome mock has no chrome.notifications (test/setup/vitest.setup.js), so each test installs it.
        chrome.notifications = { create: vi.fn().mockResolvedValue('notification-id') };
        chrome.runtime.getURL.mockImplementation(fakeUrl);
        // Silenced; the failure-log test asserts its content.
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        delete chrome.notifications;
        chrome.runtime.getURL.mockReset();
        errorSpy.mockRestore();
    });

    it('show message: create gets basic options with the packaged icon URL, title and body; listener returns true; answers ok:true', async () => {
        const { result, sendResponse } = await send({ type: showType(), title: 'T', body: 'B' });

        expect(result).toBe(true);
        expect(createdOptions()).toMatchObject({ type: 'basic', iconUrl: fakeUrl(ICON_PATH), title: 'T', message: 'B' });
        expect(onlyResponse(sendResponse)?.ok).toBe(true);
    });

    it('chrome.notifications unavailable: answers ok:false with an error string and does not throw', async () => {
        delete chrome.notifications;
        const route = await getListener();
        const sendResponse = vi.fn();

        expect(() => route({ type: showType(), title: 'T', body: 'B' }, { id: 'test-extension-id' }, sendResponse)).not.toThrow();
        await flush();

        const response = onlyResponse(sendResponse);
        expectFailure(response);
        expect(response.error, 'the error names the unavailable notifications API').toContain('notifications');
    });

    it.each([
        ['title missing', { body: 'B' }, 'title'],
        ['body missing', { title: 'T' }, 'body'],
        ['title is a number', { title: 42, body: 'B' }, 'title'],
        ['body is a number', { title: 'T', body: 42 }, 'body'],
    ])('%s: create is not called, answers ok:false with an error naming the field', async (_label, fields, field) => {
        const { sendResponse } = await send({ type: showType(), ...fields });

        expect(chrome.notifications.create).not.toHaveBeenCalled();
        const response = onlyResponse(sendResponse);
        expectFailure(response);
        expect(response.error, `the error names ${field}`).toContain(field);
    });

    it('a failing route logs a console.error whose first argument starts with "[DSS] notification-routes" and includes the message type', async () => {
        chrome.notifications.create = vi.fn().mockRejectedValue(new Error('notifications blocked'));

        await send({ type: showType(), title: 'T', body: 'B' });

        const logs = errorSpy.mock.calls.filter(([first]) => typeof first === 'string' && first.startsWith('[DSS] notification-routes'));
        expect(logs, 'console.error calls starting with [DSS] notification-routes').toHaveLength(1);
        expect(logs[0][0]).toContain(showType());
    });

    it('create rejects: answers ok:false with an error string', async () => {
        chrome.notifications.create = vi.fn().mockRejectedValue(new Error('notifications blocked'));

        const { sendResponse } = await send({ type: showType(), title: 'T', body: 'B' });

        expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
        expectFailure(onlyResponse(sendResponse));
    });

    it('another message type: listener returns false, no answer, no notification', async () => {
        const { result, sendResponse } = await send({ type: 'DSS_SOME_OTHER_TYPE', title: 'T', body: 'B' });

        expect(result).toBe(false);
        expect(sendResponse).not.toHaveBeenCalled();
        expect(chrome.notifications.create).not.toHaveBeenCalled();
    });

    it.each([['undefined', undefined], ['null', null]])('a %s message: listener returns false without throwing, no answer', async (_label, message) => {
        const route = await getListener();
        const sendResponse = vi.fn();

        let result;
        expect(() => { result = route(message, { id: 'test-extension-id' }, sendResponse); }).not.toThrow();
        await flush();

        expect(result).toBe(false);
        expect(sendResponse).not.toHaveBeenCalled();
    });

    it('install() while DSS_SHOW_NOTIFICATION is not defined: throws an Error naming utils/message-constants.js and registers no listener', async () => {
        await getListener();
        const savedType = globalThis.DSS_SHOW_NOTIFICATION;
        const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(() => {});
        let error = null;
        try {
            delete globalThis.DSS_SHOW_NOTIFICATION;
            globalThis.DSSNotificationRoutes.install();
        } catch (e) {
            error = e;
        } finally {
            globalThis.DSS_SHOW_NOTIFICATION = savedType;
            addSpy.mockRestore();
        }

        expect(error, 'install() must throw').toBeInstanceOf(Error);
        expect(error, `not a TypeError: ${error?.message}`).not.toBeInstanceOf(TypeError);
        expect(error.message).toContain('utils/message-constants.js');
        expect(addSpy).not.toHaveBeenCalled();
    });
});

describe('loading background/notification-routes.js', () => {
    /** Run the file as a classic script with the given free-variable bindings (new Function parameters shadow the real globals). */
    function evaluate(bindings) {
        const names = Object.keys(bindings);
        new Function(...names, fs.readFileSync(MODULE_FILE, 'utf8'))(...names.map((name) => bindings[name]));
    }

    it('no module system (service worker): loads without throwing and publishes DSSNotificationRoutes.install on globalThis', () => {
        const globals = {};

        expect(() => evaluate({ globalThis: globals, module: undefined })).not.toThrow();

        expect(globals.DSSNotificationRoutes?.install).toBeTypeOf('function');
    });

    it('CommonJS: module.exports is the published DSSNotificationRoutes object', () => {
        const globals = {};
        const module = { exports: {} };

        evaluate({ globalThis: globals, module });

        expect(module.exports.install).toBeTypeOf('function');
        expect(module.exports).toBe(globals.DSSNotificationRoutes);
    });
});
