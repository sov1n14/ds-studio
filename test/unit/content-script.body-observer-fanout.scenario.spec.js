/**
 * 情境（content-script 的 body 觀察器扇出）：初始化完成後，頁面 body 的 DOM 變動必須觸發 SPA 導覽偵測與浮動選單重掛。
 *
 * 需求（docs/architecture/content-navigation.md）：content script 持有唯一的 document.body childList + subtree 觀察器，回呼扇出到導覽檢查與 scheduleFindAndMount()。
 * - 導覽：DeepSeek 以頁面自己的 history.pushState 切換對話，不觸發 popstate；隨之而來的 DOM 變動讓 content script 發現網址已換到另一個對話，並套用該對話綁定的 preset。
 * - 重掛：React 換掉對話標題列時，浮動選單在 150ms 去抖動後重新掛進新的標題列。
 *
 * 只模擬信任邊界：記憶體內 chrome.storage（setup 提供）。所有 content 模組與 StorageManager 都是真的；DOM 由 happy-dom 提供。
 * happy-dom 16 在 observe() 內以 WeakRef 包住一個沒有其他參考的箭頭函式，GC 一跑 body 觀察器就不再觸發；強參考觀察器與回呼本身留不住這個箭頭函式。真實瀏覽器在節點仍被觀察時保留觀察器。
 * 因此本檔把 MutationObserver 換成真實實作的子類別：observe() 期間以強參考代替 WeakRef（等同瀏覽器行為），並記錄每個觀察器，在 afterEach 中斷，讓前一個實例不會回應下一個測試的 DOM 變動。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import { writeChatMapLayout } from '../helpers/chat-map-writer-harness.js';
import { waitForContentScriptInit } from '../helpers/content-script-init-probe.js';

const HEADER_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/conversation-header.html'), 'utf8');
const X = 'aaaaaaaa-1111-1111-1111-111111111111';
const Y = 'bbbbbbbb-2222-2222-2222-222222222222';
const CHAT_X = `/a/chat/s/${X}`;
const CHAT_Y = `/a/chat/s/${Y}`;
const A = { id: 'preset-A', name: 'preset-A', content: 'PREFIX-A', createdAt: 1, updatedAt: 1 };
const B = { id: 'preset-B', name: 'preset-B', content: 'PREFIX-B', createdAt: 1, updatedAt: 1 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 輪詢至條件成立或逾時；不拋錯，由呼叫端的斷言判定結果。 */
async function pollUntil(condition, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) await wait(5);
}

async function seed() {
    const settings = { globalPromptEnabled: false };
    settings[StorageManager.KEYS.IS_ENABLED] = true;
    await chrome.storage.local.set(settings);
    const presets = { dsPresetIndex: [A.id, B.id] };
    presets[`dsPreset_${A.id}`] = A;
    presets[`dsPreset_${B.id}`] = B;
    await chrome.storage.local.set(presets);
    await chrome.storage.sync.set(presets);
    const chatMap = {};
    chatMap[X] = A.id;
    chatMap[Y] = B.id;
    await writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [chatMap]);
}

/** 依對話標題列快照建立一個標題列並放進 body，回傳該元素。 */
function appendHeader() {
    const holder = document.createElement('div');
    holder.innerHTML = HEADER_HTML;
    return document.body.appendChild(holder.firstElementChild);
}

let cs;
let addedListeners;
let originalAddListener;
let createdObservers;

/** 只在 observe() 期間代替 WeakRef 的強參考。 */
class StrongRef { constructor(value) { this.value = value; } deref() { return this.value; } }

/** 真實 MutationObserver 的子類別：observe() 期間以強參考代替 WeakRef，如同瀏覽器在節點仍被觀察時保留觀察器；並記錄每個觀察器供 afterEach 中斷。 */
function installRetainingMutationObserver() {
    createdObservers = [];
    const RealMutationObserver = globalThis.MutationObserver;
    class RetainingMutationObserver extends RealMutationObserver {
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
    vi.stubGlobal('MutationObserver', RetainingMutationObserver);
}

/** 在 CHAT_X 上全新載入 content-script.js，並等到初始化可觀察地完成。 */
async function loadContentScriptOnChatX() {
    setPathname(CHAT_X);
    vi.resetModules();
    cs = (await import('../../content/content-script.js')).default;
    await waitForContentScriptInit(cs);
    return cs;
}

beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installRetainingMutationObserver();
    // 記錄本實例註冊的 onMessage 監聽，供 afterEach 移除。
    addedListeners = [];
    originalAddListener = chrome.runtime.onMessage.addListener;
    chrome.runtime.onMessage.addListener = (fn) => { addedListeners.push(fn); originalAddListener(fn); };
    cs = null;
    await seed();
});

afterEach(() => {
    createdObservers.forEach((observer) => observer.disconnect());
    if (cs) {
        // 停用本實例的 document 層注入監聽、卸載覆蓋層，並讓尚未觸發的去抖動重掛變成 no-op。
        Object.assign(cs.state, { isEnabled: false, isInjecting: true });
        clearTimeout(cs.state.awaitingNewChatUuidTimer);
        cs.PresetOverlay.unmount();
        cs.PresetOverlay.scheduleFindAndMount = () => {};
        cs.PresetOverlay.findAndMount = () => {};
    }
    chrome.runtime.onMessage.addListener = originalAddListener;
    addedListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setPathname('/');
});

describe('content-script: a page body mutation after init drives SPA navigation detection', () => {
    it('after the host page pushes another chat URL (no popstate), a body mutation applies that chat\'s bound preset', async () => {
        appendHeader();
        await loadContentScriptOnChatX();
        expect(cs.state.currentChatUuid, 'precondition: init handled the chat in the page URL').toBe(X);
        expect(cs.state.promptPrefix, 'precondition: init applied the preset bound to the opening chat').toBe(A.content);

        // DeepSeek 以頁面自己的 pushState 換對話：不送 popstate，content script 只能從之後的 DOM 變動得知。
        window.history.pushState({}, '', CHAT_Y);
        document.body.appendChild(document.createElement('div'));

        await pollUntil(() => cs.state.currentChatUuid === Y && cs.state.promptPrefix === B.content);
        expect(cs.state.currentChatUuid, 'a body mutation after a pushState navigation makes the content script detect the new chat').toBe(Y);
        expect(cs.state.promptPrefix, 'the newly opened chat\'s bound preset is applied after the body mutation').toBe(B.content);
    });
});

describe('content-script: a page body mutation after init re-mounts the preset overlay', () => {
    it('when React replaces the chat title bar, the overlay is mounted into the new title bar', async () => {
        const oldHeader = appendHeader();
        await loadContentScriptOnChatX();
        expect(cs.PresetOverlay.wrapperEl, 'precondition: init mounted the overlay').toBeTruthy();
        expect(oldHeader.contains(cs.PresetOverlay.wrapperEl), 'precondition: init mounted the overlay into the title bar on the page').toBe(true);

        // React 重繪：舊標題列被移除，換上一個新的標題列元素。
        oldHeader.remove();
        const newHeader = appendHeader();

        await pollUntil(() => newHeader.contains(cs.PresetOverlay.wrapperEl));
        expect(newHeader.contains(cs.PresetOverlay.wrapperEl), 'after the title bar is replaced, the body mutation re-mounts the overlay into the new title bar').toBe(true);
    });
});
