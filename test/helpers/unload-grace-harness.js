/**
 * 分頁卸載寬限期（unload grace）情境測試用的 service worker 執行環境。
 *
 * 以 Chrome 執行 classic service worker 的方式載入「真的」background/service-worker.js：一個全新的 vm context 充當 worker 全域，service-worker.js 在其中以 classic script 執行，它自己的 importScripts() 會把每個檔案（相對於 background/ 解析）載入同一個 context，因此 pending-store、各 routes 模組與之後新增的 background/unload-grace.js 都是真實模組，彼此共用 top-level 宣告。
 *
 * 只替換信任邊界：chrome.storage（記憶體實作，get/set 皆 structuredClone，onChanged 由各 area 匯流）、chrome.runtime 事件（記錄監聽器，訊息依 Chrome 的方式派送給每個監聽器）、chrome.alarms（以 Map 保存，可觀察排程）、chrome.tabs.query（依分頁表誠實過濾 url 等查詢條件，見 fake-chrome-tabs.js）、fetch、console，以及 worker 的計時器與 Date.now（手動推進的時鐘，宿主端計時器不受影響，所以 storage 替身的 setTimeout(0) 照常運作）。
 *
 * 重新啟動：bootWorker(world) 會清掉前一個 worker 的計時器與監聽器（模擬 worker 被終止），再以同一份 storage、alarms 與分頁表載入新的 worker 實例。
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { vi } from 'vitest';
import { InMemoryStorageMock } from '../fixtures/chrome-storage-mock.js';
import { installFakeTabs } from './fake-chrome-tabs.js';

const BACKGROUND_DIR = path.resolve(__dirname, '../../background');
const EXTENSION_ID = 'test-extension-id';
// @stryker-mutator/api INSTRUMENTER_CONSTANTS.NAMESPACE：插樁程式碼與 vitest-runner 共用的全域命名空間
const STRYKER_NAMESPACE = '__stryker__';
export const START = 1700000000000;
export const ORIGIN = 'https://chat.deepseek.com';
export const chatUrl = (uuid) => ORIGIN + '/a/chat/s/' + uuid;
export const tab = (id, url, extra = {}) => ({ id, windowId: 1, active: false, url, ...extra });

function createEvent() {
    const listeners = [];
    return {
        listeners,
        addListener: (fn) => { listeners.push(fn); },
        removeListener: (fn) => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); },
        hasListener: (fn) => listeners.includes(fn),
    };
}

/** worker 專用的手動時鐘：setTimeout / setInterval 只在 advance 時觸發，Date.now 讀同一個時間。 */
function createClock(start) {
    let now = start;
    let seq = 0;
    const timers = new Map();
    const add = (fn, ms, args, isRepeat) => {
        const delay = Math.max(isRepeat ? 1 : 0, Number(ms) || 0);
        const id = ++seq;
        timers.set(id, { at: now + delay, fn, args, interval: isRepeat ? delay : null });
        return id;
    };
    return {
        now: () => now,
        setNow: (ms) => { now = ms; },
        setTimeout: (fn, ms, ...args) => add(fn, ms, args, false),
        setInterval: (fn, ms, ...args) => add(fn, ms, args, true),
        clearTimeout: (id) => { timers.delete(id); },
        clearInterval: (id) => { timers.delete(id); },
        clearAll: () => { timers.clear(); },
        pendingCount: () => timers.size,
        /** 最早到期（不晚於 limit）的計時器；同時到期時依建立順序。 */
        nextDue(limit) {
            let best = null;
            for (const [id, t] of timers) {
                if (t.at <= limit && (best === null || t.at < best.t.at)) best = { id, t };
            }
            return best;
        },
        run({ id, t }) {
            if (now < t.at) now = t.at;
            if (t.interval) t.at += t.interval;
            else timers.delete(id);
            if (typeof t.fn === 'function') t.fn(...t.args);
        },
    };
}

/** 一個瀏覽器設定檔的世界：storage、alarms、分頁表與 fetch 在 worker 重新啟動後依然存在。 */
export function createWorld({ tabs = [] } = {}) {
    const clock = createClock(START);
    const areas = { local: new InMemoryStorageMock('local'), sync: new InMemoryStorageMock('sync'), session: new InMemoryStorageMock('session') };
    const onChanged = createEvent();
    const fanIn = (changes, area) => onChanged.listeners.forEach((fn) => fn(changes, area));
    Object.values(areas).forEach((a) => a.onChanged.addListener(fanIn));
    const alarms = new Map();
    // 借用 fake-chrome-tabs 的過濾邏輯：裝到全域 chrome.tabs 取出 query 後立即還原，分頁表仍由 fakeTabs.tabs 控制
    const fakeTabs = installFakeTabs(tabs);
    const query = chrome.tabs.query;
    fakeTabs.restore();
    const events = { onMessage: createEvent(), onInstalled: createEvent(), onStartup: createEvent(), onAlarm: createEvent(), onAdded: createEvent(), onRemoved: createEvent() };
    const chromeFake = {
        storage: { ...areas, onChanged },
        runtime: { id: EXTENSION_ID, lastError: undefined, getURL: (p) => 'chrome-extension://' + EXTENSION_ID + '/' + p, sendMessage: vi.fn(async () => undefined), onMessage: events.onMessage, onInstalled: events.onInstalled, onStartup: events.onStartup },
        alarms: {
            create: vi.fn(async (name, info) => { alarms.set(name, { ...info }); }),
            clear: vi.fn(async (name) => alarms.delete(name)),
            get: vi.fn(async (name) => (alarms.has(name) ? { name, ...alarms.get(name) } : undefined)),
            getAll: vi.fn(async () => [...alarms].map(([name, info]) => ({ name, ...info }))),
            onAlarm: events.onAlarm,
        },
        tabs: { query: vi.fn(query), sendMessage: vi.fn(async () => undefined) },
        windows: { create: vi.fn(async () => ({ id: 1 })), update: vi.fn(async () => ({})), remove: vi.fn(async () => undefined) },
        permissions: { contains: vi.fn(async () => false), request: vi.fn(async () => false), getAll: vi.fn(async () => ({ permissions: [], origins: [] })), onAdded: events.onAdded, onRemoved: events.onRemoved },
    };
    const consoleFake = { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const world = { clock, chrome: chromeFake, events, onChanged, alarms, fakeTabs, fetch: vi.fn(async () => ({ ok: true })), console: consoleFake, listenerErrors: [], worker: null, bootCount: 0 };
    bootWorker(world);
    return world;
}

/** 載入（或重新載入）真的 service worker。前一個 worker 的計時器與監聽器隨之消失，如同 Chrome 終止 worker。 */
export function bootWorker(world) {
    world.clock.clearAll();
    Object.values(world.events).forEach((e) => { e.listeners.length = 0; });
    world.onChanged.listeners.length = 0;
    const c = world.clock;
    const ctx = {
        chrome: world.chrome,
        console: world.console,
        fetch: (...args) => world.fetch(...args),
        setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, setInterval: c.setInterval, clearInterval: c.clearInterval,
        queueMicrotask, structuredClone, crypto, URL, URLSearchParams, AbortController, AbortSignal, TextEncoder, TextDecoder,
        __dssNow: () => c.now(),
    };
    // Stryker 的變異切換與覆蓋記錄都讀寫插樁程式碼所在 realm 的 globalThis.__stryker__（instrumenter 預設命名空間）；vm context 有自己的 globalThis，不轉交時 worker 內永遠看不到啟用中的變異體，覆蓋也記不回測試執行器。有值（Stryker 執行中）才轉交同一個物件，一般 vitest 執行不受影響。
    if (globalThis[STRYKER_NAMESPACE]) ctx[STRYKER_NAMESPACE] = globalThis[STRYKER_NAMESPACE];
    vm.createContext(ctx);
    ctx.self = vm.runInContext('globalThis', ctx);
    vm.runInContext('Date.now = function () { return __dssNow(); };', ctx);
    const runScript = (file) => {
        if (!fs.existsSync(file)) throw new Error('service worker requested ' + path.relative(BACKGROUND_DIR, file) + ', which does not exist');
        vm.runInContext(fs.readFileSync(file, 'utf-8'), ctx, { filename: file });
    };
    ctx.importScripts = (...urls) => urls.forEach((url) => runScript(path.resolve(BACKGROUND_DIR, url)));
    runScript(path.join(BACKGROUND_DIR, 'service-worker.js'));
    world.worker = ctx;
    world.bootCount += 1;
    return ctx;
}

/** 讀 worker realm 的 top-level 宣告（classic script 的 const 不是 globalThis 屬性）。 */
export function readWorkerBinding(world, name) {
    return vm.runInContext('typeof ' + name + ' === "undefined" ? undefined : ' + name, world.worker);
}

/** worker 內的臨時對話常數（utils/temporary-chat-constants.js 掛到 globalThis.DSS_TEMP_CHAT）。 */
export const temp = (world) => world.worker.DSS_TEMP_CHAT;

/** 分頁卸載交接訊息型別 DSS_TEMP_CHAT.DSS_MSG_TAB_UNLOADING（值 'DSS_TAB_UNLOADING'）；常數尚未定義時為 undefined，送出的訊息不會被任何路由認得。 */
export const unloadType = (world) => temp(world).DSS_MSG_TAB_UNLOADING;

function runDue(world) {
    for (let i = 0; i < 100; i++) {
        const next = world.clock.nextDue(world.clock.now());
        if (!next) return;
        world.clock.run(next);
    }
}

/** 讓宿主端非同步工作（storage 替身的 setTimeout(0)）與 worker 已到期的計時器跑完；不推進時間。 */
export async function settle(world, rounds = 30) {
    for (let i = 0; i < rounds; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        runDue(world);
    }
}

/** 推進 worker 時鐘到絕對時間 target，依序觸發其間到期的計時器，每個之間讓非同步工作跑完。 */
export async function advanceTo(world, target) {
    for (;;) {
        await settle(world, 8);
        const next = world.clock.nextDue(target);
        if (!next) break;
        world.clock.run(next);
    }
    world.clock.setNow(Math.max(world.clock.now(), target));
    await settle(world);
}
export const advanceBy = (world, ms) => advanceTo(world, world.clock.now() + ms);

/** 依 Chrome 的方式把 runtime 訊息派送給 worker 註冊的每個 onMessage 監聽器（訊息為複本），回傳送達寄件端的回應。 */
export async function sendToWorker(world, message, senderUrl) {
    const responses = [];
    let isDispatching = true;
    let isChannelOpen = false;
    const sendResponse = (payload) => { if (isDispatching || isChannelOpen) responses.push(structuredClone(payload)); };
    const sender = { id: EXTENSION_ID, frameId: 0, url: senderUrl, tab: senderUrl ? { id: 7, windowId: 1, url: senderUrl } : undefined };
    for (const listener of [...world.events.onMessage.listeners]) {
        try {
            if (listener(structuredClone(message), sender, sendResponse) === true) isChannelOpen = true;
        } catch (err) {
            world.listenerErrors.push(err);
        }
    }
    isDispatching = false;
    await settle(world, 10);
    return responses;
}

/** content 端在臨時對話頁面送出的訊息（寄件分頁停在該對話）。 */
export const trackForDeletion = (world, uuid) => sendToWorker(world, { type: temp(world).DSS_MSG_TRACK_FOR_DELETION, uuid }, chatUrl(uuid));
export const heartbeat = (world, uuid) => sendToWorker(world, { type: temp(world).DSS_MSG_HEARTBEAT, uuid }, chatUrl(uuid));
export const relayToken = (world, token) => sendToWorker(world, { type: temp(world).DSS_MSG_SET_LAST_AUTH_TOKEN, token }, ORIGIN + '/');
/** beforeunload 交接：分頁卸載當下仍停在該對話。 */
export const tabUnloading = (world, uuid) => sendToWorker(world, { type: unloadType(world), uuid }, chatUrl(uuid));

/** 觸發瀏覽器啟動事件（chrome.runtime.onStartup）。 */
export async function fireStartup(world) {
    world.events.onStartup.listeners.forEach((fn) => fn());
    await settle(world, 40);
}

export function setTabs(world, tabs) {
    world.fakeTabs.tabs.splice(0, world.fakeTabs.tabs.length, ...tabs.map((t) => ({ ...t })));
}

export async function readQueue(world) {
    const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
    return (await world.chrome.storage.sync.get(key))[key] || [];
}
export async function queueEntry(world, uuid) {
    return (await readQueue(world)).find((e) => e.chatUuid === uuid);
}
/** 本機開啟中臨時對話集合，經由 worker 內真的 pending-store 公開 API 讀取。 */
export async function readOpenUuids(world) {
    return [...(await readWorkerBinding(world, 'TemporaryChatPendingStore').getOpenUuids())];
}

/** 送往 DeepSeek 刪除端點的每個請求（依序），含解析後的請求主體。 */
export function deleteRequests(world) {
    return world.fetch.mock.calls
        .filter(([url]) => String(url).includes('/api/v0/chat_session/delete'))
        .map(([url, init]) => ({ url: String(url), rawBody: init.body, body: JSON.parse(init.body), authorization: init.headers?.authorization }));
}
export const deleteRequestsFor = (world, uuid) => deleteRequests(world).filter((r) => r.body.chat_session_id === uuid);

/** 目前排定的刪除重試 alarm（名稱取自 worker 的 RETRY_ALARM_NAME）。 */
export function retryAlarm(world) {
    return world.alarms.get(readWorkerBinding(world, 'RETRY_ALARM_NAME'));
}
