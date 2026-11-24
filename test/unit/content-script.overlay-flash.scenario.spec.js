/**
 * Scenario (content-script wiring): while a conversation is open, the preset overlay never displays a group other than that conversation's own group, not even for one async step.
 *
 * Requirements (docs/FEATURES.md "Prompt Groups"): a chat bound to a group shows that group; the last pick elsewhere (stored activePresetId) must not flash on a bound chat during a fresh load or an SPA navigation; a new chat opens with the pinned default group preselected, so a fresh load of a new chat shows that group from its first render; an SPA navigation from a new chat, before any send, to a bound chat shows that chat's group at once; a group picked on a new chat stays shown and binds the chat DeepSeek then creates, and the first render after DeepSeek gives that chat its uuid still shows that group.
 *
 * Sampling: chrome.storage.local.get and chrome.storage.sync.get deliver every read after a fixed latency and record what the overlay shows, together with location.pathname, right before each delivery. A storage delivery is a macrotask boundary, where the browser may paint, so each sample is a state the user could see. No timer polling and no MutationObserver.
 *
 * Why every test loads content-script.js itself: the ctx wiring is built once, at load (same reason as content-script.ctx-wiring.fresh-load.scenario.spec.js, whose seed / appendHeader / loadContentScript / shownValue helpers this spec copies; that spec keeps its helpers private and is out of scope here).
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
const X = 'aaaaaaaa-1111-1111-1111-111111111111';
const Y = 'bbbbbbbb-2222-2222-2222-222222222222';
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await wait(250); for (let i = 0; i < 30; i++) await wait(0); };
let storageReads = 0;
/** 重複 settle 直到一整輪內沒有任何 storage 讀取，使等待長度不依賴初始化步數與讀取延遲；上限 20 輪。 */
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

const shownValue = (overlay) => overlay.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? '';
const clickOption = (overlay, id) => overlay.dropdown.menu.querySelector(`.dss-preset-option[data-value="${id}"]`).click();

/** What the user sees right now: the selected group id, '' for the placeholder, or UNMOUNTED when no overlay is in the page. */
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

/** 包裝兩個 storage 區的 get：每次讀取延遲 STORAGE_LATENCY_MS 後才交付，交付前先取樣畫面；回傳還原函式。 */
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

/** 依路徑篩出樣本，並以可讀格式呈現，供斷言訊息使用。 */
const samplesOn = (pathname) => samples.filter((s) => s.path === pathname);
const describeSamples = (list) => list.map((s) => `${s.at}:${s.shown}`).join(', ');

/** Focuses a page textarea holding `text` and presses Enter, as the user sends the first message of a new chat. */
function pressEnter(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return ta;
}

// settleUntilQuiet 每輪至少 250 毫秒，一個案例可能跑數輪，故放寬單一案例逾時。
describe('preset overlay never flashes another group on an open conversation', { timeout: 30000 }, () => {
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

    it('a fresh load on a chat bound to B never shows A, the last pick stored elsewhere', async () => {
        await seed({ map: { [X]: B.id }, settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        isSampling = true;
        const overlay = await loadContentScript(`${NEW_CHAT}/${X}`);
        takeSample('after-settle');
        isSampling = false;

        const onX = samplesOn(`${NEW_CHAT}/${X}`);
        expect(onX.length, 'precondition: storage deliveries were sampled while chat X was open').toBeGreaterThan(1);
        expect(onX.filter((s) => s.shown === A.id), `chat X is bound to B, so the overlay must never show A; samples: ${describeSamples(onX)}`).toEqual([]);
        expect(shownValue(overlay), 'chat X ends on its bound group B').toBe(B.id);
    });

    it('a fresh load on a new chat with a pinned default group G shows G from the first render, never the blank option', async () => {
        await seed({ settings: { [StorageManager.KEYS.PINNED_PRESET_ID]: G.id, [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        isSampling = true;
        const overlay = await loadContentScript(NEW_CHAT);
        takeSample('after-settle');
        isSampling = false;

        // 覆蓋層掛上之前的樣本（初始化仍在讀設定）不是畫面上的群組，不列入。
        const mounted = samplesOn(NEW_CHAT).filter((s) => s.shown !== UNMOUNTED);
        expect(mounted.length, 'precondition: storage deliveries were sampled while the overlay was mounted on the new chat').toBeGreaterThan(1);
        expect(mounted.filter((s) => s.shown !== G.id), `a new chat opens with the pinned group G preselected, so every render shows G; samples: ${describeSamples(mounted)}`).toEqual([]);
        expect(shownValue(overlay), 'the new chat ends on the pinned group G').toBe(G.id);
    });

    it('an SPA navigation from a new chat, before any send, to a chat bound to B shows B at once', async () => {
        await seed({ map: { [Y]: B.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, A.id);
        await settleUntilQuiet();
        expect(shownValue(overlay), 'sanity: A is picked on the new chat').toBe(A.id);

        isSampling = true;
        setPathname(`${NEW_CHAT}/${Y}`);
        await cs.handleChatChange();
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        const onY = samplesOn(`${NEW_CHAT}/${Y}`);
        expect(onY.length, 'precondition: storage deliveries were sampled while chat Y was open').toBeGreaterThan(1);
        expect(onY.filter((s) => s.shown !== B.id), `chat Y is bound to B and nothing was sent on the new chat, so every render on Y shows B; samples: ${describeSamples(onY)}`).toEqual([]);
        expect(binds(), 'opening an existing chat without sending binds nothing').toEqual([]);
        expect(shownValue(overlay), 'chat Y ends on its bound group B').toBe(B.id);
    });

    it('an SPA navigation from a chat bound to A to a chat bound to B never shows A on the new chat', async () => {
        await seed({ map: { [X]: A.id, [Y]: B.id } });
        appendHeader();
        const overlay = await loadContentScript(`${NEW_CHAT}/${X}`);
        expect(shownValue(overlay), 'sanity: chat X opens on its bound group A').toBe(A.id);

        isSampling = true;
        setPathname(`${NEW_CHAT}/${Y}`);
        await cs.handleChatChange();
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        const onY = samplesOn(`${NEW_CHAT}/${Y}`);
        expect(onY.length, 'precondition: storage deliveries were sampled while chat Y was open').toBeGreaterThan(1);
        expect(onY.filter((s) => s.shown === A.id), `chat Y is bound to B, so the overlay must never show A once Y is open; samples: ${describeSamples(onY)}`).toEqual([]);
        expect(shownValue(overlay), 'chat Y ends on its bound group B').toBe(B.id);
    });

    it('a group picked on a new chat never gives way to another group while DeepSeek creates the chat', async () => {
        await seed({ settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, G.id);
        await settle();
        expect(shownValue(overlay), 'sanity: G is shown on the new chat').toBe(G.id);
        const ta = pressEnter('first message');
        expect(ta.value, 'sanity: the send carries G').toContain('PREFIX-G');

        isSampling = true;
        setPathname(`${NEW_CHAT}/${CREATED}`);
        const navigation = cs.handleChatChange();
        // 導覽偵測在第一筆 storage 讀取處讓出執行緒，瀏覽器可在此繪製：這是網址改變後使用者看到的第一個畫面。
        takeSample('url-change');
        await navigation;
        await settleUntilQuiet();
        takeSample('after-settle');
        isSampling = false;

        const onCreated = samplesOn(`${NEW_CHAT}/${CREATED}`);
        expect(onCreated.length, 'precondition: storage deliveries were sampled while the created chat was open').toBeGreaterThan(1);
        // 只禁止顯示 G 以外的群組；佔位（未選）或未掛載不算顯示其他群組。
        const isOtherGroup = (s) => ![G.id, '', UNMOUNTED].includes(s.shown);
        expect(onCreated.filter(isOtherGroup), `the created chat carries the pending group G, so the overlay never shows another group; samples: ${describeSamples(onCreated)}`).toEqual([]);
        expect(onCreated[0], `the first render after DeepSeek gives the new chat its uuid keeps the picked group G, not the blank option of a chat with no binding yet; samples: ${describeSamples(onCreated)}`).toMatchObject({ at: 'url-change', shown: G.id });
        expect(binds(), 'the created chat is bound to G through the SW writer').toEqual([{ uuid: CREATED, presetId: G.id }]);
        expect(shownValue(overlay), 'the created chat ends on G').toBe(G.id);
    });
});
