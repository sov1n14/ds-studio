import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';
import { loadClassicScript } from './load-classic-script.js';
// The bridge reads the bare globals StorageManager (its settings key) and DSS_SETTINGS_MSG at start-up.
import '../../utils/storage-manager.js';
import '../../utils/message-constants.js';

/**
 * Harness for the prevent-auto-scroll user-scroll allow window: the MAIN-world patch (content/prevent-auto-scroll.js) and the isolated-world bridge (content/prevent-auto-scroll-bridge.js) share one happy-dom document, exactly as both worlds share the live page DOM.
 *
 * Trust boundaries modelled here (and only here): the browser's native scroll engine, the browser's isTrusted flag, and chrome.runtime. The patch, the bridge, feature-toggle and ds-selectors are the real modules.
 */

export const BRIDGE_ID = 'dss-prevent-auto-scroll-bridge';

/** Window length from the decided design: a trusted press on the native go-bottom button allows scrolls for 500 ms. */
export const ALLOW_WINDOW_MS = 500;

/**
 * ASSUMED CONTRACT (not yet decided in the directive): the bridge writes the allow-until moment as epoch milliseconds (String(Date.now() + 500)) to bridge.dataset.allowScrollUntil, i.e. the attribute data-allow-scroll-until. Only the MAIN-patch-alone spec writes this key directly; the bridge and scenario specs observe the window only through scroll outcomes. Rename here if the implementation picks another key.
 */
export const ALLOW_UNTIL_DATASET_KEY = 'allowScrollUntil';

/** Live list viewport height (--container-height: 790px in the capture, rounded) and a long conversation. */
export const LIST_CLIENT_HEIGHT = 800;
export const LIST_SCROLL_HEIGHT = 5000;

const nativeScrollTop = new WeakMap();

function maxScrollTop(el) {
    return Math.max(0, (Number(el.scrollHeight) || 0) - (Number(el.clientHeight) || 0));
}

function writeNativeScrollTop(el, top) {
    const value = Number(top);
    const safe = Number.isFinite(value) ? value : 0;
    nativeScrollTop.set(el, Math.min(Math.max(0, safe), maxScrollTop(el)));
}

function readNativeScrollTop(el) {
    return nativeScrollTop.get(el) ?? 0;
}

/**
 * Chrome-faithful native scroll engine on Element.prototype, installed BEFORE the patch loads so the patch captures these as its originals. As in Chrome, the native scrollTo / scroll / scrollBy move the element directly and never route through the JS scrollTop setter, and every write clamps to [0, scrollHeight - clientHeight].
 */
export function installNativeScrollModel() {
    Object.defineProperty(Element.prototype, 'scrollTop', {
        configurable: true,
        enumerable: true,
        get() { return readNativeScrollTop(this); },
        set(value) { writeNativeScrollTop(this, value); },
    });
    const nativeScrollTo = function scrollTo(optionsOrX, y) {
        const top = optionsOrX !== null && typeof optionsOrX === 'object' ? optionsOrX.top : y;
        if (top !== undefined) writeNativeScrollTop(this, top);
    };
    Element.prototype.scrollTo = nativeScrollTo;
    Element.prototype.scroll = nativeScrollTo;
    Element.prototype.scrollBy = function scrollBy(optionsOrX, y) {
        const dy = optionsOrX !== null && typeof optionsOrX === 'object' ? optionsOrX.top : y;
        if (dy !== undefined) writeNativeScrollTop(this, readNativeScrollTop(this) + Number(dy));
    };
    Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/** Reads the element's real (native) scroll position, bypassing any getter the patch may install. */
export function nativeTopOf(el) {
    return readNativeScrollTop(el);
}

/** Places the element at a native scroll position without going through any patched API. */
export function placeAt(el, top) {
    writeNativeScrollTop(el, top);
}

/** Runs the real MAIN-world patch in a vm context whose globals resolve to this document's window (Date included, so fake timers reach it). */
export function loadMainPatch() {
    return loadClassicScript('content/prevent-auto-scroll.js', Object.create(globalThis));
}

/** Creates the bridge element the way the isolated world exposes it to MAIN: a hidden div on documentElement. */
export function createBridgeElement({ enabled }) {
    const bridge = document.createElement('div');
    bridge.id = BRIDGE_ID;
    bridge.style.display = 'none';
    bridge.dataset.enabled = enabled ? 'true' : 'false';
    document.documentElement.appendChild(bridge);
    return bridge;
}

const MESSAGE_LIST_FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/ds-snapshots/conv2-finished-message-list.html');

/**
 * Mounts the captured live message list (conv2-finished, scrolled up, so the native go-bottom button is rendered). Handles are found by real nesting, never by the selectors under test: the root is the .ds-virtual-list.ds-scroll-area scroller; the floating bar's first child is the native positioning wrapper (_0706cde) whose only child is the real role=button control.
 */
export function mountChatList() {
    const host = document.createElement('div');
    host.innerHTML = fs.readFileSync(MESSAGE_LIST_FIXTURE, 'utf8');
    const list = host.firstElementChild;
    document.body.appendChild(list);
    const textarea = list.querySelector('textarea[name="search"]');
    const floatingBar = textarea.parentElement.parentElement.parentElement.parentElement;
    const nativeWrapper = floatingBar.firstElementChild;
    const nativeControl = nativeWrapper.firstElementChild;
    const nativeIcon = nativeControl.querySelector('svg') || nativeControl;
    const geometry = { scrollHeight: LIST_SCROLL_HEIGHT, clientHeight: LIST_CLIENT_HEIGHT };
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => geometry.scrollHeight });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => geometry.clientHeight });
    return { list, textarea, floatingBar, nativeWrapper, nativeControl, nativeIcon, geometry };
}

/** The extension's own go-top button: a clone of the native role=button control carrying .dsw-gotop and no _0706cde wrapper, placed in the same floating bar. */
export function addGoTopClone(floatingBar, nativeControl) {
    const clone = nativeControl.cloneNode(true);
    clone.classList.add('dsw-gotop');
    floatingBar.insertBefore(clone, floatingBar.firstElementChild.nextSibling);
    return { clone, cloneIcon: clone.querySelector('svg') || clone };
}

function eventCtorFor(type) {
    return type.startsWith('pointer') ? PointerEvent : MouseEvent;
}

/**
 * Dispatches an event whose isTrusted reads as the given value. In Chrome isTrusted is an own unforgeable property set by the browser; happy-dom keeps it on the prototype (el.click() even yields undefined), so an own data property on the instance is how a browser-originated event is reproduced. The production code only ever reads event.isTrusted, so no test-only flag is involved.
 */
export function dispatchWithTrust(target, type, isTrusted) {
    const Ctor = eventCtorFor(type);
    const event = new Ctor(type, { bubbles: true, cancelable: true, composed: true, button: 0 });
    Object.defineProperty(event, 'isTrusted', { value: isTrusted, configurable: true });
    target.dispatchEvent(event);
    return event;
}

/** A real user press on the target: the full trusted pointer and mouse sequence Chrome fires for one primary click. */
export function userClick(target) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => dispatchWithTrust(target, type, true));
}

/** Script-originated click on the target with Chrome's isTrusted === false on every event of the sequence. */
export function scriptedClickSequence(target) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => dispatchWithTrust(target, type, false));
}

/** Loads the real bridge with the master switch and dsPreventAutoScroll both on (persistent protection), answering GET_SETTINGS at the chrome.runtime boundary. */
export async function loadBridgeWithFeatureOn() {
    const listeners = new Set();
    chrome.runtime.onMessage = {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        hasListener: (fn) => listeners.has(fn),
    };
    chrome.runtime.sendMessage = vi.fn((_message, callback) => {
        const response = { ok: true, values: { isEnabled: true, dsPreventAutoScroll: true } };
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
    chrome.runtime.getURL = vi.fn(() => 'data:text/javascript,//content/prevent-auto-scroll.js');
    vi.resetModules();
    await import('../../content/ds-selectors.js');
    await import('../../content/feature-toggle.js');
    const mod = await import('../../content/prevent-auto-scroll-bridge.js');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return mod.default ?? mod;
}
