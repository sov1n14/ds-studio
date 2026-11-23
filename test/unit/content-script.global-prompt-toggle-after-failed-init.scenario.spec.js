/**
 * 情境（content script 接線）：content script 初始化在讀到任何設定之前就中止，之後使用者關閉裝置層級的全域提示開關；下一則送出不得再帶全域提示。
 *
 * 需求：docs/FEATURES.md「Global Prompt」（未選群組時開關回退到裝置層級狀態）與 docs/ARCHITECTURE.md「Global prompt toggle subordination」（globalPromptEnabled 變更時重算，使注入結果跟著開關走）；初始化中途失敗後送達的設定變更廣播仍必須生效（docs/spec/01-prompt-system.md：設定即時套用到已開啟的頁面）。
 *
 * 為何讓初始化在讀設定前中止：此時頁面尚未持有任何設定快照，開關變更是初始化失敗後第一個要求重算全域提示生效值的廣播；這個廣播必須照樣讓送出依新開關決定，且不得讓設定變更處理失敗。
 *
 * 只模擬信任邊界：記憶體版 chrome.storage（真實 Chrome onChanged 語意）、SW 設定轉送（relaySettingsChanged）、chrome.storage.onChanged.addListener 的同步拋錯與 navigator（裝置設定檔）；所有 content 模組與 StorageManager 皆為真實模組。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import { setPathname } from '../helpers/set-pathname.js';
import { relaySettingsChanged, silenceUnchangedWrites } from '../helpers/chrome-storage-change-events.js';

const KEYS = StorageManager.KEYS;
const GLOBAL_PROMPT = 'GLOBAL-INSTRUCTION';
// 非觸控 Windows 桌機上的真實 Edge，Enter 走桌面送出路徑。
const DESKTOP = { maxTouchPoints: 0, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0' };
const SETTINGS_CHANGE_FAILURE_LOG = '[DSS] content-script 設定變更處理失敗';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 輪詢至條件成立或逾時；不拋錯，由呼叫端的斷言判定結果。 */
async function pollUntil(condition, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) await wait(5);
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

/** 聚焦一個內容為 `text` 的頁面 textarea、如使用者送出般按下 Enter，再移除它；回傳的元素保留送出的值。 */
function pressEnter(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    ta.remove();
    return ta;
}

const settingsChangeFailures = () => console.error.mock.calls.filter((args) => String(args[0]).includes(SETTINGS_CHANGE_FAILURE_LOG));

describe('content-script: a device-level global prompt toggle after init failed before reading any settings', () => {
    let cs;
    let addedListeners;
    let failure;
    let restoreNotify;

    beforeEach(async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.entries(DESKTOP).forEach(([key, value]) => Object.defineProperty(navigator, key, { configurable: true, get: () => value }));
        restoreNotify = silenceUnchangedWrites();
        chrome.storage.onChanged.addListener(relaySettingsChanged);
        // 真實頁面每次載入都是全新的 dsI18n；重設後初始化才會像新頁面一樣註冊它的 storage 監聽。
        globalThis.dsI18n._reset();
        // 頁面載入時總開關關閉、全域提示開關開啟，尚未有全域提示內容。
        await chrome.storage.local.set({ [KEYS.IS_ENABLED]: false, [KEYS.GLOBAL_PROMPT_ENABLED]: true });
        addedListeners = [];
        cs = null;
    });

    afterEach(() => {
        if (cs) Object.assign(cs.state, { isEnabled: false, isInjecting: true });
        failure?.restore();
        addedListeners.forEach((fn) => chrome.runtime.onMessage.removeListener(fn));
        chrome.storage.onChanged.removeListener(relaySettingsChanged);
        restoreNotify();
        globalThis.dsI18n._reset();
        Object.keys(DESKTOP).forEach((key) => delete navigator[key]);
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        setPathname('/');
    });

    it('turning the device-level global prompt off removes the global prompt from the next send', async () => {
        failure = throwOnStorageListenerRegistration(globalThis.dsI18n._handleStorageChanged);
        setPathname('/a/chat/s');
        const event = chrome.runtime.onMessage;
        const originalAdd = event.addListener;
        event.addListener = (fn) => { addedListeners.push(fn); originalAdd(fn); };
        try {
            vi.resetModules();
            cs = (await import('../../content/content-script.js')).default;
        } finally {
            event.addListener = originalAdd;
        }
        await pollUntil(() => failure.hits > 0);
        expect(failure.hits, 'precondition: init aborted at the throwing listener registration, before it read any settings').toBeGreaterThan(0);

        // 使用者在 popup 開啟總開關，並在編輯器存入全域提示。
        await chrome.storage.local.set({ [KEYS.IS_ENABLED]: true });
        await chrome.storage.local.set({ [KEYS.GLOBAL_DEFAULT_PROMPT]: GLOBAL_PROMPT });
        await pollUntil(() => cs.state.isEnabled === true && cs.state.globalDefaultPrompt === GLOBAL_PROMPT);
        expect(pressEnter('before the toggle').value, 'precondition: with the device-level global prompt on, a send carries the global prompt').toContain(GLOBAL_PROMPT);

        // 沒有作用中群組的 popup 關閉裝置層級全域提示開關，如 popup.toggles.js 所做。
        await StorageManager.saveGlobalPromptEnabled(false);
        await pollUntil(() => cs.state.isGlobalPromptEnabled === false || settingsChangeFailures().length > 0);
        await wait(50);

        expect(pressEnter('after the toggle').value, 'the device-level global prompt was turned off and no group is shown, so the next send must not carry the global prompt').not.toContain(GLOBAL_PROMPT);
        expect(settingsChangeFailures(), 'the global prompt toggle broadcast is applied without a settings-change failure').toEqual([]);
    });
});
