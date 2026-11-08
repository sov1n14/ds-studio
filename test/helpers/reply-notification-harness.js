/**
 * Shared harness for the content/reply-notification.js specs (desktop notification when a reply completes while the tab is not in the foreground).
 *
 * Real modules: content/ds-selectors.js, content/reply-completion.js, content/feature-toggle.js, utils/i18n.js (dsI18n, preloaded by vitest.setup.js) and content/reply-notification.js. The page fixtures (captured chat pane, assistant items, stopped-reply row) come from auto-copy-harness.js and reply-completion-fixtures.js.
 *
 * Trust boundaries only: chrome.runtime (sendMessage routes DSS_GET_SETTINGS to the given settings and DSS_SHOW_NOTIFICATION to the chosen failure mode, onMessage carries DSS_SETTINGS_CHANGED), document.visibilityState / document.hidden (own-property getters) and document.hasFocus (spy). Every notification message is copied (structuredClone) at the moment it reaches the boundary, as the real messaging layer serializes it.
 *
 * Failure modes of DSS_SHOW_NOTIFICATION, modelled on the real promise / callback forms of chrome.runtime.sendMessage: 'ok' answers { ok: true }; 'reject' makes the promise form reject (no callback) or, with a callback, calls it with chrome.runtime.lastError set only while the callback runs and returns undefined; 'throw' throws synchronously (extension context invalidated); 'undefined' returns undefined without a promise (the callback-only form of sendMessage); 'non-thenable' returns a truthy value that is not a promise.
 */
import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import { installChromeRuntime, requestedKeys, MASTER_KEY } from './auto-click-harness.js';
import { mountPage, awaitingItem, completeItem, makeStopped, flush, completeNewReply } from './auto-copy-harness.js';

export { MASTER_KEY, requestedKeys, mountPage, awaitingItem, completeItem, makeStopped, flush, completeNewReply };
export const OWN_KEY = 'isReplyNotificationEnabled';
export const MODULE_REL = 'content/reply-notification.js';
export const MODULE_FILE = path.resolve(__dirname, '../..', MODULE_REL);
const moduleLoaders = import.meta.glob('../../content/reply-notification.js');

const REJECT_MESSAGE = 'Could not establish connection. Receiving end does not exist.';
const THROW_MESSAGE = 'Extension context invalidated.';

let sendMessage = null;
let settingsValues = {};
let notificationMode = 'ok';
let sent = [];

/** settings({ master, own }) -> the GET_SETTINGS values object for the master switch and the own key. */
export const settings = ({ master = true, own = true } = {}) => ({ [MASTER_KEY]: master, [OWN_KEY]: own });

/** Copies of every DSS_SHOW_NOTIFICATION message that reached chrome.runtime.sendMessage, in order. */
export const notifications = () => sent.slice();

/** How the next DSS_SHOW_NOTIFICATION calls answer: 'ok' | 'reject' | 'throw' | 'undefined' | 'non-thenable'. */
export function setNotificationMode(mode) {
    if (!['ok', 'reject', 'throw', 'undefined', 'non-thenable'].includes(mode)) throw new Error('unknown notification mode ' + mode);
    notificationMode = mode;
}

function answerSettings(callback) {
    const response = { ok: true, values: structuredClone(settingsValues) };
    if (typeof callback === 'function') callback(response);
    return Promise.resolve(response);
}

function answerNotification(message, callback) {
    sent.push(structuredClone(message));
    if (notificationMode === 'throw') throw new Error(THROW_MESSAGE);
    if (notificationMode === 'undefined') return undefined;
    if (notificationMode === 'non-thenable') return { ok: true };
    if (notificationMode === 'reject') {
        if (typeof callback !== 'function') return Promise.reject(new Error(REJECT_MESSAGE));
        chrome.runtime.lastError = { message: REJECT_MESSAGE };
        try {
            callback(undefined);
        } finally {
            chrome.runtime.lastError = undefined;
        }
        return undefined;
    }
    const response = { ok: true };
    if (typeof callback === 'function') {
        callback(response);
        return undefined;
    }
    return Promise.resolve(response);
}

/** Fresh chrome.runtime stubs for one test; the settings answer and failure mode reset to all-on / 'ok'. */
export function installBoundary() {
    const runtime = installChromeRuntime();
    sendMessage = runtime.sendMessage;
    settingsValues = settings();
    notificationMode = 'ok';
    sent = [];
    chrome.runtime.lastError = undefined;
    sendMessage.mockImplementation((message, callback) => {
        if (message?.type === globalThis.DSS_SETTINGS_MSG.GET_SETTINGS) return answerSettings(callback);
        if (message?.type === globalThis.DSS_SHOW_NOTIFICATION) return answerNotification(message, callback);
        return Promise.resolve(undefined);
    });
    return runtime;
}

/** Model the tab's foreground state: document.visibilityState (and the matching document.hidden) plus document.hasFocus(). */
export function setForeground({ visibility, focused }) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => visibility !== 'visible' });
    const hasFocus = vi.isMockFunction(document.hasFocus) ? document.hasFocus : vi.spyOn(document, 'hasFocus');
    hasFocus.mockImplementation(() => focused);
}

/** Drop the own-property visibility getters so the document prototype answers again (vi.restoreAllMocks restores hasFocus). */
export function resetForeground() {
    delete document.visibilityState;
    delete document.hidden;
}

export const HIDDEN = { visibility: 'hidden', focused: false };
export const VISIBLE_UNFOCUSED = { visibility: 'visible', focused: false };
export const FOREGROUND = { visibility: 'visible', focused: true };

/** The message a completed reply must produce: the global type constant and the dsI18n texts of replyNotificationTitle / replyNotificationBody in the current locale. */
export function expectedNotification() {
    return {
        type: globalThis.DSS_SHOW_NOTIFICATION,
        title: globalThis.dsI18n.t('replyNotificationTitle'),
        body: globalThis.dsI18n.t('replyNotificationBody'),
    };
}

/** Collect uncaught failures while `run` executes: Node unhandled promise rejections and window 'error' events (an exception escaping a MutationObserver callback). */
export async function captureUncaught(run) {
    const uncaught = [];
    const onRejection = (reason) => uncaught.push(reason);
    const onError = (event) => uncaught.push(event.error || event.message);
    process.on('unhandledRejection', onRejection);
    window.addEventListener('error', onError);
    try {
        await run();
        // Node reports an unhandled rejection after the microtask queue drains; two macrotask turns let it arrive.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
        process.off('unhandledRejection', onRejection);
        window.removeEventListener('error', onError);
    }
    return uncaught;
}

/** Calls to console.error / console.warn (both silenced) whose first argument starts with "[DSS]". Call before the failure happens. */
export function captureDssLogs() {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => [...error.mock.calls, ...warn.mock.calls]
        .filter((args) => typeof args[0] === 'string' && args[0].startsWith('[DSS]'));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Module loading
// ─────────────────────────────────────────────────────────────────────────────

/** Fail with a message naming the target while it does not exist (red phase), separate from "exists but failed to load". */
export function assertModuleExists() {
    if (!fs.existsSync(MODULE_FILE)) throw new Error(MODULE_REL + ' does not exist (red phase: module not implemented yet)');
}

/** Answer GET_SETTINGS with `values` and load fresh copies of the dependencies (ds-selectors, reply-completion, feature-toggle); utils/storage-manager.keys.js, utils/message-constants.js and utils/i18n.js are preloaded by vitest.setup.js. */
export async function loadDependencies(values) {
    settingsValues = values;
    vi.resetModules();
    await import('../../content/ds-selectors.js');
    await import('../../content/reply-completion.js');
    await import('../../content/feature-toggle.js');
}

/**
 * Load fresh modules and answer the initial GET_SETTINGS with `values`. The target is located by fs.existsSync + import.meta.glob (a runtime import() cannot resolve files outside test/). The module must register its toggle itself on load; a module that only publishes DSstudio.ReplyNotification.start() is started through it so the scenario specs still exercise its behaviour (auto-start itself is asserted separately through loadModuleSource). Either way it must request the own key through GET_SETTINGS.
 */
export async function loadReplyNotification(values) {
    assertModuleExists();
    const load = Object.values(moduleLoaders)[0];
    if (!load) throw new Error(MODULE_REL + ' exists but import.meta.glob did not pick it up; fix the glob in reply-notification-harness.js');
    await loadDependencies(values);
    await load();
    await flush();
    const hasRegistered = () => requestedKeys().includes(OWN_KEY);
    if (!hasRegistered()) {
        const api = globalThis.DSstudio?.ReplyNotification;
        if (typeof api?.start === 'function') api.start();
        await flush();
    }
    if (!hasRegistered()) {
        throw new Error(MODULE_REL + ' loaded but never requested ' + OWN_KEY + ' through GET_SETTINGS (no registerFeatureToggle on load and no DSstudio.ReplyNotification.start)');
    }
}

/** A globalThis stand-in that inherits every real global (dsI18n, DSS_SHOW_NOTIFICATION, chrome, document) and holds its own copies of the freshly loaded dependencies; assign undefined to a dependency to make it absent. Call after loadDependencies. */
export function dependencyGlobals() {
    const globals = Object.create(globalThis);
    globals.DSstudio = { Selectors: globalThis.DSstudio.Selectors, ReplyCompletion: globalThis.DSstudio.ReplyCompletion };
    globals.DSSFeatureToggle = globalThis.DSSFeatureToggle;
    globals.__DS_StorageManager_keys = globalThis.__DS_StorageManager_keys;
    return globals;
}

/**
 * Run the module source as a classic script with chosen free-variable bindings (new Function parameters shadow the real globals). Defaults model the browser: no module system, window and globalThis the same object. A binding passed explicitly as undefined stays undefined.
 */
export function loadModuleSource({ globals = dependencyGlobals(), ...bindings } = {}) {
    assertModuleExists();
    const scope = { globalThis: globals, window: globals, module: undefined, require: undefined, ...bindings };
    const names = Object.keys(scope);
    new Function(...names, fs.readFileSync(MODULE_FILE, 'utf8'))(...names.map((name) => scope[name]));
}
