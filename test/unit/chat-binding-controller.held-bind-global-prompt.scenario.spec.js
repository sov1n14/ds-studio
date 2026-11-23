/**
 * 情境（content script 接線）：建立聊天 X 的自動綁定 BIND 仍被持有、使用者已手動開啟未綁定聊天 Y 時，使用者從另一個分頁的 popup 切換裝置層級的全域提示開關；Y 上的送出要立刻依新開關決定是否帶全域提示，不得沿用新對話頁留下的舊值。
 *
 * 需求：docs/ARCHITECTURE.md「Global prompt toggle subordination」（沒有顯示中的群組時，由裝置層級 globalPromptEnabled 決定；該鍵變更時重算，使顯示與注入結果一致）與 docs/FEATURES.md「Global Prompt」（未選群組時開關回退到裝置層級狀態）。Y 未綁定且浮動選單顯示空白選項（前置條件），所以裝置層級開關決定 Y 的全域提示。
 *
 * 為何要切換開關：切換前新對話頁留下的狀態與 Y 應有的狀態一致，送出看不出差別；切換後兩者分歧，Y 的送出才能分辨是依新開關還是沿用舊值。兩個方向都測：只把旗標強制關掉的修正無法通過「開」的案例。
 *
 * 時序控制：SW chat-map writer 替身持住收到的第一個 BIND，直到測試放行；content script 的 chat-map 讀取排在未完成的 chat-map 寫入之後，所以持有期間 Y 的流程維持進行中。
 *
 * 只模擬信任邊界：記憶體版 chrome.storage（真實 Chrome onChanged 語意與固定讀取延遲）、SW 設定轉送、SW chat-map writer（promise 形式 sendMessage）與 navigator（裝置設定檔）；所有 content 模組皆為真實模組。輔助函式複製自 chat-binding-controller.late-auto-bind-scope.scenario.spec.js（該檔將其保留為私有）。
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
// G 沒有自己的 globalPromptEnabled 欄位，視為開啟。
const G = preset('preset-G', 'PREFIX-G');
// G 關閉自己的全域提示開關。
const G_GLOBAL_OFF = { ...G, globalPromptEnabled: false };
const GLOBAL_PROMPT = 'GLOBAL-INSTRUCTION';
// 非觸控 Windows 桌機上的真實 Edge，Enter 走桌面送出路徑。
const DESKTOP = { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0' };
// 每次 storage 讀取的固定延遲（ms），模擬 chrome.storage 的非同步往返。
const STORAGE_LATENCY_MS = 5;
const BLANK = '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { await wait(250); for (let i = 0; i < 30; i++) await wait(0); };
let storageReads = 0;
/** 重複 settle，直到一整輪都沒有 storage 讀取；最多 20 輪。 */
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
/** SW chat-map writer 替身：如 background/chat-map-routes.js 般提交每個請求；bindsToHold > 0 時下一個 BIND 等到 releaseHeldBind() 才提交。 */
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

/** 等到 SW 替身持住一個 BIND；逾時則拋出。 */
async function waitForHeldBind() {
    for (let i = 0; i < 3000 && heldBinds.length === 0; i++) await wait(1);
    if (heldBinds.length === 0) throw new Error('waitForHeldBind: the created chat never dispatched its auto-bind BIND to the service worker.');
}

async function seed({ presets, settings }) {
    const items = { isEnabled: true, dsPresetIndex: presets.map((p) => p.id), ...settings };
    presets.forEach((p) => { items[`dsPreset_${p.id}`] = p; });
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
/** 記錄每個案例建立的 MutationObserver，讓 afterEach 斷開，舊的 content script 實例不會在下一個案例執行導航檢查。 */
class TrackedMutationObserver extends OriginalMutationObserver {
    constructor(callback) {
        super(callback);
        createdObservers.push(this);
    }
}
/** 在 `pathname` 上執行 content-script.js，等 initSettings() 完成，再等頁面靜止。 */
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

/** 聚焦一個內容為 `text` 的頁面 textarea、如使用者送出般按下 Enter，再移除它，讓之後的送出只找到自己的 textarea；回傳的元素保留送出的值。 */
function pressEnter(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    ta.remove();
    return ta;
}

/** 追蹤流程 promise 是否已結束，不讓它的 rejection 外洩。 */
function track(flow) {
    const tracked = { done: false };
    tracked.promise = flow.then(() => { tracked.done = true; }, () => { tracked.done = true; });
    return tracked;
}

/** 依 isExpected 斷言送出的訊息帶或不帶全域提示。 */
const expectGlobalPrompt = (sent, isExpected, message) => (isExpected ? expect(sent.value, message).toContain(GLOBAL_PROMPT) : expect(sent.value, message).not.toContain(GLOBAL_PROMPT));

// settleUntilQuiet 每輪至少 250 ms，一個案例會跑好幾輪，所以放寬單一案例逾時。
describe('a device-level global prompt toggle reaches unbound chat Y while the auto-bind BIND of another chat is held', { timeout: 30000 }, () => {
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
        addedListeners = [];
        createdObservers = [];
        globalThis.MutationObserver = TrackedMutationObserver;
        cs = null;
    });

    afterEach(async () => {
        // 持有中的 BIND 會卡住共用的 StorageManager chat-map 佇列，影響下一個案例。
        while (heldBinds.length > 0) releaseHeldBind();
        await settle();
        if (cs) {
            // 停用此實例掛在 document 上的注入監聽並移除它的浮動選單。
            Object.assign(cs.state, { isEnabled: false, isInjecting: true });
            clearTimeout(cs.state.awaitingNewChatUuidTimer);
            cs.PresetOverlay.unmount();
            // 此實例的 body observer 會呼叫這個方法；改成空函式，避免浮動選單掛進下一個案例的標頭。
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

    // 新對話頁選的群組 G 與裝置層級開關一開始一致（同為開或同為關）；使用者在未綁定的 Y 上、X 的 BIND 仍被持有時，從另一個分頁沒有作用中群組的 popup 把裝置層級開關切到相反值。
    it.each([
        { direction: 'off', picked: G, isOnBefore: true, isOnAfter: false },
        { direction: 'on', picked: G_GLOBAL_OFF, isOnBefore: false, isOnAfter: true },
    ])('device-level global prompt turned $direction on unbound Y while the BIND of X is held: a send on Y follows the new flag before the BIND is released and after Y settles', async ({ picked, isOnBefore, isOnAfter }) => {
        await seed({ presets: [A, picked], settings: { [StorageManager.KEYS.ACTIVE_PRESET_ID]: A.id, globalPromptEnabled: isOnBefore, [StorageManager.KEYS.GLOBAL_DEFAULT_PROMPT]: GLOBAL_PROMPT } });
        appendHeader();
        const overlay = await loadContentScript(NEW_CHAT);
        clickOption(overlay, picked.id);
        await settleUntilQuiet();
        bindsToHold = 1;
        const first = pressEnter('first message');
        expect(first.value, `precondition: the first send on the new chat carries ${picked.id}`).toContain(picked.content);
        expectGlobalPrompt(first, isOnBefore, `precondition: the global prompt of ${picked.id} matches the device-level flag before the toggle`);
        setPathname(chatPath(CREATED));
        const createdFlow = track(cs.handleChatChange());
        await waitForHeldBind();

        // 使用者手動開啟未綁定的 Y。
        setPathname(chatPath(OTHER));
        const otherFlow = track(cs.handleChatChange());
        await settleUntilQuiet();
        expect(shownValue(overlay), 'precondition: unbound Y shows the blank option, so the device-level flag decides its global prompt').toBe(BLANK);
        expectGlobalPrompt(pressEnter('message on Y before the toggle'), isOnBefore, 'precondition: before the toggle, a send on unbound Y follows the device-level flag');

        // 另一個分頁沒有作用中群組的 popup 寫入裝置層級開關，如 popup.toggles.js 所做。
        await StorageManager.saveGlobalPromptEnabled(isOnAfter);
        await settleUntilQuiet();
        expect(heldBinds.length, 'precondition: the BIND of X is still held after the toggle').toBe(1);
        expect(otherFlow.done, 'precondition: the flow of Y waits behind the held BIND of X').toBe(false);
        expect(shownValue(overlay), 'precondition: Y still shows the blank option after the toggle').toBe(BLANK);
        expectGlobalPrompt(pressEnter('message on Y while the BIND of X is held'), isOnAfter, `the device-level global prompt was turned ${isOnAfter ? 'on' : 'off'} and unbound Y shows no group, so a send on Y must follow the new flag at once, even while the BIND of another chat is held`);

        releaseHeldBind();
        await createdFlow.promise;
        await otherFlow.promise;
        await settleUntilQuiet();
        expect(storedMap[CREATED], 'X ends bound to the group sent on the new-chat page').toBe(picked.id);
        expect(storedMap[OTHER], 'Y was opened by hand and stays unbound').toBeUndefined();
        expectGlobalPrompt(pressEnter('message on Y after it settles'), isOnAfter, 'once Y settles, a send on unbound Y follows the new device-level flag');
        expect(shownValue(overlay), 'Y ends on the blank option').toBe(BLANK);
    });
});
