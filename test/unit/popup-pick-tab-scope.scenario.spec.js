/**
 * 情境：彈出視窗選取的群組只影響彈出視窗底下的分頁。
 *
 * 需求（使用者裁定）：在彈出視窗選取群組，只作用於彈出視窗底下的 DeepSeek 分頁（目前視窗的作用中分頁）；同時開著的其他 DeepSeek 分頁，其新對話已顯示的群組與將注入的內容都不得改變。開啟彈出視窗本身也不得把彈出視窗底下分頁的狀態（例如沒有群組）推給其他分頁。
 *
 * 跨模組可變狀態：彈出視窗端（popup/popup.js 的 sendActivePresetToContentScript 經 utils/tab-control.js）送出的訊息，會由另一個分頁的 content-script.js 寫入其 pendingPresetId 並重算注入前綴。
 *
 * 分頁配置（test/helpers/fake-chrome-tabs.js 依 active、currentWindow 與網址樣式誠實過濾）：
 *   - 分頁 A（id 11，視窗 1，作用中）：彈出視窗底下的分頁；本測試沒有 A 的 content-script 實例，只記錄 A 收到的投遞。
 *   - 分頁 B（id 12，視窗 1，非作用中）：真實 content-script 實例（test/helpers/overlay-consistency-harness.js），位於新對話。chrome.tabs.sendMessage 僅在 tabId 為 12 時轉給 B 真實的 chrome.runtime.onMessage 監聽器。
 *
 * 只模擬信任邊界（chrome.*）；utils/tab-control.js、彈出視窗送出函式（test/helpers/popup-send-path-harness.js 取自 popup.js 原始碼）、content-script、ChatBinding、PresetOverlay、StorageManager 皆為真實模組。
 *
 * 彈出視窗選取：依 popup.js 選單 onSelect 的順序，先以真實 StorageManager.saveActivePresetId 寫入，再呼叫送出函式；綁定 A 對話的步驟屬於 A，本情境省略。彈出視窗開啟：A 沒有群組時，彈出視窗以空字串作為目前群組並呼叫送出函式。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GLOBAL, preset, settle, shownValue, clickOption, injected, openChat, setUpOverlayScenario } from '../helpers/overlay-consistency-harness.js';
import '../../utils/tab-control.js';
import { installFakeTabs } from '../helpers/fake-chrome-tabs.js';
import { createPopupSendPath } from '../helpers/popup-send-path-harness.js';

const NEW_CHAT = '/a/chat/s';
const TAB_A = 11;
const TAB_B = 12;
const B_GROUP = preset('preset-B', 'Bravo', 'PREFIX-B', true);
const P_GROUP = preset('preset-P', 'Papa', 'PREFIX-P', true);
const PRESETS = [B_GROUP, P_GROUP];

/** 只有分頁 B 有真實 content script：送往 12 的訊息交給 B 的 chrome.runtime.onMessage 監聽器，其餘分頁只留下投遞紀錄。 */
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

/** B 在新對話中自行從頁內選單選了 B 群組。 */
async function tabBPicksItsOwnGroup() {
    await openChat(NEW_CHAT, PRESETS, {});
    clickOption('preset-B');
    await settle();
}

/** B 的新對話由釘選的預設群組帶出 B 群組。 */
async function tabBOpensNewChatWithPinnedDefault() {
    await StorageManager.savePinnedPresetId('preset-B');
    await openChat(NEW_CHAT, PRESETS, {});
}

/** 擷取 B 目前顯示的群組與下一則訊息會注入的內容，並確認確實是 B 群組。 */
function captureTabB() {
    const before = { shown: shownValue(), injected: injected() };
    expect(before.shown, '前提：B 的頁內選單顯示 B 群組').toBe('preset-B');
    expect(before.injected, '前提：B 的下一則訊息會注入 B 群組內容').toContain('PREFIX-B');
    return before;
}

function expectTabBUnchanged(before, when) {
    expect(shownValue(), `${when}：B 顯示的群組不得改變`).toBe(before.shown);
    expect(injected(), `${when}：B 下一則訊息注入的內容不得改變`).toBe(before.injected);
}

describe('a group picked in the popup affects only the DeepSeek tab under the popup', () => {
    let tearDown;
    let tabs;
    let popup;

    beforeEach(async () => {
        // 採真實 Chrome 的 onChanged 語意：寫入相同值不觸發變更事件。
        tearDown = await setUpOverlayScenario({ isUnchangedWriteSilent: true });
        await seedDeviceSettings();
        tabs = installFakeTabs([
            { id: TAB_A, windowId: 1, active: true, url: 'https://chat.deepseek.com/a/chat/s/aaaaaaaa-0000-0000-0000-000000000001' },
            { id: TAB_B, windowId: 1, active: false, url: 'https://chat.deepseek.com/a/chat/s' },
        ], { route: routeToTabB });
        popup = createPopupSendPath({ presets: PRESETS, activePresetId: null });
    });

    afterEach(() => {
        const fakeErrors = tabs?.fakeErrors ?? [];
        tabs?.restore();
        tearDown();
        expect(fakeErrors, '前提：受測程式只用替身認得的查詢條件').toEqual([]);
    });

    /** 彈出視窗在 A 上選取群組：真實儲存寫入後呼叫真實送出函式。 */
    async function popupPicksOverTabA(id) {
        await StorageManager.saveActivePresetId(id);
        await settle();
        popup.state.activePresetId = id;
        popup.send();
        await settle();
    }

    /** 彈出視窗在沒有群組的 A 上開啟：以空字串作為目前群組呼叫真實送出函式。 */
    async function popupOpensOverTabAWithNoGroup() {
        popup.state.activePresetId = '';
        popup.send();
        await settle();
    }

    const deliveriesTo = (tabId) => tabs.deliveries.filter((d) => d.tabId === tabId).map((d) => d.message);

    describe('case a: the popup picks a different group over tab A', () => {
        it('(a1) B keeps the group it picked itself: shown value and injected prefix unchanged', async () => {
            await tabBPicksItsOwnGroup();
            const before = captureTabB();

            await popupPicksOverTabA('preset-P');

            expect(deliveriesTo(TAB_A), '彈出視窗底下的 A 仍須收到所選群組').toContainEqual({ action: 'ACTIVE_PRESET_CHANGED', presetId: 'preset-P', presetContent: 'PREFIX-P' });
            expectTabBUnchanged(before, '彈出視窗在 A 上選 P 之後');
        });

        it('(a2) B keeps its pinned default group: shown value and injected prefix unchanged', async () => {
            await tabBOpensNewChatWithPinnedDefault();
            const before = captureTabB();

            await popupPicksOverTabA('preset-P');

            expect(deliveriesTo(TAB_A), '彈出視窗底下的 A 仍須收到所選群組').toContainEqual({ action: 'ACTIVE_PRESET_CHANGED', presetId: 'preset-P', presetContent: 'PREFIX-P' });
            expectTabBUnchanged(before, '彈出視窗在 A 上選 P 之後');
        });
    });

    describe('case b: the popup opens over tab A, which has no group', () => {
        it('(b1) B still shows and injects its pinned default group, not blanked', async () => {
            await tabBOpensNewChatWithPinnedDefault();
            const before = captureTabB();

            await popupOpensOverTabAWithNoGroup();

            expectTabBUnchanged(before, '彈出視窗在沒有群組的 A 上開啟之後');
        });

        it('(b2) B still shows and injects the group it picked itself, not blanked', async () => {
            await tabBPicksItsOwnGroup();
            const before = captureTabB();

            await popupOpensOverTabAWithNoGroup();

            expectTabBUnchanged(before, '彈出視窗在沒有群組的 A 上開啟之後');
        });
    });
});
