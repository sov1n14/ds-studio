// 317 行：約 250 行是 content script 載入、持住 BIND 的 SW 替身、觀察器保留與 beforeEach/afterEach 清理的測試支架，複製自 chat-binding-controller.new-chat-pick-during-navigation.scenario.spec.js（該檔私有）；本單元只允許新增這一個檔案，抽成共用 helper 不在範圍內，五個案例共用同一支架，拆檔只會複製支架。
/**
 * 情境（content script 接線）：一個 chat-map 寫入（BIND）仍被 SW 持住時，使用者切換顯示中的群組（在新對話頁選群組，或導覽到另一個對話）；按 Enter 送出的前綴必須是浮動選單此刻顯示的群組，不得沿用前一個群組的前綴。
 *
 * 需求：docs/FEATURES.md「Conversation-Bound Prompt Groups」（切換對話時下拉選單跟著切到綁定的群組；新對話送出第一則訊息後綁定所選群組）與「In-Page Quick Switch Overlay」（浮動選單選的群組就是使用中的群組）。推得的規則：浮動選單顯示的群組與送出的前綴一致；顯示空白選項時送出不帶任何群組；即使另一個對話的 BIND 仍在寫入中也一樣。
 *
 * 時序控制：SW chat-map writer 替身持住指定數量的 BIND，直到測試放行；content script 的 chat-map 讀取排在未完成的寫入之後，所以持有期間任何要讀設定的流程都會卡住。持有的 BIND 只是把時間窗撐開，讓競態可重現。導覽方式依頁面實際行為：頁面自己的 pushState（不送 popstate），再由 body DOM 變動讓 body 觀察器發現網址已換；不直接呼叫 handleChatChange。
 *
 * 只斷言持有期間的送出與顯示；放行後只斷言 SW 提交的對應表。對照組（不持住 BIND）證明持有是造成差異的原因。
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
const Y = 'dddddddd-4444-4444-4444-444444444444';
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
let heldMessages;
/** SW chat-map writer 替身：如 background/chat-map-routes.js 般提交每個寫入；bindsToHold > 0 時，下一個 BIND 記下訊息並等 releaseHeldBind() 才提交。 */
async function serviceWorker(msg) {
    if (!Object.values(DSS_CHAT_MAP_MSG).includes(msg?.type)) return undefined;
    if (msg.type === DSS_CHAT_MAP_MSG.BIND && bindsToHold > 0) {
        bindsToHold -= 1;
        heldMessages.push(msg);
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
async function waitForHeldBind(what) {
    for (let i = 0; i < 3000 && heldBinds.length === 0; i++) await wait(1);
    if (heldBinds.length === 0) throw new Error(`waitForHeldBind: ${what} never dispatched a BIND to the service worker.`);
}

/** 寫入 A、B、G 三個各有前綴的群組，作用中群組為 A，全域提示關閉，以及初始 chat-map。 */
async function seed({ map = {} } = {}) {
    const items = { isEnabled: true, globalPromptEnabled: false, dsPresetIndex: [A.id, B.id, G.id], [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id };
    [A, B, G].forEach((p) => { items[`dsPreset_${p.id}`] = p; });
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

/** 兩個 storage 區的 get 都延遲 STORAGE_LATENCY_MS 才交付並計數；回傳還原函式。 */
function installStorageLatency() {
    const areas = [chrome.storage.local, chrome.storage.sync];
    const originals = areas.map((area) => area.get);
    areas.forEach((area, i) => {
        area.get = function delayedGet(keys, callback) {
            if (typeof keys === 'function') { callback = keys; keys = null; }
            storageReads += 1;
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

/** 在新對話頁載入，選 G 並送出第一則訊息，導覽到建立的對話 X；hold 為 true 時 X 的自動綁定 BIND 被持住。map 是載入前的 chat-map；回傳浮動選單。 */
async function sendFromNewChatAndOpenCreatedChat({ hold, map } = {}) {
    await seed({ map });
    appendHeader();
    const overlay = await loadContentScript(NEW_CHAT);
    clickOption(overlay, G.id);
    await settleUntilQuiet();
    bindsToHold = hold ? 1 : 0;
    const first = pressEnter('first message');
    expect(first.value, 'precondition: the first send on the new-chat page carries the picked G').toContain(G.content);
    navigate(chatPath(X));
    if (hold) {
        await waitForHeldBind('the created chat X');
        expect(heldMessages[0], 'precondition: the held BIND is the auto-bind of the created chat X to G').toMatchObject({ uuid: X, presetId: G.id });
    } else {
        await settleUntilQuiet();
        expect(storedMap[X], 'precondition (control): with no hold, the created chat X binds to G').toBe(G.id);
    }
    return overlay;
}

/** 回到新對話頁並選 B，等到頁面安靜；回傳 Enter 送出的元素。 */
async function pickBOnNewChatAndSend(overlay, { held }) {
    navigate(NEW_CHAT);
    await settleUntilQuiet();
    expect(cs.state.currentChatUuid, 'precondition: the body observer detected the move to the new-chat page').toBeFalsy();
    clickOption(overlay, B.id);
    await settleUntilQuiet();
    expect(heldBinds.length, held ? 'precondition: the BIND is still held when Enter is pressed' : 'precondition (control): no BIND is held').toBe(held ? 1 : 0);
    return pressEnter('message after picking B');
}

/** 從新對話頁送出後、X 的 BIND 持住時導覽到 Y，等到頁面安靜；回傳 Y 上 Enter 送出的元素。 */
async function openChatYAndSend() {
    navigate(chatPath(Y));
    await settleUntilQuiet();
    expect(cs.state.currentChatUuid, 'precondition: the body observer detected the move to chat Y').toBe(Y);
    expect(heldBinds.length, 'precondition: the BIND of X is still held when Enter is pressed on Y').toBe(1);
    return pressEnter('message on Y');
}

// settleUntilQuiet 每輪至少 250 ms，一個案例會跑好幾輪，所以放寬逾時。
describe('the sent prefix follows the shown group while a chat-map BIND is held', { timeout: 30000 }, () => {
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
        bindsToHold = 0;
        heldBinds = [];
        heldMessages = [];
        addedListeners = [];
        createdObservers = [];
        globalThis.MutationObserver = TrackedMutationObserver;
        cs = null;
    });

    afterEach(async () => {
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

    // 案例 1：建立的 X 的自動綁定 BIND 被持住時，回到新對話頁選 B；送出必須帶 B，不得帶上一個群組 G。
    it('auto-bind BIND of created chat X held: B picked on the new-chat page is shown and sent', async () => {
        const overlay = await sendFromNewChatAndOpenCreatedChat({ hold: true });

        const sent = await pickBOnNewChatAndSend(overlay, { held: true });

        expect.soft(sent.value, 'the overlay shows B on the new-chat page, so the send must carry B even while the BIND of X is held').toContain(B.content);
        expect.soft(sent.value, 'the overlay shows B on the new-chat page, so the send must not carry the previous group G').not.toContain(G.content);
        expect.soft(shownValue(overlay), 'the overlay shows the picked B while the BIND of X is held').toBe(B.id);
    });

    // 案例 2：在綁 A 的 X 上手動改選 G（BIND 被持住），到新對話頁選 B；送出必須帶 B，不得帶 X 原本的 A。
    it('manual BIND on chat X held: B picked on the new-chat page is shown and sent', async () => {
        await seed({ map: { [X]: A.id } });
        appendHeader();
        const overlay = await loadContentScript(chatPath(X));
        expect(shownValue(overlay), 'precondition: chat X bound to A shows A on load').toBe(A.id);
        bindsToHold = 1;
        clickOption(overlay, G.id);
        await waitForHeldBind('picking G on chat X');
        expect(heldMessages[0], 'precondition: the held BIND is the manual bind of X to G').toMatchObject({ uuid: X, presetId: G.id });

        const sent = await pickBOnNewChatAndSend(overlay, { held: true });

        expect.soft(sent.value, 'the overlay shows B on the new-chat page, so the send must carry B even while the BIND of X is held').toContain(B.content);
        expect.soft(sent.value, 'the overlay shows B on the new-chat page, so the send must not carry the group A that X showed on load').not.toContain(A.content);
        expect.soft(shownValue(overlay), 'the overlay shows the picked B while the BIND of X is held').toBe(B.id);
    });

    // 案例 3：X 的自動綁定 BIND 被持住時，使用者打開未綁定的 Y；Y 顯示空白選項，送出不得帶新對話頁的 G。放行後 X 綁 G、Y 仍未綁定。
    it('auto-bind BIND of created chat X held: a send on unbound chat Y carries no group', async () => {
        const overlay = await sendFromNewChatAndOpenCreatedChat({ hold: true });

        const sent = await openChatYAndSend();

        expect.soft(sent.value, 'unbound Y shows no group, so a send on Y must carry no group even while the BIND of X is held').not.toContain('PREFIX-');
        expect.soft(shownValue(overlay), 'unbound Y shows the blank option while the BIND of X is held').toBe(BLANK);
        releaseHeldBind();
        await settleUntilQuiet();
        expect(storedMap[X], 'the held BIND commits X to G').toBe(G.id);
        expect(storedMap[Y], 'Y was opened by hand and stays unbound').toBeUndefined();
    });

    // 案例 4：同上，但 Y 已綁定 B；送出必須帶 B，不得帶新對話頁的 G。
    it('auto-bind BIND of created chat X held: a send on chat Y bound to B carries B', async () => {
        const overlay = await sendFromNewChatAndOpenCreatedChat({ hold: true, map: { [Y]: B.id } });

        const sent = await openChatYAndSend();

        expect.soft(sent.value, 'Y is bound to B, so a send on Y must carry B even while the BIND of X is held').toContain(B.content);
        expect.soft(sent.value, 'Y is bound to B, so a send on Y must not carry the new-chat page group G').not.toContain(G.content);
        expect.soft(shownValue(overlay), 'Y bound to B shows B while the BIND of X is held').toBe(B.id);
    });

    // 案例 5（對照組，現行程式應為綠燈）：與案例 1 相同步驟但不持住 BIND；送出帶 B，證明持有是造成差異的原因。
    it('control, no BIND held: B picked on the new-chat page after the created chat X is shown and sent', async () => {
        const overlay = await sendFromNewChatAndOpenCreatedChat({ hold: false });

        const sent = await pickBOnNewChatAndSend(overlay, { held: false });

        expect.soft(sent.value, 'the overlay shows B on the new-chat page, so the send carries B').toContain(B.content);
        expect.soft(sent.value, 'the send does not carry the previous group G').not.toContain(G.content);
        expect.soft(shownValue(overlay), 'the overlay shows the picked B').toBe(B.id);
    });
});
