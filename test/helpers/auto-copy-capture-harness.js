/**
 * Shared harness for the unfocused auto-copy capture specs (DECISIONS U6-14): when an auto-copy click runs while the DeepSeek document is unfocused, the MAIN-world bridge (content/react-click-bridge.main.js) captures the text the site passes to `navigator.clipboard.writeText` and forwards it to the isolated world, where content/auto-copy.relay.js sends it to the service worker as { type: 'DSS_COPY_TO_CLIPBOARD', text }.
 *
 * Real modules: the bridge, the relay and content/auto-copy.js with its dependencies (loaded through test/helpers/auto-copy-harness.js). Faked trust boundaries only: the browser Clipboard API (navigator.clipboard, installed before the bridge loads), chrome.runtime.sendMessage (routed by message type) and time (fake Date only, so real timers keep MutationObserver delivery and flush() working).
 *
 * The fake Clipboard mirrors Chrome: writeText lives on Clipboard.prototype, throws TypeError "Illegal invocation" when called on anything but the clipboard instance, rejects with a DOMException NotAllowedError while the document is unfocused and resolves while focused. A site copy button is a guarded host button (auto-copy-harness guard()) whose React onClick, on an accepted (trusted) activation, calls navigator.clipboard.writeText(text) and keeps the promise it got, so the specs can assert what the site observes.
 */
import fs from 'fs';
import path from 'path';

export const COPY_TYPE = 'DSS_COPY_TO_CLIPBOARD';
export const CAPTURED_EVENT = 'dss:auto-copy-captured';

// ─────────────────────────────────────────────────────────────────────────────
//  Clipboard API trust boundary
// ─────────────────────────────────────────────────────────────────────────────

export const clipboardState = {
    isFocused: false,
    resolvedValue: undefined,
    writes: [],
    lastError: null,
};

export function resetClipboard({ isFocused = false, resolvedValue = undefined } = {}) {
    clipboardState.isFocused = isFocused;
    clipboardState.resolvedValue = resolvedValue;
    clipboardState.writes = [];
    clipboardState.lastError = null;
}

class FakeClipboard {
    writeText(text) {
        if (!(this instanceof FakeClipboard)) throw new TypeError('Illegal invocation');
        clipboardState.writes.push(text);
        if (clipboardState.isFocused) return Promise.resolve(clipboardState.resolvedValue);
        const error = new DOMException("Failed to execute 'writeText' on 'Clipboard': Document is not focused.", 'NotAllowedError');
        clipboardState.lastError = error;
        return Promise.reject(error);
    }
}

let isClipboardInstalled = false;

/** Install navigator.clipboard once per spec file; MUST run before the bridge is evaluated, because the bridge wraps writeText only if it exists at load. */
export function installClipboard() {
    if (isClipboardInstalled) return;
    Object.defineProperty(navigator, 'clipboard', { value: new FakeClipboard(), configurable: true });
    isClipboardInstalled = true;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Site copy buttons
// ─────────────────────────────────────────────────────────────────────────────

/** What the site received from each writeText call: { text, promise } in call order. */
export let siteResults = [];
/** Deferred site writes (a site whose onClick reaches writeText later): call each to perform its write. */
export let deferredWrites = [];

export function resetSite() {
    siteResults = [];
    deferredWrites = [];
}

/** The site's own writeText call: keeps the promise it got (marked handled, as a site that catches the failure would). */
export function siteWrite(text) {
    const promise = navigator.clipboard.writeText(text);
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    siteResults.push({ text, promise });
    return promise;
}

/** Turn a guarded host button into a site copy button that writes `text` on each accepted activation; `isDeferred` queues the write in deferredWrites instead. */
export function makeSiteCopyButton(el, text, { isDeferred = false } = {}) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    if (!key) throw new Error('makeSiteCopyButton: element carries no React props; guard it first');
    const props = el[key];
    const prior = props.onClick;
    props.onClick = function onClick(e) {
        prior.call(this, e);
        const nativeEvent = e?.nativeEvent;
        if (!(nativeEvent?.isTrusted === true && nativeEvent instanceof Event)) return;
        if (isDeferred) deferredWrites.push(() => siteWrite(text));
        else siteWrite(text);
    };
    return el;
}

/** The toolbar's copy button: its first direct role="button" child. */
export const toolbarCopyButton = (toolbar) => Array.from(toolbar.children).find((c) => c.getAttribute('role') === 'button');

// ─────────────────────────────────────────────────────────────────────────────
//  chrome.runtime.sendMessage trust boundary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Failure shapes of a DSS_COPY_TO_CLIPBOARD send, as real Chrome produces them: 'ok' answers { ok: true }; 'reject' fails the call (promise form rejects, callback form gets lastError during its callback and the call returns undefined); 'throw' throws synchronously (extension context invalidated); 'undefined' resolves without a response (no listener answered).
 */
function copyReply(mode, callback) {
    if (mode === 'throw') throw new Error('Extension context invalidated.');
    if (mode === 'reject') {
        const error = new Error('Could not establish connection. Receiving end does not exist.');
        if (typeof callback !== 'function') return Promise.reject(error);
        chrome.runtime.lastError = { message: error.message };
        try { callback(undefined); } finally { delete chrome.runtime.lastError; }
        return undefined;
    }
    const response = mode === 'undefined' ? undefined : { ok: true };
    if (typeof callback === 'function') { callback(response); return undefined; }
    return Promise.resolve(response);
}

/**
 * Replace chrome.runtime.sendMessage (after the modules loaded and requested their settings) with a plain routing function: GET_SETTINGS answers `values` (copied); DSS_COPY_TO_CLIPBOARD answers per `copyModes`, one mode per call in order, the last one for every later call. Copy messages are deep-copied into the returned list, as the real boundary serialises them.
 *
 * Deliberately not a vi.fn: vitest's spy attaches its own handlers to every promise its implementation returns (mock.settledResults), which marks a rejection as handled, so a caller that forgets to catch a rejected send would never surface as an unhandled rejection.
 */
export function routeSendMessage(values, copyModes = ['ok']) {
    const copies = [];
    let copyCalls = 0;
    chrome.runtime.sendMessage = (message, callback) => {
        if (message?.type === COPY_TYPE) {
            copies.push(structuredClone(message));
            const mode = copyModes[Math.min(copyCalls, copyModes.length - 1)];
            copyCalls += 1;
            return copyReply(mode, callback);
        }
        const response = { ok: true, values: structuredClone(values) };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    };
    return copies;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Relay loading
// ─────────────────────────────────────────────────────────────────────────────

const RELAY_REL = 'content/auto-copy.relay.js';
const relayLoaders = import.meta.glob('../../content/auto-copy.relay.js');
let isRelayLoaded = false;

/** Evaluate the relay once per spec file: it starts at load and listens on `document`, which outlives vi.resetModules, so a per-test load would stack listeners. */
export async function loadRelay() {
    if (isRelayLoaded) return;
    if (!fs.existsSync(path.resolve(__dirname, '../..', RELAY_REL))) throw new Error(`${RELAY_REL} does not exist`);
    const load = Object.values(relayLoaders)[0];
    if (!load) throw new Error(`${RELAY_REL} exists but import.meta.glob did not pick it up; fix the glob in auto-copy-capture-harness.js`);
    await load();
    isRelayLoaded = true;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Uncaught error recorder
// ─────────────────────────────────────────────────────────────────────────────

/** Record unhandled promise rejections and exceptions escaping event listeners until the returned stop() runs. */
export function recordUncaught() {
    const uncaught = [];
    const onRejection = (reason) => uncaught.push(['unhandledRejection', reason]);
    const onError = (event) => uncaught.push(['error', event.error ?? event.message]);
    process.on('unhandledRejection', onRejection);
    window.addEventListener('error', onError);
    return {
        uncaught,
        stop() {
            process.off('unhandledRejection', onRejection);
            window.removeEventListener('error', onError);
        },
    };
}
