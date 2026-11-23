/**
 * 情境（content-script 初始化失敗的診斷記錄）：初始化因信任邊界失敗而中止時，錯誤必須留下可診斷的記錄，而不是被靜默吞掉。
 *
 * 需求：初始化中途失敗（chrome.storage.local.set 回報 lastError、chrome.storage.onChanged.addListener 同步拋錯）時，console.error 被呼叫一次，第一個參數正好是 '[DSS] init:failed'，第二個參數是該錯誤。
 * 需求（對照）：錯誤訊息含「Extension context invalidated」時（擴充功能重新載入後，舊頁面上的內容腳本必然遇到）不記錄 '[DSS] init:failed'。
 * '[DSS] init:failed' 是使用者指定的診斷前綴，屬於可觀察的契約，因此斷言它。
 *
 * 每個測試自行載入 content-script.js：初始化只在載入時跑一次，靜態匯入會讓初始化在注入失敗之前就跑完。afterEach 讓前一個實例失效（移除訊息監聽、卸載覆蓋層），因為新載入會留下它們。
 *
 * 只模擬信任邊界：記憶體內 chrome.storage 的寫入失敗、監聽註冊拋錯。所有 content 模組與 StorageManager 都是真的；只監看 console.error。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import { writeChatMapLayout } from '../helpers/chat-map-writer-harness.js';

const HEADER_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/conversation-header.html'), 'utf8');
const X = 'aaaaaaaa-1111-1111-1111-111111111111';
const CHAT_X = `/a/chat/s/${X}`;
const A = { id: 'preset-A', name: 'preset-A', content: 'PREFIX-A', createdAt: 1, updatedAt: 1 };
const IS_ENABLED = StorageManager.KEYS.IS_ENABLED;
const SYNC_INITIALIZED = StorageManager.KEYS.SYNC_INITIALIZED;
const A_REMOTE_CONTENT = 'PREFIX-A-REMOTE';

const INIT_FAILED_PREFIX = '[DSS] init:failed';
const QUOTA_MESSAGE = 'QUOTA_BYTES quota exceeded';
const LISTENER_THROW_MESSAGE = 'chrome.storage.onChanged.addListener failed';
// 真實 Chrome 在擴充功能重新載入後，舊頁面呼叫 chrome.* 時的錯誤訊息。
const INVALIDATED_MESSAGE = 'Extension context invalidated.';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed() {
    // isEnabled 只存在 local（與 popup 的寫入位置一致）；群組與聊天綁定兩區都放，讓同步流程不改動任何設定。
    // syncInitialized 為 true：這台裝置已完成首次合併，雲端較新的版本才會在讀取時回寫本機。
    await chrome.storage.local.set({ [IS_ENABLED]: true, globalPromptEnabled: false, [SYNC_INITIALIZED]: true });
    const presets = { dsPresetIndex: [A.id], [`dsPreset_${A.id}`]: A };
    await chrome.storage.local.set(presets);
    await chrome.storage.sync.set(presets);
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [{ [X]: A.id }]);
}

function appendHeader() {
    const holder = document.createElement('div');
    holder.innerHTML = HEADER_HTML;
    return document.body.appendChild(holder.firstElementChild);
}

/** 包住兩個 storage 區的 get，記錄進行中的讀取數，供判斷初始化是否已靜止。回傳 { inFlight, restore }。 */
function countReads() {
    const reads = { inFlight: 0 };
    const areas = [chrome.storage.local, chrome.storage.sync];
    const originals = areas.map((area) => area.get);
    areas.forEach((area, i) => {
        area.get = function (keys, callback) {
            if (typeof keys === 'function') { callback = keys; keys = null; }
            reads.inFlight++;
            const onDelivered = () => { reads.inFlight--; };
            if (callback) return originals[i].call(this, keys, (result) => { onDelivered(); callback(result); });
            const pending = originals[i].call(this, keys);
            pending.then(onDelivered, onDelivered);
            return pending;
        };
    });
    reads.restore = () => areas.forEach((area, i) => { area.get = originals[i]; });
    return reads;
}

/**
 * 讓 chrome.storage.local.set 對含 `key` 的寫入以 `message` 失敗且不存入資料：callback 形式只在該次 callback 執行期間設定 chrome.runtime.lastError，promise 形式直接 reject。
 * 回傳 { hits, failedItems, restore }；hits 記錄失敗次數、failedItems 記錄每次失敗寫入的內容，供前置條件確認注入的失敗確實發生在預期的寫入上。
 */
function failLocalWritesOf(key, message) {
    const area = chrome.storage.local;
    const original = area.set;
    const failure = { hits: 0, failedItems: [] };
    area.set = function (items, callback) {
        if (!(items && key in items)) return original.call(this, items, callback);
        failure.hits++;
        failure.failedItems.push(structuredClone(items));
        if (!callback) return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));
        setTimeout(() => {
            chrome.runtime.lastError = { message };
            try { callback(); } finally { delete chrome.runtime.lastError; }
        }, 0);
        return undefined;
    };
    failure.restore = () => { area.set = original; };
    return failure;
}

/** 讓 chrome.storage.onChanged.addListener 註冊 `listener` 時以 `message` 同步拋錯；其他註冊照常。回傳 { hits, restore }。 */
function throwOnStorageListenerRegistration(listener, message) {
    const original = chrome.storage.onChanged.addListener;
    const failure = { hits: 0 };
    chrome.storage.onChanged.addListener = (fn) => {
        if (fn === listener) {
            failure.hits++;
            throw new Error(message);
        }
        return original(fn);
    };
    failure.restore = () => { chrome.storage.onChanged.addListener = original; };
    return failure;
}

/** 兩種信任邊界失敗；`inject(message)` 在載入前布置失敗並回傳 { hits, restore }。 */
const FAILURE_MODES = [
    {
        name: 'a rejected storage write during init write-back (chrome.storage.local.set reports lastError)',
        message: QUOTA_MESSAGE,
        inject: async (message) => {
            // 已同步過的裝置上，雲端的 preset-A 較新：初始化讀取設定時會把雲端版回寫本機，而這筆本機寫入失敗。
            await chrome.storage.sync.set({ [`dsPreset_${A.id}`]: { ...A, content: A_REMOTE_CONTENT, updatedAt: 2 } });
            return failLocalWritesOf(`dsPreset_${A.id}`, message);
        },
    },
    {
        name: 'a synchronous throw (chrome.storage.onChanged.addListener throws)',
        message: LISTENER_THROW_MESSAGE,
        inject: async (message) => throwOnStorageListenerRegistration(globalThis.dsI18n._handleStorageChanged, message),
    },
];

let cs;
let addedListeners;
let originalAddListener;
let reads;
let failure;

/** 等到注入的失敗已發生、沒有進行中的 storage 讀取，且連續維持 150ms（初始化已中止並靜止）；超過 3 秒拋出 Setup 錯誤。 */
async function waitForFailedInitSettled() {
    const deadline = Date.now() + 3000;
    let quietSince = null;
    while (Date.now() < deadline) {
        const isQuiet = failure.hits > 0 && reads.inFlight === 0;
        if (!isQuiet) quietSince = null;
        else if (quietSince === null) quietSince = Date.now();
        else if (Date.now() - quietSince >= 150) return;
        await wait(5);
    }
    throw new Error(`Setup: the injected init failure did not settle within 3s (failure hits=${failure.hits}, reads in flight=${reads.inFlight}).`);
}

/** 布置 `mode` 的失敗（訊息為 `message`），在 CHAT_X 上全新載入 content-script.js，等初始化中止並靜止，再確認失敗確實中止了初始化。 */
async function loadWithAbortedInit(mode, message) {
    failure = await mode.inject(message);
    reads = countReads();
    setPathname(CHAT_X);
    vi.resetModules();
    cs = (await import('../../content/content-script.js')).default;
    await waitForFailedInitSettled();
    expect(failure.hits, 'precondition: init hit the injected failure').toBeGreaterThan(0);
    // 寫入失敗模式：失敗的本機寫入必須是雲端較新 preset-A 的回寫，而非其他寫入。
    if (failure.failedItems) {
        const failedContents = failure.failedItems.map((items) => items[`dsPreset_${A.id}`]?.content);
        expect(failedContents, 'precondition: a failed local write carries the cloud-newer preset-A, i.e. it is a cloud-wins write-back').toContain(A_REMOTE_CONTENT);
    }
    expect(cs.PresetOverlay.wrapperEl, 'precondition: the failure aborted init before it started the overlay').toBeFalsy();
}

const initFailedLogs = () => console.error.mock.calls.filter((args) => args[0] === INIT_FAILED_PREFIX);

describe('content-script: an init failure is logged as "[DSS] init:failed" unless the extension context is invalidated', () => {
    beforeEach(async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // 記錄本實例註冊的 onMessage 監聽，供 afterEach 移除。
        addedListeners = [];
        originalAddListener = chrome.runtime.onMessage.addListener;
        chrome.runtime.onMessage.addListener = (fn) => { addedListeners.push(fn); originalAddListener(fn); };
        // 真實頁面每次載入都是全新的 dsI18n；重設後初始化才會像新頁面一樣註冊它的 storage 監聽。
        globalThis.dsI18n._reset();
        cs = null;
        reads = null;
        failure = null;
        await seed();
        appendHeader();
    });

    afterEach(() => {
        if (cs) {
            // 停用本實例的 document 層注入監聽並移除覆蓋層。
            Object.assign(cs.state, { isEnabled: false, isInjecting: true });
            clearTimeout(cs.state.awaitingNewChatUuidTimer);
            cs.PresetOverlay.unmount();
            // 本實例的 body observer 會呼叫這個方法；改成 no-op，避免覆蓋層重新掛進下一個測試的 header。
            cs.PresetOverlay.scheduleFindAndMount = () => {};
        }
        failure?.restore();
        reads?.restore();
        chrome.runtime.onMessage.addListener = originalAddListener;
        addedListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
        globalThis.dsI18n._reset();
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        setPathname('/');
    });

    describe.each(FAILURE_MODES)('init aborted by $name', (mode) => {
        it('console.error is called once with "[DSS] init:failed" and the init error', async () => {
            await loadWithAbortedInit(mode, mode.message);

            const logs = initFailedLogs();
            const seen = JSON.stringify(console.error.mock.calls.map((args) => args[0]));
            expect(logs, `exactly one console.error call has first argument "${INIT_FAILED_PREFIX}" (first arguments seen: ${seen})`).toHaveLength(1);
            expect(logs[0][1]?.message, 'the second console.error argument is the error that aborted init').toContain(mode.message);
        });

        it('control: an "Extension context invalidated" error is not logged as "[DSS] init:failed"', async () => {
            await loadWithAbortedInit(mode, INVALIDATED_MESSAGE);

            expect(initFailedLogs(), `no console.error call has first argument "${INIT_FAILED_PREFIX}" for an invalidated extension context`).toEqual([]);
        });
    });
});
