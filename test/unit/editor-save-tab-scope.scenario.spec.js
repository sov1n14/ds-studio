/**
 * 情境：在編輯器視窗儲存提示組內容，只更新內容，不改變任何 DeepSeek 分頁選用的群組。
 *
 * 需求（使用者裁定「拿掉編輯器的廣播」）：編輯器儲存群組 P 之後，開著新對話、自行選了群組 B 的分頁，仍須顯示 B 並在下一則訊息注入 B 的內容；已顯示 P 的分頁則經由儲存變更轉送（chrome.storage.onChanged → DSS_SETTINGS_CHANGED）在下一則訊息注入 P 編輯後的內容。
 *
 * 跨模組可變狀態：編輯器端（popup/editor/editor.storage.js 的 saveContent）寫入儲存；另一個分頁的 content-script.js 據此決定其新對話顯示與注入的群組。編輯器端的腳本組成取自 popup/editor/editor.html 本身：test/setup/vitest.setup.js 前置載入與 test/helpers/editor-window-harness.js 已提供的腳本之外，editor.html 宣告的其餘 <script src> 皆在 saveContent 執行前依宣告順序載入（harness 的 importNewEditorScripts），因此 editor.html 載入哪些 utils/ 包裝（例如分頁訊息工具），編輯器端就有哪些全域；本檔不自行列舉、也不排除任何腳本。頁面進入點 editor.js 不載入，由本檔直接呼叫 saveContent 代替。
 *
 * 分頁配置（test/helpers/fake-chrome-tabs.js 依 active、currentWindow、windowId 與網址樣式誠實過濾）：
 *   - 分頁 A（id 21，視窗 1，作用中）：另一個 DeepSeek 對話；沒有 content-script 實例，只記錄投遞。
 *   - 分頁 B（id 22，視窗 1，非作用中）：真實 content-script 實例（test/helpers/overlay-consistency-harness.js），位於新對話（網址沒有 uuid）。chrome.tabs.sendMessage 僅在 tabId 為 22 時轉給 B 真實的 chrome.runtime.onMessage 監聽器。
 *   - 分頁 C（id 23，視窗 2，作用中）：另一個視窗的 DeepSeek 對話；沒有 content-script 實例。
 * 編輯器視窗本身不是 DeepSeek 分頁，不在分頁表中。
 *
 * 只模擬信任邊界（chrome.tabs、chrome.runtime、chrome.storage）；editor.storage.js 與 editor.html 宣告的其餘腳本、content-script、ChatBinding、PresetOverlay、StorageManager 皆為真實模組。儲存變更轉送由 harness 的 relaySettingsChanged 扮演 service worker。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GLOBAL, preset, settle, shownValue, clickOption, injected, openChat, setUpOverlayScenario } from '../helpers/overlay-consistency-harness.js';
import '../../popup/popup.preset-domain.js';
import { installFakeTabs } from '../helpers/fake-chrome-tabs.js';
import { importNewEditorScripts } from '../helpers/editor-window-harness.js';

const NEW_CHAT = '/a/chat/s';
const TAB_A = 21;
const TAB_B = 22;
const TAB_C = 23;
const B_GROUP = preset('preset-B', 'Bravo', 'PREFIX-B', true);
const P_GROUP = preset('preset-P', 'Papa', 'PREFIX-P', true);
const PRESETS = [B_GROUP, P_GROUP];
const P_EDITED = 'PREFIX-P edited';

/** 只有分頁 B 有真實 content script：送往 22 的訊息交給 B 的 chrome.runtime.onMessage 監聽器，其餘分頁只留下投遞紀錄。 */
function routeToTabB(tabId, message) {
    if (tabId !== TAB_B) return undefined;
    let response;
    chrome.runtime.onMessage.callListeners(message, { id: chrome.runtime.id }, (r) => { response = r; });
    return response;
}

async function seedDeviceSettings() {
    const items = { isEnabled: true, globalPromptEnabled: true, globalDefaultPrompt: GLOBAL };
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set(items);
    await settle();
}

/** B 在新對話中自行從頁內選單選了指定群組。 */
async function tabBPicksInNewChat(id) {
    await openChat(NEW_CHAT, PRESETS, {});
    clickOption(id);
    await settle();
}

/** 擷取 B 目前顯示的群組與下一則訊息會注入的內容，並確認確實是預期群組。 */
function captureTabB(expectedId, expectedPrefix) {
    const before = { shown: shownValue(), injected: injected() };
    expect(before.shown, `precondition: tab B shows ${expectedId}`).toBe(expectedId);
    expect(before.injected, `precondition: tab B's next send injects ${expectedPrefix}`).toContain(expectedPrefix);
    return before;
}

/** 編輯器視窗經真實 saveContent 儲存群組內容；儲存前先載入 editor.html 宣告、尚未載入的腳本，使編輯器端全域與真實視窗一致。 */
async function editorSavesPreset(id, content) {
    await importNewEditorScripts();
    await globalThis.__DS_Editor_storage.saveContent({ type: 'preset', id }, content);
    await settle();
}

/** 讀回兩個儲存區的群組內容，確認編輯器確實寫入（任一區持有編輯後內容即可）。 */
async function storedPresetContents(id) {
    const key = `dsPreset_${id}`;
    const [sync, local] = await Promise.all([chrome.storage.sync.get(key), chrome.storage.local.get(key)]);
    return [sync[key]?.content, local[key]?.content];
}

describe('an editor-window preset save changes no DeepSeek tab\'s chosen group', () => {
    let tearDown;
    let tabs;

    beforeEach(async () => {
        // 採真實 Chrome 的 onChanged 語意：寫入相同值不觸發變更事件。
        tearDown = await setUpOverlayScenario({ isUnchangedWriteSilent: true });
        await seedDeviceSettings();
        tabs = installFakeTabs([
            { id: TAB_A, windowId: 1, active: true, url: 'https://chat.deepseek.com/a/chat/s/aaaaaaaa-0000-0000-0000-000000000001' },
            { id: TAB_B, windowId: 1, active: false, url: 'https://chat.deepseek.com/a/chat/s' },
            { id: TAB_C, windowId: 2, active: true, url: 'https://chat.deepseek.com/a/chat/s/cccccccc-0000-0000-0000-000000000003' },
        ], { route: routeToTabB });
    });

    afterEach(() => {
        const fakeErrors = tabs?.fakeErrors ?? [];
        tabs?.restore();
        tearDown();
        expect(fakeErrors, 'precondition: the code under test uses only query keys the fake knows').toEqual([]);
    });

    it('(1) a new-conversation tab that picked group B keeps showing and injecting B after the editor saves group P', async () => {
        await tabBPicksInNewChat('preset-B');
        const before = captureTabB('preset-B', 'PREFIX-B');

        await editorSavesPreset('preset-P', P_EDITED);

        // 前提：編輯器確實寫入 P 的新內容，否則本案的「不變」毫無意義。
        expect(await storedPresetContents('preset-P'), 'precondition: the editor stored P\'s edited content').toContain(P_EDITED);
        expect(shownValue(), 'after the editor saves P: tab B must still show the group it picked').toBe(before.shown);
        expect(injected(), 'after the editor saves P: tab B\'s next send must inject the same content as before').toBe(before.injected);
    });

    it('(2) a tab already showing group P injects P\'s edited content after the editor saves P', async () => {
        await tabBPicksInNewChat('preset-P');
        captureTabB('preset-P', 'PREFIX-P');

        await editorSavesPreset('preset-P', P_EDITED);

        expect(shownValue(), 'after the editor saves P: tab B still shows P').toBe('preset-P');
        expect(injected(), 'after the editor saves P: tab B\'s next send carries P\'s edited content').toContain(P_EDITED);
    });
});
