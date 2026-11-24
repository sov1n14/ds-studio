/**
 * 情境（content-script 初始化視窗）：content script 仍在初始化時送達的設定變更廣播（DSS_SETTINGS_CHANGED），必須在初始化完成後生效。
 *
 * 需求：使用者在 popup 關閉總開關（只寫入 chrome.storage.local 的 isEnabled），背景以 DSS_SETTINGS_CHANGED 廣播；不論這筆寫入落在初始化的哪個時間點，初始化完成後 content script 的狀態都必須是關閉，覆蓋層也必須隱藏，不需重新載入頁面。
 *
 * 需求（初始化中途失敗）：初始化開始後因信任邊界失敗而中止（chrome.storage 寫入回報 lastError、chrome.storage.onChanged.addListener 同步拋錯）時，之後送達的設定變更廣播仍必須生效，不得永久暫存。可觀察效果取自 docs/spec/01-prompt-system.md：全域提示詞的編輯即時套用到已開啟的頁面。
 *
 * 每個測試自行載入 content-script.js：初始化只在載入時跑一次，靜態匯入會讓初始化在測試注入寫入之前就跑完。afterEach 讓前一個實例失效（移除訊息監聽、卸載覆蓋層），因為新載入會留下它們。
 *
 * 只模擬信任邊界：記憶體內 chrome.storage（真實 Chrome 的 onChanged 語意）、SW 的設定轉播（relaySettingsChanged）。所有 content 模組與 StorageManager 都是真的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import { writeChatMapLayout } from '../helpers/chat-map-writer-harness.js';
import { relaySettingsChanged, silenceUnchangedWrites } from '../helpers/chrome-storage-change-events.js';

const HEADER_HTML = fs.readFileSync(path.resolve(__dirname, '../fixtures/ds-snapshots/conversation-header.html'), 'utf8');
const X = 'aaaaaaaa-1111-1111-1111-111111111111';
const CHAT_X = `/a/chat/s/${X}`;
const A = { id: 'preset-A', name: 'preset-A', content: 'PREFIX-A', createdAt: 1, updatedAt: 1 };
const IS_ENABLED = StorageManager.KEYS.IS_ENABLED;
const SYNC_INITIALIZED = StorageManager.KEYS.SYNC_INITIALIZED;
const A_REMOTE_CONTENT = 'PREFIX-A-REMOTE';

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

const listsIsEnabled = (keys) => (Array.isArray(keys) ? keys.includes(IS_ENABLED) : keys === IS_ENABLED || (keys !== null && typeof keys === 'object' && IS_ENABLED in keys));

/** popup 關閉總開關時的寫入：只寫 chrome.storage.local。 */
const switchMasterOff = () => chrome.storage.local.set({ [IS_ENABLED]: false });

/**
 * 包住兩個 storage 區的 get：記錄進行中的讀取數（判斷初始化是否已靜止），並在第一筆符合 `isTarget(keys, stack)` 的讀取送達後的下一個 tick 關閉總開關。
 * 送達前不動作，所以寫入一定落在該次讀取取得快照之後。
 */
function instrumentReads(isTarget = () => false) {
    const probe = { inFlight: 0, isTargetHit: false, isWriteCommitted: false };
    const areas = [chrome.storage.local, chrome.storage.sync];
    const originals = areas.map((area) => area.get);
    areas.forEach((area, i) => {
        area.get = function (keys, callback) {
            if (typeof keys === 'function') { callback = keys; keys = null; }
            const isThisTarget = !probe.isTargetHit && isTarget(keys, new Error().stack ?? '');
            if (isThisTarget) probe.isTargetHit = true;
            probe.inFlight++;
            const onDelivered = () => {
                probe.inFlight--;
                // 下一個 tick 才寫入：呼叫端先處理完這次讀取的結果。
                if (isThisTarget) setTimeout(() => { switchMasterOff().then(() => { probe.isWriteCommitted = true; }); }, 0);
            };
            if (callback) return originals[i].call(this, keys, (result) => { onDelivered(); callback(result); });
            const pending = originals[i].call(this, keys);
            pending.then(onDelivered, onDelivered);
            return pending;
        };
    });
    probe.restore = () => areas.forEach((area, i) => { area.get = originals[i]; });
    return probe;
}

let cs;
let addedListeners;
let probe;

/**
 * 等到初始化可觀察地完成：設定監聽已註冊、覆蓋層已掛上、沒有進行中的 storage 讀取、`extra()` 成立，且這些條件連續維持 150ms。
 * 以條件輪詢取代固定等待；超過 3 秒仍未靜止就拋錯，標示為環境問題而非斷言失敗。
 */
async function waitForInitSettled(extra = () => true) {
    const deadline = Date.now() + 3000;
    let quietSince = null;
    while (Date.now() < deadline) {
        const isQuiet = addedListeners.length >= 2 && Boolean(cs?.PresetOverlay?.wrapperEl) && probe.inFlight === 0 && extra();
        if (!isQuiet) quietSince = null;
        else if (quietSince === null) quietSince = Date.now();
        else if (Date.now() - quietSince >= 150) return;
        await wait(5);
    }
    throw new Error(`Setup: content-script.js init did not settle within 3s (listeners=${addedListeners.length}, overlay mounted=${Boolean(cs?.PresetOverlay?.wrapperEl)}, reads in flight=${probe.inFlight}, extra=${extra()}).`);
}

/** 在 CHAT_X 上全新載入 content-script.js；載入本身不等待也不動作，注入的寫入由 instrumentReads 的讀取掛鉤觸發。 */
async function loadContentScript() {
    setPathname(CHAT_X);
    vi.resetModules();
    cs = (await import('../../content/content-script.js')).default;
    return cs;
}

let restoreNotify;
let originalAddListener;

/** 每個測試全新載入 content-script.js 所需的前置與清理；兩個 describe 共用。 */
function useFreshContentScriptLoad() {
    beforeEach(async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        restoreNotify = silenceUnchangedWrites();
        chrome.storage.onChanged.addListener(relaySettingsChanged);
        // 記錄本實例註冊的 onMessage 監聽，供 afterEach 移除。
        addedListeners = [];
        originalAddListener = chrome.runtime.onMessage.addListener;
        chrome.runtime.onMessage.addListener = (fn) => { addedListeners.push(fn); originalAddListener(fn); };
        cs = null;
        probe = null;
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
        probe?.restore();
        chrome.runtime.onMessage.addListener = originalAddListener;
        addedListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
        chrome.storage.onChanged.removeListener(relaySettingsChanged);
        restoreNotify();
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        setPathname('/');
    });
}

describe('content-script: a master-switch-off broadcast during init takes effect once init completes', () => {
    useFreshContentScriptLoad();

    async function expectMasterSwitchOffApplied() {
        const stored = await chrome.storage.local.get(IS_ENABLED);
        expect(stored[IS_ENABLED], 'precondition: the master-switch-off write is committed to chrome.storage.local').toBe(false);
        expect.soft(cs.state.isEnabled, 'after init completes, the content script state follows the stored master switch (off)').toBe(false);
        expect.soft(cs.PresetOverlay.wrapperEl.style.display, 'after init completes, the overlay is hidden because the master switch is off').toBe('none');
    }

    it('a switch-off committed right after init reads its settings snapshot is applied once init completes', async () => {
        // 初始化讀取設定快照（列出 isEnabled 的那次讀取）送達後，下一個 tick 關閉總開關。
        probe = instrumentReads((keys) => listsIsEnabled(keys));
        await loadContentScript();
        await waitForInitSettled(() => probe.isWriteCommitted);

        expect(probe.isTargetHit, 'precondition: init read a settings snapshot that lists isEnabled').toBe(true);
        await expectMasterSwitchOffApplied();
    });

    it('a switch-off committed while init runs handleChatChange is applied once init completes', async () => {
        // handleChatChange 自己的設定讀取送達後，下一個 tick 關閉總開關，寫入落在 handleChatChange 執行期間。
        probe = instrumentReads((keys, stack) => listsIsEnabled(keys) && stack.includes('handleChatChange'));
        await loadContentScript();
        await waitForInitSettled(() => probe.isWriteCommitted);

        expect(probe.isTargetHit, 'precondition: init ran handleChatChange, which read the settings').toBe(true);
        await expectMasterSwitchOffApplied();
    });

    it('control: a switch-off committed after init completes is applied', async () => {
        probe = instrumentReads();
        await loadContentScript();
        await waitForInitSettled();
        expect(cs.state.isEnabled, 'precondition: init completes with the master switch on').toBe(true);
        expect(cs.PresetOverlay.wrapperEl.style.display, 'precondition: the overlay is visible with the master switch on').toBe('');

        await switchMasterOff();
        await waitForInitSettled();

        await expectMasterSwitchOffApplied();
    });
});

const GLOBAL_DEFAULT_PROMPT = StorageManager.KEYS.GLOBAL_DEFAULT_PROMPT;
const EDITED_GLOBAL_PROMPT = 'GLOBAL-EDITED-AFTER-INIT';

/** 編輯器視窗儲存全域提示詞時的寫入：寫入 chrome.storage.local，經 relaySettingsChanged 以 DSS_SETTINGS_CHANGED 送達。 */
const editGlobalPrompt = () => chrome.storage.local.set({ [GLOBAL_DEFAULT_PROMPT]: EDITED_GLOBAL_PROMPT });

/**
 * 讓 chrome.storage.local.set 對含 `key` 的寫入失敗且不存入資料，如同真實 Chrome 的配額失敗：callback 形式只在該次 callback 執行期間設定 chrome.runtime.lastError，promise 形式直接 reject。
 * 回傳 { hits, failedItems, restore }；hits 記錄失敗次數、failedItems 記錄每次失敗寫入的內容，供前置條件確認注入的失敗確實發生在預期的寫入上。
 */
function failLocalWritesOf(key) {
    const area = chrome.storage.local;
    const original = area.set;
    const failure = { hits: 0, failedItems: [] };
    area.set = function (items, callback) {
        if (!(items && key in items)) return original.call(this, items, callback);
        failure.hits++;
        failure.failedItems.push(structuredClone(items));
        const message = 'QUOTA_BYTES quota exceeded';
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

/** 讓 chrome.storage.onChanged.addListener 註冊 `listener` 時同步拋錯；其他註冊照常。回傳 { hits, restore }。 */
function throwOnStorageListenerRegistration(listener) {
    const original = chrome.storage.onChanged.addListener;
    const failure = { hits: 0 };
    chrome.storage.onChanged.addListener = (fn) => {
        if (fn === listener) {
            failure.hits++;
            throw new Error('chrome.storage.onChanged.addListener failed');
        }
        return original(fn);
    };
    failure.restore = () => { chrome.storage.onChanged.addListener = original; };
    return failure;
}

/** 等到注入的失敗已發生、沒有進行中的 storage 讀取，且連續維持 150ms（初始化已中止並靜止）；超過 3 秒拋出 Setup 錯誤。 */
async function waitForFailedInitSettled(failure) {
    const deadline = Date.now() + 3000;
    let quietSince = null;
    while (Date.now() < deadline) {
        const isQuiet = failure.hits > 0 && probe.inFlight === 0;
        if (!isQuiet) quietSince = null;
        else if (quietSince === null) quietSince = Date.now();
        else if (Date.now() - quietSince >= 150) return;
        await wait(5);
    }
    throw new Error(`Setup: the injected init failure did not settle within 3s (failure hits=${failure.hits}, reads in flight=${probe.inFlight}).`);
}

/** 輪詢至條件成立或逾時；不拋錯，由呼叫端的斷言判定結果。 */
async function pollUntil(condition, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) await wait(5);
}

describe('content-script: a settings broadcast after init failed partway takes effect', () => {
    useFreshContentScriptLoad();
    let failure;

    beforeEach(() => {
        // 真實頁面每次載入都是全新的 dsI18n；重設後初始化才會像新頁面一樣註冊它的 storage 監聽。
        globalThis.dsI18n._reset();
        failure = null;
    });

    afterEach(() => {
        failure?.restore();
        globalThis.dsI18n._reset();
    });

    async function expectGlobalPromptEditApplied() {
        expect(cs.state.globalDefaultPrompt, 'precondition: the page does not hold the edited global prompt before the edit').not.toBe(EDITED_GLOBAL_PROMPT);
        await editGlobalPrompt();
        const stored = await chrome.storage.local.get(GLOBAL_DEFAULT_PROMPT);
        expect(stored[GLOBAL_DEFAULT_PROMPT], 'precondition: the global prompt edit is committed to chrome.storage.local').toBe(EDITED_GLOBAL_PROMPT);
        await pollUntil(() => cs.state.globalDefaultPrompt === EDITED_GLOBAL_PROMPT);
        expect(cs.state.globalDefaultPrompt, 'a global prompt edit broadcast after init settled replaces the page global prompt instead of being buffered forever').toBe(EDITED_GLOBAL_PROMPT);
    }

    it('init aborted by a rejected storage write (chrome.storage.local.set reports lastError): a later global prompt edit is applied', async () => {
        // 已同步過的裝置上，雲端的 preset-A 較新：初始化讀取設定時會把雲端版回寫本機，而這筆本機寫入失敗。
        await chrome.storage.sync.set({ [`dsPreset_${A.id}`]: { ...A, content: A_REMOTE_CONTENT, updatedAt: 2 } });
        failure = failLocalWritesOf(`dsPreset_${A.id}`);
        probe = instrumentReads();
        await loadContentScript();
        await waitForFailedInitSettled(failure);

        expect(failure.hits, 'precondition: init attempted the failing local write').toBeGreaterThan(0);
        const failedContents = failure.failedItems.map((items) => items[`dsPreset_${A.id}`]?.content);
        expect(failedContents, 'precondition: a failed local write carries the cloud-newer preset-A, i.e. it is a cloud-wins write-back').toContain(A_REMOTE_CONTENT);
        expect(cs.PresetOverlay.wrapperEl, 'precondition: the failure aborted init before it started the overlay').toBeFalsy();
        await expectGlobalPromptEditApplied();
    });

    it('init aborted by a synchronous throw (chrome.storage.onChanged.addListener throws): a later global prompt edit is applied', async () => {
        failure = throwOnStorageListenerRegistration(globalThis.dsI18n._handleStorageChanged);
        probe = instrumentReads();
        await loadContentScript();
        await waitForFailedInitSettled(failure);

        expect(failure.hits, 'precondition: init attempted the throwing listener registration').toBeGreaterThan(0);
        expect(cs.PresetOverlay.wrapperEl, 'precondition: the throw aborted init before it started the overlay').toBeFalsy();
        await expectGlobalPromptEditApplied();
    });

    it('control: with init succeeding, a later global prompt edit is applied', async () => {
        probe = instrumentReads();
        await loadContentScript();
        await waitForInitSettled();

        await expectGlobalPromptEditApplied();
    });
});
