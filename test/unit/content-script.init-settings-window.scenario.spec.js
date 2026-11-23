/**
 * 情境（content-script 初始化視窗）：content script 仍在初始化時送達的設定變更廣播（DSS_SETTINGS_CHANGED），必須在初始化完成後生效。
 *
 * 需求：使用者在 popup 關閉總開關（只寫入 chrome.storage.local 的 isEnabled），背景以 DSS_SETTINGS_CHANGED 廣播；不論這筆寫入落在初始化的哪個時間點，初始化完成後 content script 的狀態都必須是關閉，覆蓋層也必須隱藏，不需重新載入頁面。
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed() {
    // isEnabled 只存在 local（與 popup 的寫入位置一致）；群組與聊天綁定兩區都放，讓同步流程不改動任何設定。
    await chrome.storage.local.set({ [IS_ENABLED]: true, globalPromptEnabled: false });
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

describe('content-script: a master-switch-off broadcast during init takes effect once init completes', () => {
    let restoreNotify;
    let originalAddListener;

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
