/**
 * Scenario (content-script wiring): which group the preset overlay shows while the chat DeepSeek created from a new-chat send is still waiting for its auto-bind, and after that bind flow ends.
 *
 * Requirements: docs/FEATURES.md "Conversation-Bound Prompt Groups" (a chat with a uuid shows the group it is bound to, and the group selected when the first message of a new chat is sent binds the created chat) and the v4.39.27 fix recorded in testing-pitfalls "Transient UI State" (a chat awaiting its bind resolves like the new-chat page, pending pick then pinned group, until the bind flow ends). Derived rules: (1) only the created chat that is awaiting its auto-bind and has no binding resolves like the new-chat page; any other chat shows its own binding, or the blank option when it has none, even while that auto-bind is in flight; (2) a chat that has a binding shows its bound group, even while its own auto-bind is still in flight; (3) once the bind flow ends, the created chat resolves from its binding alone, so a created chat left unbound shows the blank option, not the pinned group.
 *
 * Timing control: the SW chat-map writer double can hold the first BIND it receives until the test releases it. The content script serializes every chat-map read behind its pending chat-map writes, so a held BIND keeps the created chat's bind flow in flight for as long as the test needs; another tab's activePresetId write during the hold queues a settings broadcast whose overlay render lands right after the release, before the bind flow ends.
 *
 * Read gate: while holdReadsOnPath names a pathname, every settings read (a storage read that requests pinnedPresetId) issued on that pathname is held until releaseHeldReads(), up to readHoldsLeft reads. Holding the created chat's settings read stalls its bind flow after its chat-map read and before its BIND, the interleaving that the rule (3) and F2 tests below exercise; chat-map reads stay ungated because another chat's flow queues behind them.
 *
 * Failure injection: opsToFail names a chat-map message type and a failure mode; the next dispatch of that type fails at the trust boundary as Chrome reports it (sendMessage rejects, sendMessage throws synchronously, or the SW answers {ok:false}) and is recorded in failedOps without committing. A chrome.storage read cannot fail a bind flow, because StorageManager resolves a failed read to an empty result, so a bind flow fails only through its chat-map write: the BIND of the created chat, or the UNBIND of a chat bound to a deleted group. The 10 s no-answer timeout mode is left out, because the client timeout runs on the real clock.
 *
 * Sampling (testing-pitfalls "Transient UI State"): chrome.storage.local.get and chrome.storage.sync.get deliver every read after a fixed latency and record what the overlay shows, with location.pathname, right before each delivery; a storage delivery is a macrotask boundary where the browser may paint.
 *
 * Why the harness is copied: the ctx wiring is built once, when content-script.js loads, so every test loads it itself; the seed, appendHeader, shownValue, pressEnter and sampled-latency helpers copy content-script.new-chat-blank-flash.scenario.spec.js, which keeps them private.
 *
 * Isolation: every MutationObserver a case creates is disconnected in afterEach, so the body observer of an earlier content-script instance cannot run its navigation check in a later case.
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
let chatMapOps;
let opsToFail;
let failedOps;
let bindsToHold;
let heldBinds;
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
const FAILURE_MODES = [
    { name: 'sendMessage rejects', mode: 'reject' },
    { name: 'sendMessage throws synchronously', mode: 'throw' },
    { name: 'the service worker answers ok:false', mode: 'not-ok' },
];
/** Settles a flow promise to its rejection reason, or null when it resolved. */
const failureOf = (flow) => flow.then(() => null, (err) => err);

const binds = () => chatMapOps.filter((m) => m.type === DSS_CHAT_MAP_MSG.BIND).map(({ uuid, presetId }) => ({ uuid, presetId }));
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
/** Records every MutationObserver a case creates, so afterEach can disconnect them: a loaded content script keeps its body observer, which would otherwise run the navigation check of that old instance in later cases and issue reads on their gated pathname. */
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

let holdReadsOnPath;
// How many more settings reads the gate holds; Infinity holds every one.
let readHoldsLeft;
let heldReads;
/** Releases every storage read held by the read gate. */
const releaseHeldReads = () => heldReads.splice(0).forEach((resolve) => resolve());

/** Waits until the read gate holds a settings read; throws when none arrives. */
async function waitForHeldRead() {
    for (let i = 0; i < 3000 && heldReads.length === 0; i++) await wait(1);
    if (heldReads.length === 0) throw new Error('waitForHeldRead: no settings read was issued on the gated pathname.');
}

let samples;
let isSampling;
function takeSample(at) {
    if (isSampling) samples.push({ at, path: location.pathname, shown: currentDisplay() });
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
            const isGated = readHoldsLeft > 0 && Boolean(holdReadsOnPath) && location.pathname === holdReadsOnPath && Array.isArray(keys) && keys.includes(StorageManager.KEYS.PINNED_PRESET_ID);
            if (isGated) readHoldsLeft -= 1;
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

const label = (shown) => (shown === BLANK ? '(blank)' : shown);
const describeSamples = (list) => list.map((s) => `${s.path.slice(NEW_CHAT.length) || 'new'}@${s.at}:${label(s.shown)}`).join(', ');

/** Focuses a page textarea holding `text` and presses Enter, as the user sends the first message of a new chat. */
function pressEnter(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return ta;
}

/** Another DeepSeek tab picks group `id`: the global activePresetId changes and this tab receives the settings broadcast. */
async function otherTabPicks(id) {
    await chrome.storage.local.set({ [StorageManager.KEYS.ACTIVE_PRESET_ID]: id });
}

/** Loads the new-chat page, picks `picked`, sends the first message and lets the URL move to the created chat; returns the in-flight handleChatChange promise once the SW double holds its BIND. */
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
    const createdFlow = cs.handleChatChange();
    await waitForHeldBind();
    return { overlay, createdFlow };
}

// settleUntilQuiet takes at least 250 ms a round and a case may run several, so the per-case timeout is widened.
describe('the preset overlay while a created chat awaits its auto-bind, and after the bind flow ends', { timeout: 30000 }, () => {
    let restoreNotify;
    let restoreLatency;
    const originalSendMessage = chrome.runtime.sendMessage;

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.entries(DESKTOP).forEach(([key, value]) => Object.defineProperty(navigator, key, { configurable: true, get: () => value }));
        restoreNotify = silenceUnchangedWrites();
        chrome.storage.onChanged.addListener(relaySettingsChanged);
        chrome.runtime.sendMessage = vi.fn(sendToServiceWorker);
        restoreLatency = installSampledStorageLatency();
        chatMapOps = [];
        opsToFail = [];
        failedOps = [];
        bindsToHold = 0;
        heldBinds = [];
        holdReadsOnPath = null;
        readHoldsLeft = Infinity;
        heldReads = [];
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
        holdReadsOnPath = null;
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
    });

    // Rule (1): the awaiting state belongs to the created chat only. Another chat opened while that bind is in flight shows its own binding, never the group picked for the created chat.
    it.each([
        { name: 'an unbound chat shows the blank option', map: {}, expected: BLANK },
        { name: 'a chat bound to B shows B', map: { [OTHER]: B.id }, expected: B.id },
    ])('switching to another chat while the created chat still awaits its bind to G: $name at every step, never G', async ({ map, expected }) => {
        await seed({ map, settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        const { overlay, createdFlow } = await sendFirstMessageWithHeldBind(G);
        expect(shownValue(overlay), 'precondition: the created chat shows the picked G while its bind is held').toBe(G.id);

        isSampling = true;
        setPathname(chatPath(OTHER));
        const otherFlow = cs.handleChatChange();
        takeSample('after-switch');
        await otherTabPicks(A.id);
        await settleUntilQuiet();
        expect(heldBinds.length, 'precondition: the BIND of the created chat is still held after the switch and the write from the other tab').toBe(1);
        releaseHeldBind();
        await Promise.all([createdFlow, otherFlow]);
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(samples.length, 'precondition: the screen was sampled after the switch').toBeGreaterThan(2);
        expect(samples.every((s) => s.path === chatPath(OTHER)), 'precondition: every sample was taken on the other chat').toBe(true);
        expect(samples.filter((s) => s.shown !== expected), `the other chat must show ${label(expected)} from the switch until it settles, never the G picked for the created chat; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(binds(), 'the created chat is still bound to G through the SW writer').toEqual([{ uuid: CREATED, presetId: G.id }]);
        expect(storedMap[OTHER], 'the other chat keeps its stored binding').toBe(map[OTHER]);
    });

    // Rule (2): a binding wins over the awaiting state. The user re-picks B on the created chat while its auto-bind to G is held; from the pick on, the overlay shows B.
    it('re-picking B on the created chat while its auto-bind to G is in flight: the overlay shows B at every step and the stored binding ends on B', async () => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        const { overlay, createdFlow } = await sendFirstMessageWithHeldBind(G);

        isSampling = true;
        clickOption(overlay, B.id);
        takeSample('after-pick');
        await settleUntilQuiet();
        expect(heldBinds.length, 'precondition: the auto-bind to G is still held after the re-pick').toBe(1);
        releaseHeldBind();
        await createdFlow;
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(samples.length, 'precondition: the screen was sampled after the re-pick').toBeGreaterThan(2);
        expect(samples.filter((s) => s.shown !== B.id), `the user bound the created chat to B by the later pick, so from that pick until it settles the overlay must show B; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(binds(), 'the SW writer committed the auto-bind to G, then the re-pick to B').toEqual([{ uuid: CREATED, presetId: G.id }, { uuid: CREATED, presetId: B.id }]);
        expect(storedMap[CREATED], 'the stored binding ends on the later pick B').toBe(B.id);
    });

    // Rule (3): after the bind flow ends, the created chat resolves from its binding alone. With a pinned group A and an explicit blank pick, nothing is bound, so the created chat shows the blank option, at once and on a later render.
    it('blank picked over a pinned group, then sent: once the bind flow ends the created chat shows the blank option, not the pinned group, and stays blank on a later render', async () => {
        await seed({ settings: { [StorageManager.KEYS.PINNED_PRESET_ID]: A.id, [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        expect(shownValue(overlay), 'precondition: the pinned group A is preselected on the new chat').toBe(A.id);
        clickOption(overlay, BLANK);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: the blank option is shown after the user picks it').toBe(BLANK);
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries no group prefix').not.toContain('PREFIX-');

        setPathname(chatPath(CREATED));
        await cs.handleChatChange();
        await settleUntilQuiet();
        expect(shownValue(overlay), 'the created chat has no binding, so once its bind flow ends it shows the blank option, not the pinned A').toBe(BLANK);

        await otherTabPicks(B.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'a later render of the unbound created chat still resolves from its absent binding: blank').toBe(BLANK);
        expect(binds(), 'nothing was bound: the user sent with the blank option').toEqual([]);
    });
    // Rule (3), with the bind flow of X stalled before its BIND (docs/architecture/content-navigation.md "Which Preset Id the Overlay Displays": the controller clears the awaiting marker when the bind flow ends): the created chat X stalls before its BIND and chat Y's bind flow ends first, clearing the pending pick. The user returns to X while X's flow is still stalled, another tab picks G, and only then does X's flow resume, skip its BIND and leave X unbound. Back on X, the overlay must show the blank option at every step; the pinned A would be a value shown and then taken back. Y's flow stored B as the global activePresetId, so the other tab must pick a different group: a pick of B writes an unchanged value and Chrome fires no onChanged event, so no render would land while the marker of the created chat is still set.
    it('created chat X stalled before its BIND, chat Y bound to B settles first, the user returns to X while X is still stalled and another tab picks G, then X resumes: X never shows the pinned A and ends on the blank option', async () => {
        await seed({ map: { [OTHER]: B.id }, settings: { [StorageManager.KEYS.PINNED_PRESET_ID]: A.id, [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        expect(shownValue(overlay), 'precondition: the pinned group A is preselected on the new chat').toBe(A.id);
        clickOption(overlay, G.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: G is shown on the new chat before the send').toBe(G.id);
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries G').toContain(G.content);

        // Hold the settings read of X's bind flow, so X stalls before its BIND.
        holdReadsOnPath = chatPath(CREATED);
        setPathname(chatPath(CREATED));
        const createdFlow = cs.handleChatChange();
        await waitForHeldRead();
        holdReadsOnPath = null;

        // Y's bind flow runs to its end while X is stalled.
        setPathname(chatPath(OTHER));
        await cs.handleChatChange();
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: chat Y shows its bound B while X is stalled').toBe(B.id);
        expect(binds(), 'precondition: X stalled before dispatching its BIND').toEqual([]);

        // Return to X while its flow is still stalled, then another tab picks G, then X's held read is released.
        isSampling = true;
        setPathname(chatPath(CREATED));
        const backFlow = cs.handleChatChange();
        takeSample('after-back');
        await otherTabPicks(G.id);
        await settleUntilQuiet();
        expect(heldReads.length, 'precondition: X\'s settings read is still held after the return and the pick from the other tab').toBeGreaterThan(0);
        releaseHeldReads();
        await Promise.all([createdFlow, backFlow]);
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(binds(), 'precondition: the bind flow of X ended without a BIND, so X is unbound').toEqual([]);
        expect(samples.length, 'precondition: the screen was sampled after returning to X').toBeGreaterThan(2);
        expect(samples.every((s) => s.path === chatPath(CREATED)), 'precondition: every sample was taken on X').toBe(true);
        expect(samples.filter((s) => s.shown === A.id), `X ends unbound, so from the return until it settles the overlay must never show the pinned A; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(samples[samples.length - 1].shown, `X has no binding, so it ends on the blank option; samples: ${describeSamples(samples)}`).toBe(BLANK);
        expect(await StorageManager.getChatPresetMap(), 'the stored chatPresetMap holds only Y bound to B').toEqual({ [OTHER]: B.id });
    });

    // Navigation render at the send (docs/architecture/content-navigation.md "Navigation Detection" step 2: when the page had no UUID and awaitingNewChatUuid is set, the navigation-time overlay update is skipped, so what the new chat displayed stays displayed). No group is picked and none is pinned on arrival, so the new chat shows the blank option. The user then pins A in the popup: the content script does not re-render the overlay for a pinnedPresetId change, so it stays blank. The user toggles the global prompt switch with no active group, which writes globalPromptEnabled; the content script re-reads its settings for that, without re-rendering the overlay, so its last-read settings now hold the pin while the overlay shows blank. The send carries no group and the created chat stays unbound, so from the send until it settles it must show the blank option; the pinned A would be a value shown and then taken back.
    it('nothing picked on the new chat, A pinned from the popup and the global prompt switch toggled, then sent: the created chat shows the blank option at every step from the send, never the pinned A', async () => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: '', [StorageManager.KEYS.PINNED_PRESET_ID]: '' } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        expect(shownValue(overlay), 'precondition: nothing picked or pinned, so the new chat shows the blank option').toBe(BLANK);

        // The popup pins A: stored '' becomes A, so onChanged fires.
        await StorageManager.savePinnedPresetId(A.id);
        await settleUntilQuiet();
        expect((await StorageManager.getSettings()).pinnedPresetId, 'precondition: A is stored as the pinned group').toBe(A.id);
        expect(shownValue(overlay), 'precondition: pinning on the open new chat leaves the overlay on the blank option').toBe(BLANK);

        // The popup toggles the global prompt switch with no active group: stored false becomes true, so onChanged fires and the content script re-reads its settings.
        const readsBeforeToggle = storageReads;
        await StorageManager.saveGlobalPromptEnabled(true);
        await settleUntilQuiet();
        expect(storageReads, 'precondition: the global prompt switch change made the content script read storage').toBeGreaterThan(readsBeforeToggle);
        expect(shownValue(overlay), 'precondition: the global prompt switch change leaves the overlay on the blank option').toBe(BLANK);

        isSampling = true;
        takeSample('before-send');
        const ta = pressEnter('first message');
        setPathname(chatPath(CREATED));
        const createdFlow = cs.handleChatChange();
        takeSample('after-send-navigation');
        await createdFlow;
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(ta.value, 'precondition: the first send carries no group prefix').not.toContain('PREFIX-');
        expect(binds(), 'precondition: nothing was bound, the user sent with no group').toEqual([]);
        expect(samples.length, 'precondition: the screen was sampled from the send until the created chat settled').toBeGreaterThan(3);
        expect(samples.filter((s) => s.shown !== BLANK), `the new chat showed the blank option at the send and the created chat stays unbound, so from the send until it settles the overlay must show the blank option, never the pinned A; samples: ${describeSamples(samples)}`).toEqual([]);
    });

    // F1, the own flow fails (docs/architecture/content-navigation.md "Which Preset Id the Overlay Displays": the controller clears the awaiting marker also when the bind flow fails, and from then on the chat resolves from chatPresetMap alone). The auto-bind write of X to G fails before the flow clears the pending pick, so X stays unbound; a later render of X must resolve from its absent binding (blank), not like the new-chat page (the pending G).
    it.each(FAILURE_MODES)('created chat X whose own auto-bind write to G fails ($name): a later render of X resolves from chatPresetMap and shows the blank option, not the pending G', async ({ mode }) => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, G.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: G is shown on the new chat before the send').toBe(G.id);
        expect((await StorageManager.getSettings()).activePresetId, 'precondition: the pick stored G as activePresetId, so the later write of A differs and fires onChanged').toBe(G.id);
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries G').toContain(G.content);

        opsToFail.push({ type: DSS_CHAT_MAP_MSG.BIND, mode });
        setPathname(chatPath(CREATED));
        const flowError = await failureOf(cs.handleChatChange());
        expect(flowError, 'precondition: the bind flow of X failed').toBeInstanceOf(Error);
        expect(failedOps.map(({ type, uuid, presetId }) => ({ type, uuid, presetId })), 'precondition: the failed write is the auto-bind of X to G').toEqual([{ type: DSS_CHAT_MAP_MSG.BIND, uuid: CREATED, presetId: G.id }]);
        await settleUntilQuiet();

        isSampling = true;
        await otherTabPicks(A.id);
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(samples.length, 'precondition: the write from the other tab triggered storage reads on X').toBeGreaterThan(1);
        expect(samples.every((s) => s.path === chatPath(CREATED)), 'precondition: every sample was taken on X').toBe(true);
        expect(shownValue(overlay), `the bind flow of X failed and X has no binding, so a later render resolves X from chatPresetMap and shows the blank option, not the pending G; samples: ${describeSamples(samples)}`).toBe(BLANK);
        expect(binds(), 'nothing was committed: the auto-bind write failed').toEqual([]);
        expect(await StorageManager.getChatPresetMap(), 'the stored chatPresetMap holds no binding for X').toEqual({});
    });

    // F2, another chat's flow fails (same docs paragraph: the controller clears the marker when the bind flow of the marked chat ends, not when another chat's flow fails; that failure leaves the pending pick uncleared and the auto-bind of the marked chat can still complete, so the marker stays). X stalls before its BIND; Y, bound to a deleted group, fails to clear that binding; the user returns to X, whose later flow stalls too, and another tab triggers a settings render of X. X still awaits its auto-bind to the pending G and resolves like the new-chat page, pending pick first, so from the return on, the navigation render included, X shows G; the auto-bind of X then completes, so X settles bound to G.
    it.each(FAILURE_MODES)('created chat X stalled before its auto-bind to G while the flow of chat Y fails ($name): back on X, from the return until X settles bound to G, X shows G at every step, never blank', async ({ mode }) => {
        await seed({ map: { [OTHER]: 'preset-deleted' }, settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, G.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: G is shown on the new chat before the send').toBe(G.id);
        expect((await StorageManager.getSettings()).activePresetId, 'precondition: the pick stored G as activePresetId, so the later write of A differs and fires onChanged').toBe(G.id);
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries G').toContain(G.content);

        // Hold the first two settings reads on X: the one of the bind flow of X (it stalls before its BIND) and the one of the later flow of X; a render read after them passes.
        holdReadsOnPath = chatPath(CREATED);
        readHoldsLeft = 2;
        setPathname(chatPath(CREATED));
        const createdFlow = cs.handleChatChange();
        await waitForHeldRead();

        // Y is bound to a deleted group, so its flow dispatches an UNBIND, which fails.
        opsToFail.push({ type: DSS_CHAT_MAP_MSG.UNBIND, mode });
        setPathname(chatPath(OTHER));
        const otherError = await failureOf(cs.handleChatChange());
        expect(otherError, 'precondition: the bind flow of Y failed').toBeInstanceOf(Error);
        expect(failedOps.map(({ type, uuid }) => ({ type, uuid })), 'precondition: the failed write is the UNBIND of Y').toEqual([{ type: DSS_CHAT_MAP_MSG.UNBIND, uuid: OTHER }]);
        await settleUntilQuiet();
        expect(heldReads.length, 'precondition: only the bind flow of X is held after Y fails').toBe(1);
        expect(binds(), 'precondition: X stalled before dispatching its BIND').toEqual([]);

        isSampling = true;
        setPathname(chatPath(CREATED));
        const backFlow = cs.handleChatChange();
        takeSample('after-back');
        for (let i = 0; i < 3000 && heldReads.length < 2; i++) await wait(1);
        expect(heldReads.length, 'precondition: the later flow of X is held too').toBe(2);
        await otherTabPicks(A.id);
        await settleUntilQuiet();
        takeSample('before-release');
        expect(heldReads.length, 'precondition: both flows of X are still held after the settings render').toBe(2);

        // Release the bind flow of X first, so its auto-bind to G lands, then the later flow of X.
        heldReads.shift()();
        for (let i = 0; i < 3000 && binds().length === 0; i++) await wait(1);
        releaseHeldReads();
        await Promise.all([failureOf(createdFlow), failureOf(backFlow)]);
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        expect(binds(), 'precondition: the auto-bind of X to G completed after Y failed').toEqual([{ uuid: CREATED, presetId: G.id }]);
        expect(samples.every((s) => s.path === chatPath(CREATED)), 'precondition: every sample was taken on X').toBe(true);
        expect(samples[0].at, 'precondition: the first sample is the navigation render right after the return to X').toBe('after-back');
        expect(samples.length, 'precondition: the screen was sampled after returning to X').toBeGreaterThan(2);
        expect(samples.filter((s) => s.shown !== G.id), `the failed flow of Y did not clear the pending G and X still awaits its auto-bind to it, so X resolves like the new-chat page and must show G at every step from the return until it settles bound to G; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(shownValue(overlay), 'X settles bound to G').toBe(G.id);
        expect(storedMap[CREATED], 'the stored binding of X is G').toBe(G.id);
    });
});
