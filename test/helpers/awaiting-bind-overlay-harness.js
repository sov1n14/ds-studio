// 288 lines: one cohesive shared test harness - the SW chat-map writer double with its BIND hold and failure injection, the sampled storage-latency read gate and the content-script lifecycle all read and reset the same module-level state (stored map, held binds, held reads, samples, the loaded content script), and the per-case setUpCase()/tearDownCase() pair installs and restores them as one unit; splitting would spread that shared mutable state across modules.
/**
 * Harness of the chat-binding-controller.blank-flash-mutant-killers.*.spec.js files: the real content script on a happy-dom DeepSeek header, with the trust boundaries below under test control.
 *
 * Timing control: the SW chat-map writer double can hold the first BIND it receives until the test releases it. The content script serializes every chat-map read behind its pending chat-map writes, so a held BIND keeps the created chat's bind flow in flight for as long as the test needs; another tab's activePresetId write during the hold queues a settings broadcast whose overlay render lands right after the release, before the bind flow ends.
 *
 * Read gate: while holdReadsOnPath names a pathname, every settings read (a storage read that requests pinnedPresetId) issued on that pathname is held until releaseHeldReads(), up to readHoldsLeft reads. Holding the created chat's settings read stalls its bind flow after its chat-map read and before its BIND, the interleaving that the rule (3) and F2 tests exercise; chat-map reads stay ungated because another chat's flow queues behind them.
 *
 * Failure injection: opsToFail names a chat-map message type and a failure mode; the next dispatch of that type fails at the trust boundary as Chrome reports it (sendMessage rejects, sendMessage throws synchronously, or the SW answers {ok:false}) and is recorded in failedOps without committing. A chrome.storage read cannot fail a bind flow, because StorageManager resolves a failed read to an empty result, so a bind flow fails only through its chat-map write: the BIND of the created chat, or the UNBIND of a chat bound to a deleted group. The 10 s no-answer timeout mode is left out, because the client timeout runs on the real clock.
 *
 * Sampling (testing-pitfalls "Transient UI State"): chrome.storage.local.get and chrome.storage.sync.get deliver every read after a fixed latency and record what the overlay shows, with location.pathname, right before each delivery; a storage delivery is a macrotask boundary where the browser may paint.
 *
 * Test controls: a spec assigns isSampling, holdReadsOnPath and readHoldsLeft as its own variables (an ES module import cannot be assigned), and setUpCase() receives a read accessor and a takeReadHold callback over them.
 *
 * Why the harness is copied: the ctx wiring is built once, when content-script.js loads, so every test loads it itself; the seed, appendHeader, shownValue, pressEnter and sampled-latency helpers copy content-script.new-chat-blank-flash.scenario.spec.js, which keeps them private.
 *
 * Isolation: every MutationObserver a case creates is disconnected in tearDownCase(), so the body observer of an earlier content-script instance cannot run its navigation check in a later case.
 *
 * Mocked trust boundaries only: in-memory chrome.storage with real Chrome onChanged semantics and controlled read latency, the SW settings relay, the SW chat-map writer (promise-form sendMessage) and navigator (device profile). Every content module is real.
 */
import { expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import { setPathname } from './set-pathname.js';
import { writeChatMapLayout } from './chat-map-writer-harness.js';
import { relaySettingsChanged, silenceUnchangedWrites } from './chrome-storage-change-events.js';
import { waitForContentScriptInit } from './content-script-init-probe.js';

const HEADER_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/conversation-header.html'), 'utf8');
export const NEW_CHAT = '/a/chat/s';
export const CREATED = 'cccccccc-3333-3333-3333-333333333333';
export const OTHER = 'dddddddd-4444-4444-4444-444444444444';
export const chatPath = (uuid) => `${NEW_CHAT}/${uuid}`;
export const preset = (id, content) => ({ id, name: id, content, createdAt: 1, updatedAt: 1 });
export const A = preset('preset-A', 'PREFIX-A');
export const B = preset('preset-B', 'PREFIX-B');
export const G = preset('preset-G', 'PREFIX-G');
// Real Edge install on a non-touch Windows desktop, so Enter takes the desktop send path.
const DESKTOP = { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0' };
// Fixed latency (ms) of every storage read, modelling the async chrome.storage round trip.
const STORAGE_LATENCY_MS = 5;
const UNMOUNTED = '<unmounted>';
export const BLANK = '';
// settleUntilQuiet takes at least 250 ms a round and a case may run several, so the per-case timeout is widened.
export const CASE_OPTIONS = { timeout: 30000 };

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await wait(250); for (let i = 0; i < 30; i++) await wait(0); };
export let storageReads = 0;
/** Repeats settle until one whole round sees no storage read; at most 20 rounds. */
export async function settleUntilQuiet() {
    for (let round = 0; round < 20; round++) {
        const before = storageReads;
        await settle();
        if (storageReads === before) return;
    }
    throw new Error('settleUntilQuiet: storage reads kept arriving for 20 settle rounds; the content script never went quiet.');
}

export let storedMap;
let chatMapOps;
export let opsToFail;
export let failedOps;
let bindsToHold;
export let heldBinds;
/** SW chat-map writer double: records each dispatch and commits it, as background/chat-map-routes.js would; while bindsToHold > 0 the next BIND waits for releaseHeldBind() before it commits. */
async function serviceWorker(msg) {
    if (!Object.values(DSS_CHAT_MAP_MSG).includes(msg?.type)) return undefined;
    if (msg.type === DSS_CHAT_MAP_MSG.BIND && bindsToHold > 0) {
        bindsToHold -= 1;
        await new Promise((resolve) => heldBinds.push(resolve));
    }
    chatMapOps.push(structuredClone(msg));
    const next = { ...storedMap };
    if (msg.type === DSS_CHAT_MAP_MSG.BIND) next[msg.uuid] = msg.presetId;
    if (msg.type === DSS_CHAT_MAP_MSG.UNBIND) delete next[msg.uuid];
    storedMap = next;
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [next]);
    return { ok: true, map: { ...next } };
}
/** chrome.runtime.sendMessage double: the next dispatch whose type is listed in opsToFail fails in the mode of that entry and is recorded in failedOps; every other message reaches serviceWorker(). */
function sendToServiceWorker(msg) {
    const index = opsToFail.findIndex((f) => f.type === msg?.type);
    if (index < 0) return serviceWorker(msg);
    const [{ mode }] = opsToFail.splice(index, 1);
    failedOps.push(structuredClone(msg));
    if (mode === 'throw') throw new Error('Extension context invalidated.');
    if (mode === 'reject') return Promise.reject(new Error('The message port closed before a response was received.'));
    return Promise.resolve({ ok: false, error: 'QUOTA_BYTES_PER_ITEM quota exceeded' });
}
export const FAILURE_MODES = [
    { name: 'sendMessage rejects', mode: 'reject' },
    { name: 'sendMessage throws synchronously', mode: 'throw' },
    { name: 'the service worker answers ok:false', mode: 'not-ok' },
];
/** Settles a flow promise to its rejection reason, or null when it resolved. */
export const failureOf = (flow) => flow.then(() => null, (err) => err);

export const binds = () => chatMapOps.filter((m) => m.type === DSS_CHAT_MAP_MSG.BIND).map(({ uuid, presetId }) => ({ uuid, presetId }));
export const releaseHeldBind = () => heldBinds.shift()();

/** Waits until the SW double holds a BIND; throws when none arrives. */
async function waitForHeldBind() {
    for (let i = 0; i < 3000 && heldBinds.length === 0; i++) await wait(1);
    if (heldBinds.length === 0) throw new Error('waitForHeldBind: the created chat never dispatched its auto-bind BIND to the service worker.');
}

export async function seed({ presets = [A, B, G], map = {}, settings = {} } = {}) {
    const items = { isEnabled: true, globalPromptEnabled: false, dsPresetIndex: presets.map((p) => p.id), ...settings };
    presets.forEach((p) => { items[`dsPreset_${p.id}`] = p; });
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    storedMap = { ...map };
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [storedMap]);
}

export function appendHeader() {
    const holder = document.createElement('div');
    holder.innerHTML = HEADER_HTML;
    return document.body.appendChild(holder.firstElementChild);
}

export let cs;
let addedListeners;
let createdObservers;
const OriginalMutationObserver = globalThis.MutationObserver;
/** Records every MutationObserver a case creates, so tearDownCase() can disconnect them: a loaded content script keeps its body observer, which would otherwise run the navigation check of that old instance in later cases and issue reads on their gated pathname. */
class TrackedMutationObserver extends OriginalMutationObserver {
    constructor(callback) {
        super(callback);
        createdObservers.push(this);
    }
}
/** Evaluates content-script.js on `pathname`, waits for initSettings() to finish, then for the page to go quiet. */
export async function loadContentScript(pathname) {
    setPathname(pathname);
    const event = chrome.runtime.onMessage;
    const originalAdd = event.addListener;
    event.addListener = (fn) => { addedListeners.push(fn); originalAdd(fn); };
    try {
        vi.resetModules();
        cs = (await import('../../content/content-script.js')).default;
    } finally {
        event.addListener = originalAdd;
    }
    await waitForContentScriptInit(cs);
    await settleUntilQuiet();
    return cs.PresetOverlay;
}

export const shownValue = (overlay) => overlay.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? BLANK;
export const clickOption = (overlay, id) => overlay.dropdown.menu.querySelector(`.dss-preset-option[data-value="${id}"]`).click();

/** What the user sees right now: the selected group id, BLANK for the blank option, or UNMOUNTED when no overlay is in the page. */
function currentDisplay() {
    const overlay = cs?.PresetOverlay;
    if (!overlay?.wrapperEl?.isConnected || !overlay.dropdown?.menu) return UNMOUNTED;
    return shownValue(overlay);
}

// The spec's isSampling, holdReadsOnPath and readHoldsLeft, read through the accessor setUpCase() receives.
let controls;
export let heldReads;
/** Releases every storage read held by the read gate. */
export const releaseHeldReads = () => heldReads.splice(0).forEach((resolve) => resolve());

/** Waits until the read gate holds a settings read; throws when none arrives. */
export async function waitForHeldRead() {
    for (let i = 0; i < 3000 && heldReads.length === 0; i++) await wait(1);
    if (heldReads.length === 0) throw new Error('waitForHeldRead: no settings read was issued on the gated pathname.');
}

export let samples;
export function takeSample(at) {
    if (controls.read().isSampling) samples.push({ at, path: location.pathname, shown: currentDisplay() });
}

/** Wraps get on both storage areas: a settings read issued on holdReadsOnPath waits for releaseHeldReads(), each read is delivered STORAGE_LATENCY_MS later, and the screen is sampled right before delivery; returns a restore function. */
function installSampledStorageLatency() {
    const areas = [chrome.storage.local, chrome.storage.sync];
    const names = ['local', 'sync'];
    const originals = areas.map((area) => area.get);
    areas.forEach((area, i) => {
        area.get = function sampledGet(keys, callback) {
            if (typeof keys === 'function') { callback = keys; keys = null; }
            storageReads += 1;
            const { holdReadsOnPath, readHoldsLeft } = controls.read();
            const isGated = readHoldsLeft > 0 && Boolean(holdReadsOnPath) && location.pathname === holdReadsOnPath && Array.isArray(keys) && keys.includes(StorageManager.KEYS.PINNED_PRESET_ID);
            if (isGated) controls.takeReadHold();
            const gate = isGated ? new Promise((resolve) => heldReads.push(resolve)) : null;
            const delivered = originals[i].call(area, keys).then((result) => (gate ? gate.then(() => result) : result)).then((result) => new Promise((resolve) => {
                setTimeout(() => { takeSample(`storage.${names[i]}.get`); resolve(result); }, STORAGE_LATENCY_MS);
            }));
            if (callback) { delivered.then(callback); return undefined; }
            return delivered;
        };
    });
    return () => areas.forEach((area, i) => { area.get = originals[i]; });
}

export const label = (shown) => (shown === BLANK ? '(blank)' : shown);
export const describeSamples = (list) => list.map((s) => `${s.path.slice(NEW_CHAT.length) || 'new'}@${s.at}:${label(s.shown)}`).join(', ');

/** Focuses a page textarea holding `text` and presses Enter, as the user sends the first message of a new chat. */
export function pressEnter(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return ta;
}

/** Another DeepSeek tab picks group `id`: the global activePresetId changes and this tab receives the settings broadcast. */
export async function otherTabPicks(id) {
    await chrome.storage.local.set({ [StorageManager.KEYS.ACTIVE_PRESET_ID]: id });
}

/** Loads the new-chat page, picks `picked`, sends the first message and lets the URL move to the created chat; returns the in-flight handleChatChange promise once the SW double holds its BIND. */
export async function sendFirstMessageWithHeldBind(picked) {
    appendHeader();
    const overlay = await loadContentScript(NEW_CHAT);
    clickOption(overlay, picked.id);
    await settleUntilQuiet();
    expect(shownValue(overlay), `precondition: ${picked.id} is shown on the new chat before the send`).toBe(picked.id);
    bindsToHold = 1;
    const ta = pressEnter('first message');
    expect(ta.value, `precondition: the first send carries ${picked.id}`).toContain(picked.content);
    setPathname(chatPath(CREATED));
    const createdFlow = cs.handleChatChange();
    await waitForHeldBind();
    return { overlay, createdFlow };
}

let restoreNotify;
let restoreLatency;
let originalSendMessage;
/** beforeEach body: installs the boundary doubles and resets the harness state; `testControls` is { read: () => ({ isSampling, holdReadsOnPath, readHoldsLeft }), takeReadHold: () => void } over the spec's own variables. */
export function setUpCase(testControls) {
    controls = testControls;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.entries(DESKTOP).forEach(([key, value]) => Object.defineProperty(navigator, key, { configurable: true, get: () => value }));
    restoreNotify = silenceUnchangedWrites();
    chrome.storage.onChanged.addListener(relaySettingsChanged);
    originalSendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = vi.fn(sendToServiceWorker);
    restoreLatency = installSampledStorageLatency();
    chatMapOps = [];
    opsToFail = [];
    failedOps = [];
    bindsToHold = 0;
    heldBinds = [];
    heldReads = [];
    addedListeners = [];
    createdObservers = [];
    globalThis.MutationObserver = TrackedMutationObserver;
    samples = [];
    cs = null;
}

/** afterEach body, run after the spec stops sampling and clears holdReadsOnPath: releases every hold, tears down the content script and restores the boundaries. */
export async function tearDownCase() {
    // A held BIND would stall the shared StorageManager chat-map queue for the next case.
    while (heldBinds.length > 0) releaseHeldBind();
    releaseHeldReads();
    await settle();
    if (cs) {
        // Disable this instance's document-level injection listeners and remove its overlay.
        Object.assign(cs.state, { isEnabled: false, isInjecting: true });
        clearTimeout(cs.state.awaitingNewChatUuidTimer);
        cs.PresetOverlay.unmount();
        // This instance's body observer calls this method; make it a no-op so the overlay cannot mount into the next case's header.
        cs.PresetOverlay.scheduleFindAndMount = () => {};
    }
    createdObservers.forEach((observer) => observer.disconnect());
    globalThis.MutationObserver = OriginalMutationObserver;
    addedListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
    chrome.storage.onChanged.removeListener(relaySettingsChanged);
    restoreLatency();
    restoreNotify();
    chrome.runtime.sendMessage = originalSendMessage;
    Object.keys(DESKTOP).forEach((key) => delete navigator[key]);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    setPathname('/');
}
