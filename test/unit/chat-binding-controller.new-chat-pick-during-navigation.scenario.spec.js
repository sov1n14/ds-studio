// 299 行：一個情境檔，約 240 行是 content script 載入、持住 BIND 的 SW 替身、storage 取樣、觀察器保留與 beforeEach/afterEach 清理的測試支架；該支架是 chat-binding-controller.late-auto-bind-scope.scenario.spec.js 的私有複本，本單元只允許新增這一個檔案，抽成共用 helper 不在範圍內，其餘邊界切分都會把同一情境拆散。
/**
 * 情境（content script 接線）：使用者導覽到新對話頁、導覽流程仍在讀取設定時，使用者在新對話頁的浮動選單選了群組 G；導覽流程讀完設定後不得覆蓋這個選擇。
 *
 * 需求：docs/FEATURES.md「Conversation-Bound Prompt Groups」（新對話頁送出第一則訊息時所選的群組綁定建立的對話）與釘選群組的新對話預選（使用者沒選時才預選釘選群組）。推得的規則：(1) 在新對話頁選的 G 從選取那一刻起一直顯示，送出帶 G 的前綴，建立的對話 Z 綁定 G；(2) 有釘選群組時，使用者的選擇仍優先；(3) 防護：沒選任何群組時，釘選預選與空白選項照常。
 *
 * 時序控制：使用者先在對話 Y 選 B，SW chat-map writer 替身持住這個 BIND；content script 的 chat-map 讀取排在未完成的寫入之後，所以導覽到新對話頁的流程卡在讀設定，G 正好在這段期間被選。持有的 BIND 只是把時間窗撐開，讓競態可重現。導覽方式依頁面實際行為：頁面自己的 pushState（不送 popstate），再由 body DOM 變動讓 body 觀察器發現網址已換；不直接呼叫 handleChatChange，以免多跑一次流程。
 *
 * 取樣（testing-pitfalls「Transient UI State」）：chrome.storage.local.get 與 chrome.storage.sync.get 每次讀取延遲固定時間交付，交付前記錄浮動選單顯示的群組與 location.pathname；取樣從選取 G 的那一刻開始。
 *
 * 只模擬信任邊界：記憶體版 chrome.storage（真實 Chrome onChanged 語意與固定讀取延遲）、SW 設定轉送、SW chat-map writer（promise 形式 sendMessage）與 navigator（裝置設定檔）；所有 content 模組皆為真實模組。輔助函式複製自 chat-binding-controller.late-auto-bind-scope.scenario.spec.js（該檔私有）。
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

/** 等到 SW 替身持住一個 BIND；逾時則拋錯。 */
async function waitForHeldBind() {
    for (let i = 0; i < 3000 && heldBinds.length === 0; i++) await wait(1);
    if (heldBinds.length === 0) throw new Error('waitForHeldBind: picking B on chat Y never dispatched a BIND to the service worker.');
}

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
/** 記錄每個觀察器供 afterEach 中斷，避免舊實例回應下一個案例的 DOM 變動。happy-dom 16 在 observe() 內以 WeakRef 包住一個沒有其他參考的箭頭函式，GC 一跑 body 觀察器就不再觸發（實測約六分之一的導覽偵測不到）；瀏覽器在節點仍被觀察時保留觀察器，所以 observe() 期間改用強參考。 */
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

/** 在 Y（綁 A）載入，選 B 並持住其 BIND，導覽到新對話頁，等導覽流程卡在讀設定；回傳浮動選單。 */
async function navigateToNewChatWhileBindHeld({ pinned } = {}) {
    await seed({ map: { [Y]: A.id }, pinned });
    appendHeader();
    const overlay = await loadContentScript(chatPath(Y));
    expect(shownValue(overlay), 'precondition: chat Y bound to A shows A on load').toBe(A.id);
    bindsToHold = 1;
    clickOption(overlay, B.id);
    await waitForHeldBind();
    navigate(NEW_CHAT);
    await settleUntilQuiet();
    expect(heldBinds.length, 'precondition: the BIND of B on Y is still held after the move to the new-chat page').toBe(1);
    expect(cs.state.currentChatUuid, 'precondition: the body observer detected the move to the new-chat page').toBeFalsy();
    return overlay;
}

// settleUntilQuiet 每輪至少 250 ms，一個案例會跑好幾輪，所以放寬逾時。
describe('a group picked on the new-chat page while its navigation flow still reads settings is kept', { timeout: 30000 }, () => {
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
        // 持住的 BIND 會卡住共用的 StorageManager chat-map 佇列，影響下一個案例。
        while (heldBinds.length > 0) releaseHeldBind();
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
        restoreLatency();
        restoreNotify();
        chrome.runtime.sendMessage = originalSendMessage;
        Object.keys(DESKTOP).forEach((key) => delete navigator[key]);
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        setPathname('/');
    });

    // 案例 1、2：導覽流程卡在讀設定時選 G；不論有無釘選群組，G 從選取起一直顯示，送出帶 G，建立的 Z 綁定 G。
    it.each([
        { title: 'no pinned group', pinned: undefined },
        { title: 'pinned group A', pinned: A },
    ])('$title: G picked while the new-chat navigation flow waits behind a held BIND stays shown, is sent, and binds the created chat', async ({ pinned }) => {
        const overlay = await navigateToNewChatWhileBindHeld({ pinned });

        clickOption(overlay, G.id);
        isSampling = true;
        takeSample('after-pick');
        releaseHeldBind();
        await settleUntilQuiet();
        takeSample('new-chat-settled');
        const onNewChat = samples.splice(0);
        const firstSend = pressEnter('first message');
        navigate(chatPath(Z));
        await settleUntilQuiet();
        takeSample('created-chat-settled');
        isSampling = false;

        expect(storedMap[Y], 'the held BIND of B on Y still commits').toBe(B.id);
        expect(onNewChat.every((s) => s.path === NEW_CHAT), 'precondition: every new-chat sample was taken on the new-chat page').toBe(true);
        expect(onNewChat.filter((s) => s.shown !== G.id).length, `G was picked on the new-chat page, so from the pick until the page settles the overlay must show G at every step, even after the navigation flow finishes reading settings; samples: ${describeSamples(onNewChat)}`).toBe(0);
        expect(firstSend.value, 'the first send on the new-chat page carries the picked G').toContain(G.content);
        expect(firstSend.value, 'the first send on the new-chat page carries only the picked G').not.toContain(A.content);
        expect(storedMap[Z], 'the chat created by the first send binds to the picked G').toBe(G.id);
        expect(samples.filter((s) => s.shown !== G.id).length, `the created chat Z must show G at every step until it settles; samples: ${describeSamples(samples)}`).toBe(0);
        expect(shownValue(overlay), 'the created chat Z ends showing G').toBe(G.id);
    });

    // 防護（現行程式應為綠燈）：同樣步驟但不選群組；有釘選 A 時新對話頁預選 A，沒有釘選時顯示空白選項，送出與顯示一致。
    it.each([
        { title: 'pinned group A', pinned: A, expected: A.id, sent: A.content },
        { title: 'no pinned group', pinned: undefined, expected: BLANK, sent: undefined },
    ])('guard, $title, nothing picked: after the held BIND releases the new-chat page shows the pinned preselect or the blank option', async ({ pinned, expected, sent }) => {
        const overlay = await navigateToNewChatWhileBindHeld({ pinned });

        releaseHeldBind();
        await settleUntilQuiet();
        const firstSend = pressEnter('first message');

        expect(storedMap[Y], 'the held BIND of B on Y still commits').toBe(B.id);
        expect(shownValue(overlay), 'with nothing picked, the new-chat page shows the pinned group, or the blank option when none is pinned').toBe(expected);
        if (sent) expect(firstSend.value, 'the send carries the pinned group the overlay shows').toContain(sent);
        else expect(firstSend.value, 'with no group shown, the send carries no group').not.toContain('PREFIX-');
    });
});
