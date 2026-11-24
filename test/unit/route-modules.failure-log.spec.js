/**
 * Failure log of the background route files: when a route of one of the five route files fails, the service worker logs console.error with the first argument `[DSS] <route file label> <message type>:` and answers { ok: false, error }, so a log line identifies which route file failed.
 *
 * Each route file is evaluated from source (real module code, real DSSRouteDispatch) and installed with chrome.runtime.onMessage.addListener captured; one failing message per file is sent through the captured listener. Trust boundaries stubbed: chrome.runtime.onMessage, chrome.notifications, chrome.storage.session and the pending-store global the route reads. Assertions read the console.error first argument and the sendResponse payload.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/message-constants.js';
import '../../utils/runtime-message-errors.js';
import '../../utils/temporary-chat-message-types.js';
import '../../utils/temporary-chat-constants.js';
import '../../utils/storage-manager.keys.js';
import '../../utils/editor-flush-channel.js';
import '../../background/route-dispatch.js';

const ROOT = path.resolve(__dirname, '../..');

/** Evaluates the route file with its own view of globalThis for publishing, reading everything else from the real globalThis. */
function loadRoute(file, publishedName) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const published = {};
    const view = new Proxy(globalThis, {
        get: (target, key) => (key in published ? published[key] : target[key]),
        set: (target, key, value) => {
            published[key] = value;
            return true;
        },
    });
    new Function('globalThis', 'module', source)(view, undefined);
    return published[publishedName];
}

/** Installs the route file and returns the single onMessage listener it registered. */
function installAndCapture(file, publishedName) {
    const captured = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { captured.push(fn); });
    try {
        loadRoute(file, publishedName).install();
    } finally {
        addSpy.mockRestore();
    }
    return captured[0];
}

/** Sends one message and resolves with what the sender received. */
async function send(listener, message) {
    const answers = [];
    listener(message, {}, (response) => answers.push(response));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return answers;
}

let originalNotifications;
let originalSession;
let originalPendingStore;
let errorSpy;

beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalNotifications = chrome.notifications;
    originalSession = chrome.storage.session;
    originalPendingStore = globalThis.TemporaryChatPendingStore;
    chrome.notifications = { create: vi.fn() };
    chrome.storage.session = { get: vi.fn().mockRejectedValue(new Error('session storage unavailable')), remove: vi.fn() };
    globalThis.TemporaryChatPendingStore = { getPendingDeletes: vi.fn().mockRejectedValue(new Error('queue unavailable')) };
});

afterEach(() => {
    chrome.notifications = originalNotifications;
    chrome.storage.session = originalSession;
    globalThis.TemporaryChatPendingStore = originalPendingStore;
    vi.restoreAllMocks();
});

describe('a failing route logs the label of its route file', () => {
    it.each([
        ['background/clipboard-routes.js', 'DSSClipboardRoutes', 'clipboard-routes', () => ({ type: 'DSS_COPY_TO_CLIPBOARD', text: 42 })],
        ['background/editor-window-routes.js', 'DSSEditorWindowRoutes', 'editor-window-routes', () => ({ type: globalThis.DSS_EDITOR_WINDOW.CLOSE_MESSAGE_TYPE })],
        ['background/notification-routes.js', 'DSSNotificationRoutes', 'notification-routes', () => ({ type: globalThis.DSS_SHOW_NOTIFICATION, title: 1, body: 2 })],
        ['background/pending-store-routes.js', 'DSSPendingStoreRoutes', 'pending-store-routes', () => ({ type: globalThis.DSS_TEMP_CHAT.DSS_MSG_GET_PENDING_UUIDS })],
        ['background/settings-routes.js', 'DSSSettingsRoutes', 'settings-routes', () => ({ type: globalThis.DSS_SETTINGS_MSG.GET_SETTINGS })],
    ])('%s (%s): the log starts with [DSS] %s and the message type, and the sender gets { ok: false }', async (file, publishedName, label, buildMessage) => {
        const listener = installAndCapture(file, publishedName);
        const message = buildMessage();

        const answers = await send(listener, message);

        expect(answers).toHaveLength(1);
        expect(answers[0].ok).toBe(false);
        expect(errorSpy.mock.calls.map((args) => args[0])).toContain(`[DSS] ${label} ${message.type}:`);
    });
});
