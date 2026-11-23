/**
 * Scenario (content-script wiring): a group picked on a new chat stays shown in the preset overlay, without a blank step, from the first send until the chat DeepSeek creates has settled on that group.
 *
 * Requirements: docs/FEATURES.md "Conversation-Bound Prompt Groups" (after the first message of a new conversation is sent, the selected prompt group binds the new conversation, and switching conversations shows the bound group), so the group selected when the first message is sent is the group the created conversation shows. Observed defect on the pre-fix tree: right after the first send on a new chat where G was picked, the overlay switched from G to the blank option for about 55 storage deliveries and then back to G, depending on timing. Expected output: once G is picked and sent, every sample until the created chat settles shows G, never the blank option.
 *
 * Trigger (found by black-box probes on the pre-fix tree, 2026-11-23): the flash appears when the first send and the URL change land while the content script is still processing the pick. Sending after the pick has fully settled showed no flash in 6 of 6 runs, so a wall-clock gap (as in content-script.overlay-flash.scenario.spec.js case 3) hits the window only by chance. These cases therefore time the send by storage deliveries after the pick, which is independent of timer granularity. Sweep of every delivery count from 31 to 50 on the pre-fix tree, 2 runs with identical results: 31 and 32 were too early (the send did not carry G yet), 33 to 47 flashed, and 48 or more never flashed; processing the pick alone takes 67 deliveries. The pick issues the same storage reads, in the same order, on the pre-fix and the fixed tree, so the fix leaves these delivery counts where they were.
 *
 * Window guards: the cases cover the flash window at most 4 deliveries apart, both edges included, so a later change that shifts the pick's read count by up to 14 deliveries in either direction still leaves at least one case inside the window (at least two for a shift of up to 10 deliveries), and any run of 4 or more consecutive flashing deliveries between 33 and 47 contains a case. The precondition "the first send carries G" fails a case whose send came before the pick took effect. The precondition "a storage read the pick started is still undelivered at the send" fails a case whose send came after the pick finished processing. No observable signal marks the end of the flash window (the settings relay neither returns a value nor answers through sendResponse), so a drift into deliveries 48 to 66 is caught only by the spread of the cases, not by a precondition.
 *
 * Sampling (testing-pitfalls "Transient UI State"): chrome.storage.local.get and chrome.storage.sync.get deliver every read after a fixed latency and record what the overlay shows, together with location.pathname, right before each delivery. A storage delivery is a macrotask boundary, where the browser may paint, so each sample is a state the user could see.
 *
 * Why the harness is copied: the ctx wiring is built once, when content-script.js loads, so every test loads it itself; the seed, appendHeader, loadContentScript, shownValue and sampled-latency helpers copy content-script.overlay-flash.scenario.spec.js, which keeps them private.
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

const HEADER_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/conversation-header.html'), 'utf8');
const NEW_CHAT = '/a/chat/s';
const CREATED = 'cccccccc-3333-3333-3333-333333333333';
const preset = (id, content) => ({ id, name: id, content, createdAt: 1, updatedAt: 1 });
const A = preset('preset-A', 'PREFIX-A');
const B = preset('preset-B', 'PREFIX-B');
const G = preset('preset-G', 'PREFIX-G');
// 真實 Edge 安裝的 UA、platform 與觸控點數（非觸控 Windows 桌面），使 Enter 走桌面路徑。
const DESKTOP = { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0' };
// 每次 storage 讀取的固定延遲（毫秒），模擬真實 chrome.storage 的非同步往返。
const STORAGE_LATENCY_MS = 5;
const UNMOUNTED = '<unmounted>';
const BLANK = '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await wait(250); for (let i = 0; i < 30; i++) await wait(0); };
let storageReads = 0;
let deliveries = 0;
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
/** SW chat-map writer double: records each dispatch and commits it, as background/chat-map-routes.js would. */
async function serviceWorker(msg) {
    if (!Object.values(DSS_CHAT_MAP_MSG).includes(msg?.type)) return undefined;
    chatMapOps.push(structuredClone(msg));
    const next = { ...storedMap };
    if (msg.type === DSS_CHAT_MAP_MSG.BIND) next[msg.uuid] = msg.presetId;
    if (msg.type === DSS_CHAT_MAP_MSG.UNBIND) delete next[msg.uuid];
    storedMap = next;
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [next]);
    return { ok: true, map: { ...next } };
}
const binds = () => chatMapOps.filter((m) => m.type === DSS_CHAT_MAP_MSG.BIND).map(({ uuid, presetId }) => ({ uuid, presetId }));

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
/** Evaluates content-script.js on `pathname` and waits until initSettings() has registered its settings listener. */
async function loadContentScript(pathname) {
    setPathname(pathname);
    const event = chrome.runtime.onMessage;
    const originalAdd = event.addListener;
    event.addListener = (fn) => { addedListeners.push(fn); originalAdd(fn); };
    try {
        vi.resetModules();
        cs = (await import('../../content/content-script.js')).default;
        for (let i = 0; i < 500 && addedListeners.length < 2; i++) await wait(0);
    } finally {
        event.addListener = originalAdd;
    }
    if (addedListeners.length < 2) throw new Error('Timed out waiting for content-script.js initSettings() to register its DSS_SETTINGS_CHANGED listener.');
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
    if (isSampling) samples.push({ at, path: location.pathname, shown: currentDisplay() });
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
                setTimeout(() => { deliveries += 1; takeSample(`storage.${names[i]}.get`); resolve(result); }, STORAGE_LATENCY_MS);
            }));
            if (callback) { delivered.then(callback); return undefined; }
            return delivered;
        };
    });
    return () => areas.forEach((area, i) => { area.get = originals[i]; });
}

const label = (shown) => (shown === BLANK ? '(blank)' : shown);
const describeSamples = (list) => list.map((s) => `${s.path === NEW_CHAT ? 'new' : 'created'}@${s.at}:${label(s.shown)}`).join(', ');

/** Focuses a page textarea holding `text` and presses Enter, as the user sends the first message of a new chat. */
function pressEnter(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return ta;
}

/** Waits until `count` more storage reads have been delivered; throws when they never arrive. */
async function waitForDeliveries(count) {
    const target = deliveries + count;
    for (let i = 0; i < 5000 && deliveries < target; i++) await wait(1);
    if (deliveries < target) throw new Error(`waitForDeliveries: only ${count - (target - deliveries)} of ${count} storage deliveries arrived after the pick.`);
}

// settleUntilQuiet 每輪至少 250 毫秒，一個案例可能跑數輪，故放寬單一案例逾時。
describe('a group picked on a new chat never blanks out while DeepSeek creates the chat', { timeout: 30000 }, () => {
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
        chatMapOps = [];
        addedListeners = [];
        samples = [];
        isSampling = false;
        cs = null;
    });

    afterEach(() => {
        isSampling = false;
        if (cs) {
            // 停用此實例的 document 層注入監聽並移除其 overlay。
            Object.assign(cs.state, { isEnabled: false, isInjecting: true });
            clearTimeout(cs.state.awaitingNewChatUuidTimer);
            cs.PresetOverlay.unmount();
            // 此實例的 body observer 會呼叫此方法；改為 no-op，避免 overlay 掛進下一個測試的 header。
            cs.PresetOverlay.scheduleFindAndMount = () => {};
        }
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

    // 選取 G 到第一次送出之間的 storage 交付次數：以至多相隔 4 次交付涵蓋修正前會閃爍的 33 到 47，含兩端；量測方式見檔頭。
    it.each([33, 37, 41, 45, 47])('first send %i storage deliveries after the pick, URL changes at once: the overlay shows G at every step, never the blank option', async (deliveriesBeforeSend) => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, G.id);
        await waitForDeliveries(deliveriesBeforeSend);
        expect(shownValue(overlay), 'precondition: G is shown on the new chat before the send').toBe(G.id);
        // 選取前已靜止（settleUntilQuiet），故此刻仍未交付的讀取都是選取觸發的；為 0 表示送出落在選取處理完之後，案例已漂出時間窗。
        const pickReadsInFlight = storageReads - deliveries;
        expect(pickReadsInFlight, 'precondition: a storage read the pick started is still undelivered at the send, so the send lands while the pick is still being processed').toBeGreaterThan(0);

        isSampling = true;
        const ta = pressEnter('first message');
        expect(ta.value, 'precondition: the first send carries G, so the pick has taken effect').toContain('PREFIX-G');
        takeSample('after-send');
        setPathname(`${NEW_CHAT}/${CREATED}`);
        await cs.handleChatChange();
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        const onCreated = samples.filter((s) => s.path === `${NEW_CHAT}/${CREATED}`);
        expect(onCreated.length, 'precondition: storage deliveries were sampled while the created chat was open').toBeGreaterThan(1);
        expect(samples.some((s) => s.shown === UNMOUNTED), `precondition: the header stays in the page, so the overlay stays mounted; samples: ${describeSamples(samples)}`).toBe(false);
        expect(samples.filter((s) => s.shown === BLANK), `G was picked and sent, so from the send until the created chat settles the overlay must never show the blank option; samples: ${describeSamples(samples)}`).toEqual([]);
        expect(binds(), 'the created chat is bound to G through the SW writer').toEqual([{ uuid: CREATED, presetId: G.id }]);
        expect(shownValue(overlay), 'the created chat ends on G').toBe(G.id);
    });
});
