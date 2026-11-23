/**
 * Scenario (content-script wiring): a late auto-bind flow of a created chat X writes only for X, never for the chat the user moved to before the flow resumed.
 *
 * Requirements: docs/FEATURES.md "Conversation-Bound Prompt Groups" (the group selected when the first message of a new chat is sent binds the created chat, and every chat keeps an independent binding) and docs/architecture/content-navigation.md "Navigation Detection" (step 5: a chat created by a send on the new-chat page is auto-bound to the pending group; an existing chat opened by hand is ordinary navigation and gets no binding). Derived rules: (1) X's bind flow, resuming after the user left X, still binds X to the group sent on the new-chat page; (2) it must not change what the chat the user is on now injects, shows or binds.
 *
 * Observed defect on the pre-fix tree (black-box probe, fake storage): while X's BIND is held and the user is on unbound chat Y, X's flow on release writes X's group G as the injection prefix of the page, so a send on Y in the window before Y's own flow settles carries G. The case holds X's BIND open with a deferred promise and settles it only after the context changed (testing-pitfalls "Overlapping Async Writes", late callback keyed by a captured chat).
 *
 * Why the group is edited in another tab: the send on X leaves G as the prefix of the page, and while X's BIND is held that leftover survives the switch to Y, so a send on Y carries G before and after the resume alike and the late write cannot be told apart from it. The settings broadcast of the edit clears that leftover on unbound Y (asserted as a precondition), so a G in a later send was written after the resume. With Y bound to another group the leftover survived the edit too (black-box probe on the pre-fix tree), so that variant cannot isolate the late write and is not tested here. A second new chat as the context change is not tested either: the same probe showed that the queued navigation flow of the new-chat page loses a group picked there while any chat-map write is held, even one that is not an auto-bind, so the loss cannot be attributed to X's flow.
 *
 * Stale settings snapshot (second case): the flow of X reads the settings before it dispatches its BIND, and after the BIND resumes it must not derive the global-prompt state of the chat the user moved to from that snapshot. The case turns the device-level global prompt off from the popup of another tab with no active group while the BIND is held, so the snapshot of X still has it on and unbound Y must inject no global prompt from then on. G has its own global prompt off, so the global-prompt state the new-chat page leaves on Y is already off when the user turns the flag off: with G on, the leftover would inject the global prompt on Y until the settings broadcast of the toggle resolves, and that broadcast waits behind the held BIND like the flow of Y, so a late write could not be told apart from the leftover.
 *
 * Timing control: the SW chat-map writer double holds the first BIND it receives until the test releases it. The content script serializes chat-map reads behind pending chat-map writes, so the flow of the chat the user moved to stays in flight behind the held BIND, and settles only after X's flow resumes.
 *
 * Sampling (testing-pitfalls "Transient UI State"): chrome.storage.local.get and chrome.storage.sync.get deliver every read after a fixed latency and record what the overlay shows and the prefix a send would carry (buildInjectionPrefix), with location.pathname, right before each delivery; a tracked flow also records one sample at the first microtask after it settles.
 *
 * Why the harness is copied: the ctx wiring is built once, when content-script.js loads, so every test loads it itself; the seed, appendHeader, shownValue, pressEnter, held-BIND and sampled-latency helpers copy chat-binding-controller.blank-flash-mutant-killers.spec.js, which keeps them private.
 *
 * Mocked trust boundaries only: in-memory chrome.storage with real Chrome onChanged semantics and controlled read latency, the SW settings relay, the SW chat-map writer (promise-form sendMessage) and navigator (device profile). Every content module is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import { writeChatMapLayout } from '../helpers/chat-map-writer-harness.js';
import { relaySettingsChanged, silenceUnchangedWrites } from '../helpers/chrome-storage-change-events.js';
import { waitForContentScriptInit } from '../helpers/content-script-init-probe.js';

const HEADER_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/conversation-header.html'), 'utf8');
const NEW_CHAT = '/a/chat/s';
const CREATED = 'cccccccc-3333-3333-3333-333333333333';
const OTHER = 'dddddddd-4444-4444-4444-444444444444';
const chatPath = (uuid) => `${NEW_CHAT}/${uuid}`;
const preset = (id, content) => ({ id, name: id, content, createdAt: 1, updatedAt: 1 });
const A = preset('preset-A', 'PREFIX-A');
const B = preset('preset-B', 'PREFIX-B');
const G = preset('preset-G', 'PREFIX-G');
// G after another tab edits its content while the auto-bind of X is held.
const EDITED_G = { ...G, content: 'EDITED-G', updatedAt: 2 };
// G with its own global prompt turned off (per-group flag), for the stale-settings case.
const G_GLOBAL_OFF = { ...G, globalPromptEnabled: false };
const GLOBAL_PROMPT = 'GLOBAL-INSTRUCTION';
// Real Edge install on a non-touch Windows desktop, so Enter takes the desktop send path.
const DESKTOP = { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0' };
// Fixed latency (ms) of every storage read, modelling the async chrome.storage round trip.
const STORAGE_LATENCY_MS = 5;
const UNMOUNTED = '<unmounted>';
const BLANK = '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await wait(250); for (let i = 0; i < 30; i++) await wait(0); };
let storageReads = 0;
/** Repeats settle until one whole round sees no storage read; at most 20 rounds. */
async function settleUntilQuiet() {
    for (let round = 0; round < 20; round++) {
        const before = storageReads;
        await settle();
        if (storageReads === before) return;
    }
    throw new Error('settleUntilQuiet: storage reads kept arriving for 20 settle rounds; the content script never went quiet.');
}

let storedMap;
let bindsToHold;
let heldBinds;
/** SW chat-map writer double: records each dispatch and commits it, as background/chat-map-routes.js would; while bindsToHold > 0 the next BIND waits for releaseHeldBind() before it commits. */
async function serviceWorker(msg) {
    if (!Object.values(DSS_CHAT_MAP_MSG).includes(msg?.type)) return undefined;
    if (msg.type === DSS_CHAT_MAP_MSG.BIND && bindsToHold > 0) {
        bindsToHold -= 1;
        await new Promise((resolve) => heldBinds.push(resolve));
    }
    const next = { ...storedMap };
    if (msg.type === DSS_CHAT_MAP_MSG.BIND) next[msg.uuid] = msg.presetId;
    if (msg.type === DSS_CHAT_MAP_MSG.UNBIND) delete next[msg.uuid];
    storedMap = next;
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [next]);
    return { ok: true, map: { ...next } };
}
const releaseHeldBind = () => heldBinds.shift()();

/** Waits until the SW double holds a BIND; throws when none arrives. */
async function waitForHeldBind() {
    for (let i = 0; i < 3000 && heldBinds.length === 0; i++) await wait(1);
    if (heldBinds.length === 0) throw new Error('waitForHeldBind: the created chat never dispatched its auto-bind BIND to the service worker.');
}

async function seed({ presets = [A, B, G], map = {}, settings = {} } = {}) {
    const items = { isEnabled: true, globalPromptEnabled: false, dsPresetIndex: presets.map((p) => p.id), ...settings };
    presets.forEach((p) => { items[`dsPreset_${p.id}`] = p; });
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    storedMap = { ...map };
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [storedMap]);
}

function appendHeader() {
    const holder = document.createElement('div');
    holder.innerHTML = HEADER_HTML;
    return document.body.appendChild(holder.firstElementChild);
}

let cs;
let addedListeners;
let createdObservers;
const OriginalMutationObserver = globalThis.MutationObserver;
/** Records every MutationObserver a case creates, so afterEach can disconnect them and an old content-script instance cannot run its navigation check in a later case. */
class TrackedMutationObserver extends OriginalMutationObserver {
    constructor(callback) {
        super(callback);
        createdObservers.push(this);
    }
}
/** Evaluates content-script.js on `pathname`, waits for initSettings() to finish, then for the page to go quiet. */
async function loadContentScript(pathname) {
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

const shownValue = (overlay) => overlay.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? BLANK;
const clickOption = (overlay, id) => overlay.dropdown.menu.querySelector(`.dss-preset-option[data-value="${id}"]`).click();

/** What the user sees right now: the selected group id, BLANK for the blank option, or UNMOUNTED when no overlay is in the page. */
function currentDisplay() {
    const overlay = cs?.PresetOverlay;
    if (!overlay?.wrapperEl?.isConnected || !overlay.dropdown?.menu) return UNMOUNTED;
    return shownValue(overlay);
}

let samples;
let isSampling;
function takeSample(at) {
    if (isSampling) samples.push({ at, path: location.pathname, shown: currentDisplay(), prefix: cs?.buildInjectionPrefix() ?? '' });
}

/** Wraps get on both storage areas: each read is delivered STORAGE_LATENCY_MS later, and the screen is sampled right before delivery; returns a restore function. */
function installSampledStorageLatency() {
    const areas = [chrome.storage.local, chrome.storage.sync];
    const names = ['local', 'sync'];
    const originals = areas.map((area) => area.get);
    areas.forEach((area, i) => {
        area.get = function sampledGet(keys, callback) {
            if (typeof keys === 'function') { callback = keys; keys = null; }
            storageReads += 1;
            const delivered = originals[i].call(area, keys).then((result) => new Promise((resolve) => {
                setTimeout(() => { takeSample(`storage.${names[i]}.get`); resolve(result); }, STORAGE_LATENCY_MS);
            }));
            if (callback) { delivered.then(callback); return undefined; }
            return delivered;
        };
    });
    return () => areas.forEach((area, i) => { area.get = originals[i]; });
}

const label = (shown) => (shown === BLANK ? '(blank)' : shown);
const describePrefixSamples = (list) => list.map((s) => s.at + ':' + (s.prefix.includes(GLOBAL_PROMPT) ? 'global' : 'no-global')).join(', ');
const describeSamples = (list) => list.map((s) => `${s.path.slice(NEW_CHAT.length) || 'new'}@${s.at}:${label(s.shown)}`).join(', ');

/** Focuses a page textarea holding `text`, presses Enter as the user sends a message, and detaches it so later sends find only their own textarea; the returned element keeps the sent value. */
function pressEnter(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    ta.remove();
    return ta;
}

/** Another tab saves `edited` over the stored group with the same id, in both storage areas as seed() stores groups; this tab receives the settings broadcast. */
async function editInAnotherTab(edited) {
    await chrome.storage.local.set({ [`dsPreset_${edited.id}`]: edited });
    await chrome.storage.sync.set({ [`dsPreset_${edited.id}`]: edited });
}

/** Tracks whether a flow promise has settled, without letting its rejection escape; with `at`, records a sample at the first microtask after it settles. */
function track(flow, at) {
    const tracked = { done: false };
    const onSettled = () => { if (at) takeSample(at); tracked.done = true; };
    tracked.promise = flow.then(onSettled, onSettled);
    return tracked;
}

/** Loads the new-chat page, picks `picked`, sends the first message and lets the URL move to the created chat X; returns X's in-flight bind flow once the SW double holds its BIND. */
async function sendFirstMessageWithHeldBind(picked) {
    appendHeader();
    const overlay = await loadContentScript(NEW_CHAT);
    clickOption(overlay, picked.id);
    await settleUntilQuiet();
    expect(shownValue(overlay), `precondition: ${picked.id} is shown on the new chat before the send`).toBe(picked.id);
    bindsToHold = 1;
    const ta = pressEnter('first message');
    expect(ta.value, `precondition: the first send carries ${picked.id}`).toContain(picked.content);
    setPathname(chatPath(CREATED));
    const createdFlow = track(cs.handleChatChange(), 'flow-of-X-ended');
    await waitForHeldBind();
    return { overlay, createdFlow };
}

// settleUntilQuiet takes at least 250 ms a round and a case may run several, so the per-case timeout is widened.
describe('a late auto-bind flow of created chat X writes only for X, not for the chat the user moved to', { timeout: 30000 }, () => {
    let restoreNotify;
    let restoreLatency;
    const originalSendMessage = chrome.runtime.sendMessage;

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.entries(DESKTOP).forEach(([key, value]) => Object.defineProperty(navigator, key, { configurable: true, get: () => value }));
        restoreNotify = silenceUnchangedWrites();
        chrome.storage.onChanged.addListener(relaySettingsChanged);
        chrome.runtime.sendMessage = vi.fn(serviceWorker);
        restoreLatency = installSampledStorageLatency();
        bindsToHold = 0;
        heldBinds = [];
        addedListeners = [];
        createdObservers = [];
        globalThis.MutationObserver = TrackedMutationObserver;
        samples = [];
        isSampling = false;
        cs = null;
    });

    afterEach(async () => {
        isSampling = false;
        // A held BIND would stall the shared StorageManager chat-map queue for the next case.
        while (heldBinds.length > 0) releaseHeldBind();
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
    });

    // Context change, another existing chat: the user opens unbound chat Y by hand while the auto-bind of X to G is held, and edits the content of G in another tab. Y has no binding, so a send on Y carries no group: before the flow of X resumes (the precondition that the settings broadcast of the edit has cleared the prefix left over from the send on X), right after it resumes, and once Y settles. Y stays unbound and shows the blank option, and X still ends bound to G.
    it('unbound chat Y opened while the auto-bind of X to G is held, G edited in another tab: right after the flow of X resumes, a send on Y still carries no group, Y stays unbound and blank, and X is bound to G', async () => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        const { overlay, createdFlow } = await sendFirstMessageWithHeldBind(G);

        isSampling = true;
        setPathname(chatPath(OTHER));
        const otherFlow = track(cs.handleChatChange());
        takeSample('after-switch');
        await settleUntilQuiet();
        await editInAnotherTab(EDITED_G);
        await settleUntilQuiet();
        expect(heldBinds.length, 'precondition: the BIND of X is still held after the switch to Y and the edit of G').toBe(1);
        expect(otherFlow.done, 'precondition: the flow of Y waits behind the held BIND of X').toBe(false);
        const beforeRelease = pressEnter('message on Y before X resumes');
        expect(beforeRelease.value, 'precondition: before the flow of X resumes, a send on unbound Y carries no group, so a group in a later send was written after the resume').not.toContain('PREFIX-');
        expect(beforeRelease.value, 'precondition: before the flow of X resumes, a send on unbound Y carries no group, so a group in a later send was written after the resume').not.toContain(EDITED_G.content);

        releaseHeldBind();
        await createdFlow.promise;
        expect(otherFlow.done, 'precondition: the flow of Y is still in flight when the flow of X has ended, so the next send lands inside the window').toBe(false);
        const inWindow = pressEnter('message on Y right after X resumes');
        await otherFlow.promise;
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;
        const afterSettle = pressEnter('message on Y after it settles');

        expect(storedMap[CREATED], 'the late flow of X still binds X to the G sent on the new-chat page').toBe(G.id);
        expect(inWindow.value, 'the late flow of X must not write its group G as the prefix of unbound chat Y: a send on Y right after the flow of X resumes carries no group').not.toContain(G.content);
        expect(inWindow.value, 'the late flow of X must not write its group G as the prefix of unbound chat Y: a send on Y right after the flow of X resumes carries no group').not.toContain(EDITED_G.content);
        expect(storedMap[OTHER], 'Y was opened by hand, so the late flow of X must not bind Y').toBeUndefined();
        expect(samples.every((s) => s.path === chatPath(OTHER)), 'precondition: every sample was taken on Y').toBe(true);
        expect(samples.filter((s) => s.shown !== BLANK), `Y is unbound, so from the switch until it settles Y must show the blank option, never the G of X; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(afterSettle.value, 'once Y settles, a send on unbound Y carries no group').not.toContain('PREFIX-');
        expect(afterSettle.value, 'once Y settles, a send on unbound Y carries no group').not.toContain(EDITED_G.content);
        expect(shownValue(overlay), 'Y ends on the blank option').toBe(BLANK);
    });

    // Stale settings snapshot: the device-level global prompt is on when the flow of X reads the settings, and the user turns it off from the popup of another tab with no active group while the auto-bind of X is held and the user is on unbound chat Y. Y has no group, so the device-level flag decides its global prompt, which is now off: from the toggle until Y settles, including right after the flow of X resumes, the prefix a send on Y carries never holds the global prompt and the overlay shows the blank option.
    it('global prompt turned off while the auto-bind of X is held and the user is on unbound chat Y: from the toggle until Y settles, Y never injects the global prompt that the settings read by X still had on, and Y stays blank', async () => {
        await seed({
            presets: [A, B, G_GLOBAL_OFF],
            settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id, globalPromptEnabled: true, [StorageManager.KEYS.GLOBAL_DEFAULT_PROMPT]: GLOBAL_PROMPT },
        });
        const { overlay, createdFlow } = await sendFirstMessageWithHeldBind(G_GLOBAL_OFF);

        isSampling = true;
        setPathname(chatPath(OTHER));
        const otherFlow = track(cs.handleChatChange(), 'flow-of-Y-ended');
        takeSample('after-switch');
        await settleUntilQuiet();
        const fromToggle = samples.length;
        // The popup of another tab with no active group writes the device-level flag, as popup.toggles.js does.
        await StorageManager.saveGlobalPromptEnabled(false);
        takeSample('after-toggle');
        await settleUntilQuiet();
        expect(heldBinds.length, 'precondition: the BIND of X is still held after the switch to Y and the toggle').toBe(1);
        expect(otherFlow.done, 'precondition: the flow of Y waits behind the held BIND of X').toBe(false);
        const beforeRelease = pressEnter('message on Y before X resumes');
        expect(beforeRelease.value, 'precondition: before the flow of X resumes, a send on Y carries no global prompt, so a global prompt in a later send was written after the resume').not.toContain(GLOBAL_PROMPT);

        releaseHeldBind();
        await createdFlow.promise;
        expect(otherFlow.done, 'precondition: the flow of Y is still in flight when the flow of X has ended, so the next send lands inside the window').toBe(false);
        const inWindow = pressEnter('message on Y right after X resumes');
        await otherFlow.promise;
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;
        const afterSettle = pressEnter('message on Y after it settles');

        const afterToggle = samples.slice(fromToggle);
        expect(storedMap[CREATED], 'the late flow of X still binds X to the G sent on the new-chat page').toBe(G.id);
        expect(afterToggle.some((s) => s.at === 'flow-of-X-ended'), 'precondition: a sample was taken right after the flow of X ended').toBe(true);
        expect(samples.every((s) => s.path === chatPath(OTHER)), 'precondition: every sample was taken on Y').toBe(true);
        expect(afterToggle.filter((s) => s.prefix.includes(GLOBAL_PROMPT)), `the global prompt is off and unbound Y follows the device-level flag, so from the toggle until Y settles a send on Y must never carry the global prompt that the settings read by X still had on; samples: ${describePrefixSamples(afterToggle)}`).toEqual([]);
        expect(inWindow.value, 'a send on Y right after the flow of X resumes carries no global prompt').not.toContain(GLOBAL_PROMPT);
        expect(afterSettle.value, 'once Y settles, a send on Y carries no global prompt').not.toContain(GLOBAL_PROMPT);
        expect(samples.filter((s) => s.shown !== BLANK), `Y is unbound, so from the switch until it settles Y must show the blank option; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(shownValue(overlay), 'Y ends on the blank option').toBe(BLANK);
    });
});
