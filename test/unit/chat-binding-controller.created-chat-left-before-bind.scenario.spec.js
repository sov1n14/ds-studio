// 254 行：約 170 行是 content script 載入、SW chat-map writer 替身、依路徑計數的 storage 延遲、觀察器保留與 beforeEach/afterEach 清理的測試支架，複製自 chat-binding-controller.held-write-prefix.scenario.spec.js（該檔私有）；本單元只允許新增這個情境檔，抽成共用 helper 不在範圍內，兩個案例共用同一支架，拆檔只會複製支架。
/**
 * 情境（content script 接線）：使用者在新對話頁選群組 G 並送出第一則訊息，網址移到 DeepSeek 建立的對話 X；X 的綁定流程才剛發出第一個 storage 讀取，使用者就點回新對話頁。
 *
 * 需求：docs/FEATURES.md「Conversation-Bound Prompt Groups」（新對話送出第一則訊息後，自動把當時選的群組綁到新對話 UUID；切換對話時下拉選單切到綁定的群組）與 docs/spec/01-prompt-system.md「UUID Conversation-Bound Prompt Groups」（Auto-binding on first message：送出時在無 UUID 頁面所選的群組綁到新 UUID；New tab isolation：新對話頁顯示空白，或仍存在的釘選群組）。推得的規則：送出當下所選的 G 屬於 X，使用者離開 X 的時機不得讓 X 失去綁定；回到的新對話頁是另一個新對話，顯示空白（或釘選群組），送出不帶 G；重新打開 X 時顯示 G，送出帶 G。
 *
 * 時序控制：storage 替身讓每次讀取延遲 STORAGE_LATENCY_MS 才交付，並依發出讀取時的 pathname 計數；測試等到 X 的路徑上出現第一個讀取（X 的綁定流程已開始、尚未讀完）就導覽回新對話頁。導覽方式依頁面實際行為：頁面自己的 pushState（不送 popstate），再由 body DOM 變動讓 body 觀察器發現網址已換；不直接呼叫 handleChatChange。
 *
 * 回到新對話頁後的送出會讓 DeepSeek 建立另一個對話 Z，所以測試接著導覽到 Z，再重新打開 X；否則重新打開 X 會被當成第二次送出建立的對話。
 *
 * 只模擬信任邊界：記憶體版 chrome.storage（真實 Chrome onChanged 語意與固定讀取延遲）、SW 設定轉送、SW chat-map writer（promise 形式 sendMessage）與 navigator（裝置設定檔）；所有 content 模組皆為真實模組。
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
const X = 'cccccccc-3333-3333-3333-333333333333';
const Z = 'eeeeeeee-5555-5555-5555-555555555555';
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
// 依發出讀取時的 location.pathname 計數。
let readsOnPath = {};
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
/** SW chat-map writer 替身：如 background/chat-map-routes.js 般立即提交每個寫入。 */
async function serviceWorker(msg) {
    if (!Object.values(DSS_CHAT_MAP_MSG).includes(msg?.type)) return undefined;
    const next = { ...storedMap };
    if (msg.type === DSS_CHAT_MAP_MSG.BIND) next[msg.uuid] = msg.presetId;
    if (msg.type === DSS_CHAT_MAP_MSG.UNBIND) delete next[msg.uuid];
    storedMap = next;
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [next]);
    return { ok: true, map: { ...next } };
}

/** 寫入 A、B、G 三個各有前綴的群組，作用中群組為 A，全域提示關閉，chat-map 為空；pinned 為釘選群組 id 或空字串。 */
async function seed({ pinned = '' } = {}) {
    const items = { isEnabled: true, globalPromptEnabled: false, dsPresetIndex: [A.id, B.id, G.id], [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id, [StorageManager.KEYS.PINNED_PRESET_ID]: pinned };
    [A, B, G].forEach((p) => { items[`dsPreset_${p.id}`] = p; });
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    storedMap = {};
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

/** 兩個 storage 區的 get 都延遲 STORAGE_LATENCY_MS 才交付，並依發出時的 pathname 計數；回傳還原函式。 */
function installStorageLatency() {
    const areas = [chrome.storage.local, chrome.storage.sync];
    const originals = areas.map((area) => area.get);
    areas.forEach((area, i) => {
        area.get = function delayedGet(keys, callback) {
            if (typeof keys === 'function') { callback = keys; keys = null; }
            storageReads += 1;
            readsOnPath[location.pathname] = (readsOnPath[location.pathname] ?? 0) + 1;
            const delivered = originals[i].call(area, keys).then((result) => new Promise((resolve) => setTimeout(() => resolve(result), STORAGE_LATENCY_MS)));
            if (callback) { delivered.then(callback); return undefined; }
            return delivered;
        };
    });
    return () => areas.forEach((area, i) => { area.get = originals[i]; });
}

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

/** 等到 pathname 上出現第一個 storage 讀取；逾時則拋錯。 */
async function waitForFirstReadOn(pathname) {
    for (let i = 0; i < 3000 && !readsOnPath[pathname]; i++) await wait(0);
    if (!readsOnPath[pathname]) throw new Error(`waitForFirstReadOn: the content script issued no storage read on ${pathname}.`);
}

/** 在新對話頁選 G 並送出，導覽到建立的 X，等 X 的綁定流程發出第一個讀取就導覽回新對話頁，等到頁面安靜；回傳浮動選單。 */
async function sendWithGThenLeaveCreatedChatEarly({ pinned }) {
    await seed({ pinned });
    appendHeader();
    const overlay = await loadContentScript(NEW_CHAT);
    expect(shownValue(overlay), 'precondition: the new-chat page shows the pinned group, or the blank option with no pin, on load').toBe(pinned || BLANK);
    clickOption(overlay, G.id);
    await settleUntilQuiet();
    expect(shownValue(overlay), 'precondition: G is shown on the new-chat page before the send').toBe(G.id);
    const first = pressEnter('first message');
    expect(first.value, 'precondition: the first send on the new-chat page carries the picked G').toContain(G.content);

    navigate(chatPath(X));
    await waitForFirstReadOn(chatPath(X));
    expect(storedMap[X], 'precondition: X is not bound yet when the user leaves it').toBeUndefined();
    navigate(NEW_CHAT);
    await settleUntilQuiet();
    expect(cs.state.currentChatUuid, 'precondition: the body observer detected the move back to the new-chat page').toBeFalsy();
    return overlay;
}

/** 在回到的新對話頁送出，DeepSeek 建立 Z；導覽到 Z，再重新打開 X，等到頁面安靜。回傳新對話頁上 Enter 送出的元素。 */
async function sendOnNewChatThenReopenX() {
    const sentOnNewChat = pressEnter('second new chat');
    navigate(chatPath(Z));
    await settleUntilQuiet();
    expect(cs.state.currentChatUuid, 'precondition: the body observer detected the move to the second created chat Z').toBe(Z);
    navigate(chatPath(X));
    await settleUntilQuiet();
    expect(cs.state.currentChatUuid, 'precondition: the body observer detected the reopening of X').toBe(X);
    return sentOnNewChat;
}

// settleUntilQuiet 每輪至少 250 ms，一個案例會跑好幾輪，所以放寬逾時。
describe('a created chat the user leaves before its bind flow binds it still binds to the group picked at the send', { timeout: 30000 }, () => {
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
        restoreLatency = installStorageLatency();
        readsOnPath = {};
        addedListeners = [];
        createdObservers = [];
        globalThis.MutationObserver = TrackedMutationObserver;
        cs = null;
    });

    afterEach(async () => {
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

    // 無釘選群組：回到的新對話頁顯示空白、送出不帶群組；釘選 A：回到的新對話頁顯示 A、送出帶 A。兩者 X 都綁到 G，重新打開 X 顯示 G、送出帶 G。
    it.each([
        { name: 'no pinned group, the new-chat page shows the blank option', pinned: '', newChatShown: BLANK },
        { name: 'A pinned, the new-chat page shows the pinned A', pinned: A.id, newChatShown: A.id },
    ])('user returns to the new-chat page right after the bind flow of created chat X issued its first read ($name): X still binds to the picked G', async ({ pinned, newChatShown }) => {
        const overlay = await sendWithGThenLeaveCreatedChatEarly({ pinned });

        expect.soft(storedMap[X], 'G was picked when the first message was sent, so the created chat X must be bound to G even though the user left X before its bind flow finished').toBe(G.id);
        expect.soft(shownValue(overlay), 'the new-chat page the user returned to is another new chat, so it shows the pinned group or the blank option, never the G of X').toBe(newChatShown);
        const sentOnNewChat = await sendOnNewChatThenReopenX();
        expect.soft(sentOnNewChat.value, 'a send on the new-chat page the user returned to must not carry the G of X').not.toContain(G.content);
        if (pinned) expect.soft(sentOnNewChat.value, 'the new-chat page shows the pinned A, so its send carries A').toContain(A.content);
        else expect.soft(sentOnNewChat.value, 'the new-chat page shows the blank option, so its send carries no group').not.toContain('PREFIX-');

        expect.soft(storedMap[X], 'after reopening, the stored binding of X is G').toBe(G.id);
        expect.soft(shownValue(overlay), 'X is bound to G, so reopening X shows G').toBe(G.id);
        const sentOnX = pressEnter('message on reopened X');
        expect.soft(sentOnX.value, 'X shows G, so a send on the reopened X carries G').toContain(G.content);
    });
});
