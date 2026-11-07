/**
 * Shared harness for the content/auto-copy.js scenario specs (auto-copy reply / auto-copy code blocks).
 *
 * Real modules: content/ds-selectors.js, content/reply-completion.js, content/feature-toggle.js, content/auto-copy.js and the MAIN-world bridge content/react-click-bridge.main.js (same document here). Only chrome.runtime is stubbed (installChromeRuntime / respondWith / broadcast from auto-click-harness.js), so the gating runs through the real feature-toggle registry.
 *
 * Success criterion is activation, never "an event was dispatched": every host button on the page carries the live React expando with an onClick that counts only events whose nativeEvent is a trusted Event (testing-pitfalls "Host-Page Controls: Assert Activation, Not Dispatch"). The extension reaches that onClick only through `dss:react-click` on the button, which the bridge turns into a guarded onClick call; a plain untrusted `.click()` is ignored, as on the live page. Each activation appends the button's label to one shared log, so order across buttons is observable.
 *
 * Page: the captured chat pane (conv2-finished-chat-pane.html: header, message list, composer) with its `.ds-virtual-list-visible-items` replaced by the captured visible-items list from reply-completion-fixtures.js, so every part the fixtures expose (item, row, toolbar) lives inside a realistic page. Buttons are located by position in the captured markup, never through the selectors under test.
 */
import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import { installChromeRuntime, respondWith, requestedKeys, settle, loadBridge, MASTER_KEY } from './auto-click-harness.js';
import { loadVisibleItems, loadAssistantItem, loadCodeBlock, loadContinueContainer } from './reply-completion-fixtures.js';

export { MASTER_KEY, installChromeRuntime };
export const REPLY_KEY = 'isAutoCopyReplyEnabled';
export const CODE_KEY = 'isAutoCopyCodeEnabled';

const SNAPSHOT_DIR = path.resolve(__dirname, '../fixtures/ds-snapshots');
const MODULE_REL = 'content/auto-copy.js';
const MODULE_FILE = path.resolve(__dirname, '../..', MODULE_REL);
const moduleLoaders = import.meta.glob('../../content/auto-copy.js');
const realSetTimeout = globalThis.setTimeout;

// ─────────────────────────────────────────────────────────────────────────────
//  Activation log
// ─────────────────────────────────────────────────────────────────────────────

let log = [];
let reactKeySeq = 0;

/** Labels of the buttons activated so far, in activation order. */
export const activations = () => log.slice();

export function resetActivations() {
    log = [];
}

/** Give `el` the live React expandos and an isTrusted-guarded onClick that logs `label` once per accepted activation. A native click is delegated to onClick with the native (untrusted) event, as React's root listener does. */
export function guard(el, label) {
    reactKeySeq += 1;
    const props = {
        role: 'button',
        tabIndex: 0,
        onClick(e) {
            const nativeEvent = e?.nativeEvent;
            if (nativeEvent?.isTrusted === true && nativeEvent instanceof Event) log.push(label);
        },
    };
    el[`__reactFiber$ac${reactKeySeq}`] = { stateNode: el };
    el[`__reactProps$ac${reactKeySeq}`] = props;
    el.addEventListener('click', (nativeEvent) => props.onClick({ nativeEvent, target: el, currentTarget: el }));
    return el;
}

/** Guard every `role="button"` under `root` that is not guarded yet, labelled `${prefix}#i` in document order. */
export function guardRemaining(root, prefix) {
    [...root.querySelectorAll('[role="button"]')]
        .filter((el) => !Object.keys(el).some((k) => k.startsWith('__reactProps$')))
        .forEach((el, i) => guard(el, `${prefix}#${i}`));
}

const directButtons = (el) => Array.from(el.children).filter((c) => c.getAttribute('role') === 'button');

/** Guard a toolbar's six direct buttons: index 0 (the copy button) as `${name}:reply`, the others `${name}:toolbar#i`. */
function guardToolbar(toolbar, name) {
    const buttons = directButtons(toolbar);
    if (buttons.length !== 6) throw new Error(`toolbar of ${name} lost its six direct buttons`);
    buttons.forEach((el, i) => guard(el, i === 0 ? `${name}:reply` : `${name}:toolbar#${i}`));
    return buttons;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Page fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Append a captured code block (banner: [copy, download]) to `item`'s markdown; returns its two banner buttons guarded as `${name}:code#i` / `${name}:download#i`. The item must already hold `.ds-markdown` (assistant message body). */
export function addCodeBlock(item, name, index) {
    const block = loadCodeBlock();
    const buttons = [...block.querySelectorAll('[role="button"]')];
    if (buttons.length !== 2) throw new Error('code block fixture lost its two banner buttons (copy, download)');
    guard(buttons[0], `${name}:code#${index}`);
    guard(buttons[1], `${name}:download#${index}`);
    const markdown = item.querySelector('.ds-markdown');
    if (!markdown) throw new Error(`${name}: assistant item has no .ds-markdown to hold a code block`);
    markdown.appendChild(block);
    return { block, copy: buttons[0], download: buttons[1] };
}

/**
 * Mounts the captured chat pane with the captured visible-items list in place of its own, guards every button on the page (old assistant item's toolbar as `old:reply` / `old:toolbar#i`, everything else `page#i`), and returns the list plus the old assistant item's parts. `oldCodeBlock: true` adds a code block to the old item first (labels `old:code#0` / `old:download#0`).
 */
export function mountPage({ oldCodeBlock = false } = {}) {
    const fx = loadVisibleItems();
    guardToolbar(fx.toolbar, 'old');
    if (oldCodeBlock) addCodeBlock(fx.item, 'old', 0);
    document.body.innerHTML = fs.readFileSync(path.join(SNAPSHOT_DIR, 'conv2-finished-chat-pane.html'), 'utf8');
    const captured = document.querySelectorAll('.ds-virtual-list-visible-items');
    if (captured.length !== 1) throw new Error('chat pane fixture should hold exactly one .ds-virtual-list-visible-items');
    captured[0].replaceWith(fx.list);
    guardRemaining(document.body, 'page');
    return { list: fx.list, old: { item: fx.item, row: fx.row, toolbar: fx.toolbar } };
}

/** A fresh assistant item with key `key` whose toolbar row is detached (the state right after a new reply's item mounts); its toolbar buttons are guarded under `name`. Mount `item` first, flush, then append `row` to deliver the toolbar in a later batch, as the live page does. */
export function awaitingItem(key, name) {
    const parts = loadAssistantItem(key);
    parts.row.remove();
    guardToolbar(parts.toolbar, name);
    guardRemaining(parts.item, `${name}:body`);
    return parts;
}

/** A fresh assistant item with key `key`, toolbar inside (a scroll re-mount), every button guarded under `name`. */
export function completeItem(key, name) {
    const parts = loadAssistantItem(key);
    guardToolbar(parts.toolbar, name);
    guardRemaining(parts.item, `${name}:body`);
    return parts;
}

/** Turns a detached toolbar row into a stopped reply's row: DeepSeek's 「继续生成」 container arrives inside it (live POC 2026-11-08). Its button is guarded as `${name}:continue`. */
export function makeStopped(row, name) {
    const container = loadContinueContainer();
    guard(container.firstElementChild, `${name}:continue`);
    row.appendChild(container);
}

/** Let MutationObserver callbacks, promise chains and a zero-delay timer turn run (real timers; the auto-copy path has no timing logic). */
export async function flush() {
    await settle();
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    await settle();
}

/** Mount `parts.item` into `list`, flush, append its row, flush: a new reply completing. */
export async function completeNewReply(list, parts) {
    list.appendChild(parts.item);
    await flush();
    parts.item.appendChild(parts.row);
    await flush();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Module loading
// ─────────────────────────────────────────────────────────────────────────────

/** Answer every GET_SETTINGS with `values`, install the bridge and load fresh copies of the modules content/auto-copy.js depends on, in manifest order (ds-selectors, reply-completion, feature-toggle); utils/storage-manager.keys.js is preloaded by vitest.setup.js. */
export async function loadAutoCopyDependencies(values) {
    respondWith(values);
    await loadBridge();
    vi.resetModules();
    await import('../../content/ds-selectors.js');
    await import('../../content/reply-completion.js');
    await import('../../content/feature-toggle.js');
}

/**
 * Load fresh modules in manifest order and answer the initial GET_SETTINGS with `values`. The target is located by fs.existsSync + import.meta.glob (a runtime import() cannot resolve files outside test/), so a missing file fails each test with a message naming it. The module must register its toggles itself on load, like the sibling feature modules (auto-retry.js, auto-open-sidebar.js); a module that instead publishes DSstudio.AutoCopy.start() / init() is started through that. Either way it must request both own keys through GET_SETTINGS.
 */
export async function loadAutoCopy(values) {
    if (!fs.existsSync(MODULE_FILE)) throw new Error(`${MODULE_REL} does not exist (red phase: module not implemented yet)`);
    const load = Object.values(moduleLoaders)[0];
    if (!load) throw new Error(`${MODULE_REL} exists but import.meta.glob did not pick it up; fix the glob in auto-copy-harness.js`);
    await loadAutoCopyDependencies(values);
    await load();
    await flush();
    const hasRegistered = () => [REPLY_KEY, CODE_KEY].every((key) => requestedKeys().includes(key));
    if (!hasRegistered()) {
        const api = globalThis.DSstudio?.AutoCopy;
        const start = typeof api?.start === 'function' ? api.start : api?.init;
        if (typeof start === 'function') start.call(api);
        await flush();
    }
    if (!hasRegistered()) {
        throw new Error(`${MODULE_REL} loaded but never requested ${REPLY_KEY} and ${CODE_KEY} through GET_SETTINGS (no registerFeatureToggle on load and no DSstudio.AutoCopy.start/init)`);
    }
}
