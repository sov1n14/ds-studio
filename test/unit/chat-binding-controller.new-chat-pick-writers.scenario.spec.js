// 336 行：一個情境檔，約 230 行是 content script 載入、持住 BIND 與持住 activePresetId 寫入的儲存區替身、畫面取樣、觀察器保留與 beforeEach/afterEach 清理的測試支架；該支架是 chat-binding-controller.new-chat-pick-during-navigation.scenario.spec.js 的私有複本，本單元只允許新增這一個檔案，抽成共用 helper 不在範圍內，其餘邊界切分都會把同一情境拆散。
/**
 * 情境（content script 接線）：新對話頁的群組選取有兩個寫入者（浮動選單與 popup），選取可能落在新對話導覽流程的任一個非同步等待之中；導覽流程不得在使用者選取之後把畫面或 pending 改回釘選群組或空白。
 *
 * 需求：docs/FEATURES.md「Conversation-Bound Prompt Groups」（新對話頁送出第一則訊息時所選的群組綁定建立的對話）與釘選群組的新對話預選（使用者沒選時才預選釘選群組）。推得的規則：在新對話頁選的 G，不論經由浮動選單或 popup、不論落在導覽流程讀設定或寫入釘選預選期間，從選取那一刻起一直顯示，送出帶 G 的前綴，建立的對話 Z 綁定 G。
 *
 * 案例 1（popup 寫入者）：依 popup 在新對話頁的實際步驟（沒有對話 UUID 所以不綁定、儲存 activePresetId、再送 ACTIVE_PRESET_CHANGED 給分頁），訊息經 content script 自己註冊的 chrome.runtime.onMessage 監聽送達；選取發生在導覽流程讀設定、而讀取排在持住的 BIND 之後的期間。
 * 案例 2（選取落在釘選預選的寫入期間）：有釘選 A、讀設定期間沒有選取；導覽流程把 A 寫成 activePresetId 時，儲存區替身持住 chrome.storage.sync.set 的這筆寫入，期間在浮動選單選 G，再放行。
 *
 * 取樣（testing-pitfalls「Transient UI State」）：chrome.storage.local.get 與 chrome.storage.sync.get 每次讀取延遲固定時間交付，交付前記錄浮動選單顯示的群組與 location.pathname；取樣從選取 G 的那一刻開始。
 *
 * 只模擬信任邊界：記憶體版 chrome.storage（真實 Chrome onChanged 語意、固定讀取延遲、可持住的 activePresetId 寫入）、SW 設定轉送、SW chat-map writer（promise 形式 sendMessage）、popup 送往分頁的訊息與 navigator（裝置設定檔）；所有 content 模組皆為真實模組。
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
const Y = 'aaaaaaaa-1111-1111-1111-111111111111';
const Z = 'cccccccc-3333-3333-3333-333333333333';
const chatPath = (uuid) => `${NEW_CHAT}/${uuid}`;
const preset = (id, content) => ({ id, name: id, content, createdAt: 1, updatedAt: 1 });
const A = preset('preset-A', 'PREFIX-A');
const B = preset('preset-B', 'PREFIX-B');
const G = preset('preset-G', 'PREFIX-G');
// 非觸控 Windows 桌機上的真實 Edge，Enter 走桌機送出路徑。
const DESKTOP = { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0' };
// 每次 storage 讀取的固定延遲（ms），模擬 chrome.storage 的非同步往返。
const STORAGE_LATENCY_MS = 5;
const BLANK = '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await wait(250); for (let i = 0; i < 30; i++) await wait(0); };
let storageReads = 0;
/** 重複 settle，直到一整輪沒有任何 storage 讀取；最多 20 輪。 */
async function settleUntilQuiet() {
    for (let round = 0; round < 20; round++) {
        const before = storageReads;
        await settle();
        if (storageReads === before) return;
    }
    throw new Error('settleUntilQuiet: storage reads kept arriving for 20 settle rounds; the content script never went quiet.');
}

/** 輪詢 isReady 直到成立；逾時以 message 拋錯。 */
async function waitUntil(isReady, message) {
    for (let i = 0; i < 3000 && !isReady(); i++) await wait(1);
    if (!isReady()) throw new Error(message);
}

let storedMap;
let bindsToHold;
let heldBinds;
/** SW chat-map writer 替身：如 background/chat-map-routes.js 般提交每個寫入；bindsToHold > 0 時，下一個 BIND 等 releaseHeldBind() 才提交。 */
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

let activeIdWriteToHold;
let heldActiveIdWrites;
/** 包裝 chrome.storage.sync.set：寫入的 activePresetId 等於 activeIdWriteToHold 時（只持一次），等 releaseHeldActiveIdWrite() 才交給原本的 set；回傳還原函式。 */
function installHoldableActiveIdWrite() {
    const area = chrome.storage.sync;
    const original = area.set;
    area.set = function holdableSet(items, callback) {
        const key = StorageManager.KEYS.ACTIVE_PRESET_ID;
        if (activeIdWriteToHold !== null && items?.[key] === activeIdWriteToHold) {
            activeIdWriteToHold = null;
            return new Promise((resolve) => heldActiveIdWrites.push(() => resolve(original.call(area, items, callback))));
        }
        return original.call(area, items, callback);
    };
    return () => { area.set = original; };
}
const releaseHeldActiveIdWrite = () => heldActiveIdWrites.shift()();

async function seed({ map = {}, pinned } = {}) {
    const items = { isEnabled: true, globalPromptEnabled: false, dsPresetIndex: [A.id, B.id, G.id] };
    [A, B, G].forEach((p) => { items[`dsPreset_${p.id}`] = p; });
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    if (pinned) await StorageManager.savePinnedPresetId(pinned.id);
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
/** 只在 observe() 期間代替 WeakRef 的強參考。 */
class StrongRef { constructor(value) { this.value = value; } deref() { return this.value; } }
/** 記錄每個觀察器供 afterEach 中斷，避免舊實例回應下一個案例的 DOM 變動。happy-dom 16 在 observe() 內以 WeakRef 包住一個沒有其他參考的箭頭函式，GC 一跑 body 觀察器就不再觸發；瀏覽器在節點仍被觀察時保留觀察器，所以 observe() 期間改用強參考。 */
class TrackedMutationObserver extends OriginalMutationObserver {
    constructor(callback) {
        super(callback);
        createdObservers.push(this);
    }

    observe(target, options) {
        const OriginalWeakRef = globalThis.WeakRef;
        globalThis.WeakRef = StrongRef;
        try { super.observe(target, options); } finally { globalThis.WeakRef = OriginalWeakRef; }
    }
}
/** 在 pathname 上載入 content-script.js，等 initSettings() 完成，再等頁面安靜。 */
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

/** 依頁面方式導覽：頁面自己的 pushState（無 popstate），隨後的 body DOM 變動讓 body 觀察器發現網址已換。 */
function navigate(pathname) {
    window.history.pushState({}, '', pathname);
    document.body.appendChild(document.createElement('div'));
}

const shownValue = (overlay) => overlay.dropdown.menu.querySelector('[aria-selected="true"]')?.getAttribute('data-value') ?? BLANK;
const clickOption = (overlay, id) => overlay.dropdown.menu.querySelector(`.dss-preset-option[data-value="${id}"]`).click();

/** popup 在新對話頁選取群組的步驟：沒有對話 UUID 所以不綁定，儲存 activePresetId，再把 ACTIVE_PRESET_CHANGED 送往分頁，由 content script 註冊的 onMessage 監聽接收。 */
async function pickInPopup(picked) {
    await StorageManager.saveActivePresetId(picked.id);
    chrome.runtime.onMessage.callListeners({ action: DSS_CONTENT_MSG.ACTIVE_PRESET_CHANGED, presetId: picked.id, presetContent: picked.content }, {}, () => {});
}

/** 使用者此刻看到的值：選中的群組 id、空白選項為 BLANK、頁面上沒有浮動選單為 UNMOUNTED。 */
function currentDisplay() {
    const overlay = cs?.PresetOverlay;
    if (!overlay?.wrapperEl?.isConnected || !overlay.dropdown?.menu) return '<unmounted>';
    return shownValue(overlay);
}

let samples;
let isSampling;
function takeSample(at) {
    if (isSampling) samples.push({ at, path: location.pathname, shown: currentDisplay() });
}

/** 包裝兩個 storage 區域的 get：每次讀取延遲 STORAGE_LATENCY_MS 交付，交付前取樣畫面；回傳還原函式。 */
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
/** 把連續相同（頁面、顯示）的樣本合併為「頁面:顯示×次數 (from 第一個取樣點)」，讓失敗訊息看得出顯示在哪裡轉變。 */
const describeSamples = (list) => list.reduce((runs, s) => {
    const key = `${s.path.slice(NEW_CHAT.length) || 'new'}:${label(s.shown)}`;
    const last = runs[runs.length - 1];
    if (last?.key === key) last.count += 1; else runs.push({ key, count: 1, from: s.at });
    return runs;
}, []).map((r) => `${r.key}×${r.count} (from ${r.from})`).join(', ');

/** 讓一個含 text 的 textarea 取得焦點並按 Enter 送出，之後移除；回傳的元素保留送出的值。 */
function pressEnter(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    ta.remove();
    return ta;
}

/** 從選取 G 那一刻起取樣到新對話頁安靜，送出第一則訊息，導覽到建立的 Z 並取樣到安靜；release 在選取後執行，放行持住的寫入。 */
async function sampleFromPickThroughCreatedChat(release) {
    isSampling = true;
    takeSample('after-pick');
    release();
    await settleUntilQuiet();
    takeSample('new-chat-settled');
    const onNewChat = samples.splice(0);
    const firstSend = pressEnter('first message');
    navigate(chatPath(Z));
    await settleUntilQuiet();
    takeSample('created-chat-settled');
    isSampling = false;
    return { onNewChat, onCreatedChat: samples.splice(0), firstSend };
}

/** 斷言選取 G 之後：新對話頁每個樣本都顯示 G、送出只帶 G、建立的 Z 綁定 G 並一直顯示 G。 */
function expectPickedGKept(overlay, { onNewChat, onCreatedChat, firstSend }, how) {
    expect(onNewChat.every((s) => s.path === NEW_CHAT), 'precondition: every new-chat sample was taken on the new-chat page').toBe(true);
    expect(onNewChat.filter((s) => s.shown !== G.id).length, `G was picked ${how}, so from the pick until the page settles the overlay must show G at every step and never fall back to the pinned group or the blank option; samples: ${describeSamples(onNewChat)}`).toBe(0);
    expect(firstSend.value, 'the first send on the new-chat page carries the picked G').toContain(G.content);
    expect(firstSend.value, 'the first send on the new-chat page carries only the picked G').not.toContain(A.content);
    expect(storedMap[Z], 'the chat created by the first send binds to the picked G').toBe(G.id);
    expect(onCreatedChat.filter((s) => s.shown !== G.id).length, `the created chat Z must show G at every step until it settles; samples: ${describeSamples(onCreatedChat)}`).toBe(0);
    expect(shownValue(overlay), 'the created chat Z ends showing G').toBe(G.id);
}

// settleUntilQuiet 每輪至少 250 ms，一個案例會跑好幾輪，所以放寬逾時。
describe('a group picked on the new-chat page by either writer during the navigation flow is kept', { timeout: 30000 }, () => {
    let restoreNotify;
    let restoreLatency;
    let restoreActiveIdWrite;
    const originalSendMessage = chrome.runtime.sendMessage;

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.entries(DESKTOP).forEach(([key, value]) => Object.defineProperty(navigator, key, { configurable: true, get: () => value }));
        restoreNotify = silenceUnchangedWrites();
        chrome.storage.onChanged.addListener(relaySettingsChanged);
        chrome.runtime.sendMessage = vi.fn(serviceWorker);
        restoreLatency = installSampledStorageLatency();
        restoreActiveIdWrite = installHoldableActiveIdWrite();
        bindsToHold = 0;
        heldBinds = [];
        activeIdWriteToHold = null;
        heldActiveIdWrites = [];
        addedListeners = [];
        createdObservers = [];
        globalThis.MutationObserver = TrackedMutationObserver;
        samples = [];
        isSampling = false;
        cs = null;
    });

    afterEach(async () => {
        isSampling = false;
        // 持住的寫入會卡住共用的 StorageManager 佇列，影響下一個案例。
        while (heldBinds.length > 0) releaseHeldBind();
        while (heldActiveIdWrites.length > 0) releaseHeldActiveIdWrite();
        await settle();
        if (cs) {
            // 停用本實例的 document 層注入監聽並卸載浮動選單；body 觀察器呼叫的重掛改為 no-op。
            Object.assign(cs.state, { isEnabled: false, isInjecting: true });
            clearTimeout(cs.state.awaitingNewChatUuidTimer);
            cs.PresetOverlay.unmount();
            cs.PresetOverlay.scheduleFindAndMount = () => {};
        }
        createdObservers.forEach((observer) => observer.disconnect());
        globalThis.MutationObserver = OriginalMutationObserver;
        addedListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
        chrome.storage.onChanged.removeListener(relaySettingsChanged);
        restoreActiveIdWrite();
        restoreLatency();
        restoreNotify();
        chrome.runtime.sendMessage = originalSendMessage;
        Object.keys(DESKTOP).forEach((key) => delete navigator[key]);
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        setPathname('/');
    });

    // 案例 1：在 Y 選 B 並持住其 BIND，導覽到新對話頁，流程卡在讀設定時由 popup 選 G。
    it.each([
        { title: 'no pinned group', pinned: undefined },
        { title: 'pinned group A', pinned: A },
    ])('$title: G picked in the popup while the new-chat navigation flow waits behind a held BIND stays shown, is sent, and binds the created chat', async ({ pinned }) => {
        await seed({ map: { [Y]: A.id }, pinned });
        appendHeader();
        const overlay = await loadContentScript(chatPath(Y));
        expect(shownValue(overlay), 'precondition: chat Y bound to A shows A on load').toBe(A.id);
        bindsToHold = 1;
        clickOption(overlay, B.id);
        await waitUntil(() => heldBinds.length > 0, 'picking B on chat Y never dispatched a BIND to the service worker.');
        navigate(NEW_CHAT);
        await settleUntilQuiet();
        expect(heldBinds.length, 'precondition: the BIND of B on Y is still held after the move to the new-chat page').toBe(1);
        expect(cs.state.currentChatUuid, 'precondition: the body observer detected the move to the new-chat page').toBeFalsy();

        await pickInPopup(G);
        const observed = await sampleFromPickThroughCreatedChat(releaseHeldBind);

        expect(storedMap[Y], 'the held BIND of B on Y still commits').toBe(B.id);
        expectPickedGKept(overlay, observed, 'in the popup while the navigation flow read settings');
    });

    // 案例 2：有釘選 A，從 Y（綁 B）導覽到新對話頁；流程把 A 寫成 activePresetId 時持住該寫入，期間在浮動選單選 G。
    it('pinned group A: G picked in the overlay while the pinned preselect write is held stays shown, is sent, and binds the created chat', async () => {
        await seed({ map: { [Y]: B.id }, pinned: A });
        appendHeader();
        const overlay = await loadContentScript(chatPath(Y));
        expect(shownValue(overlay), 'precondition: chat Y bound to B shows B on load').toBe(B.id);
        activeIdWriteToHold = A.id;
        navigate(NEW_CHAT);
        await waitUntil(() => heldActiveIdWrites.length > 0, 'the new-chat navigation flow never wrote the pinned A as the active group.');
        expect(cs.state.currentChatUuid, 'precondition: the body observer detected the move to the new-chat page').toBeFalsy();

        clickOption(overlay, G.id);
        const observed = await sampleFromPickThroughCreatedChat(releaseHeldActiveIdWrite);

        expect(storedMap[Y], 'chat Y keeps its binding to B').toBe(B.id);
        expectPickedGKept(overlay, observed, 'in the overlay while the pinned preselect write was held');
    });
});
