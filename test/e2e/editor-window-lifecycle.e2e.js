import { test, expect } from './fixtures.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { evaluateInWorker, listWindows } from './helpers/extension.js';
import { expectNoPageWithin, expectPageStaysOpenWithin } from './helpers/observation.js';
import {
    closeExtensionPages, listEditorWindows, openEditorWith, openPopup, openPopupGroupList, pickGroupInPopup, popupGroupRow,
} from './helpers/popup.js';
import { createTestPreset, seedOnlyPresets } from './helpers/presets.js';
import { inNewHomeTab } from './helpers/prompt-capture.js';
import { readBothAreas } from './helpers/settings.js';

// 提示詞群組編輯器視窗的生命週期：開啟時的焦點、鉛筆按鈕的單例規則、切回 DeepSeek 分頁時的自動關閉與關閉前存檔、重複名稱時視窗保持開啟。
// 依據 docs/FEATURES.md:49、docs/spec/01-prompt-system.md:12 與 :22、docs/spec/02-popup-ui.md:11、docs/architecture/POPUP.md:15、:317 與 :333。
// 本檔不送出任何對話；需要 DeepSeek 分頁的測試只開新的首頁分頁，且不輸入、不送出。每個寫入的儲存鍵都在測試後還原。

const EDITOR_PATH = '/popup/editor/editor.html';
const DEEPSEEK_HOST = new URL(DEEPSEEK_ORIGIN).host;

// 「不會發生」的觀察窗：涵蓋編輯器回覆存檔請求的上限（docs/spec/01-prompt-system.md:22 的 1 秒）再加上餘裕。
const NO_SECOND_WINDOW_MS = 2_000;
const STAYS_OPEN_MS = 3_000;

// 觸發 DeepSeek 分頁的 focus 事件。實測依序試過三種方式，只有第三種有效：
// page.bringToFront() 與 chrome.windows.update(id, { focused: true }) 都讓主視窗取得作業系統焦點（chrome.windows.getAll 回報 focused: true），編輯器視窗卻沒有關閉；
// 原因是 Playwright 對每個頁面啟用焦點模擬，頁面不再收到真實視窗焦點變化產生的 focus 事件。docs/architecture/POPUP.md:333 寫明自動關閉由頁面的 focus 事件驅動，所以直接在頁面 window 上派發 focus 事件。
async function focusDeepSeekPage(page) {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

// 讀取編輯器目前的焦點元素與選取範圍，用來判斷游標是否收合（沒有選取任何文字）。
function readFocusState(editor) {
    return editor.evaluate(() => {
        const active = document.activeElement;
        return { id: active?.id ?? '', selectionStart: active?.selectionStart, selectionEnd: active?.selectionEnd, valueLength: active?.value?.length };
    });
}

// 在彈出視窗挑選群組後收起下拉清單，讓鉛筆按鈕不被清單面板蓋住。
async function pickGroupAndCloseList(popup, name) {
    await pickGroupInPopup(popup, name);
    await popup.keyboard.press('Escape');
    await expect(popup.locator('#presetSelectPanel'), 'the popup group list closes after picking (precondition)').toBeHidden();
}

test.describe('prompt group editor window lifecycle', () => {
    test.beforeEach(async ({ settings }) => {
        await settings.set({ isEnabled: true });
    });

    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    // docs/FEATURES.md:49「name input ... auto-focused with its text left unselected ... the caret sits at the end of the existing name, so typing appends instead of replacing it」
    // docs/spec/01-prompt-system.md:12「focused but not fully selected ... cursor placed at the end of the name」；docs/architecture/POPUP.md:15「a focused name input ... whose text is not selected」
    test('opening the editor from the pencil focuses the name field with a collapsed caret at the end, so typing appends to the name', async ({ context, settings, extensionId }) => {
        const group = createTestPreset('lifecycle-caret');
        const suffix = ' appended';
        await seedOnlyPresets(settings, context, [group]);

        const popup = await openPopup(context, extensionId);
        await pickGroupAndCloseList(popup, group.name);
        const editor = await openEditorWith(context, popup.locator('#editPresetBtn'));
        const nameInput = editor.locator('#editorNameInput');
        await expect(nameInput, 'the editor shows the picked group name (precondition)').toHaveValue(group.name);
        await expect(nameInput, 'the name field has focus when the editor opens').toBeFocused();

        const focus = await readFocusState(editor);
        expect(focus.selectionStart, 'no text is selected: the selection is collapsed to a caret').toBe(focus.selectionEnd);
        expect(focus.selectionEnd, 'the caret sits at the end of the existing name').toBe(group.name.length);

        // 以鍵盤在游標處輸入：若名稱被全選，輸入會取代整個名稱而不是接在後面。
        await editor.keyboard.type(suffix);
        await expect(nameInput, 'typing right after opening appends to the existing name').toHaveValue(group.name + suffix);
        // 等自動存檔把新名稱寫入並經 live-sync 反映到彈出視窗，避免存檔在測試結束、儲存還原之後才落地。
        await openPopupGroupList(popup);
        await expect(popupGroupRow(popup, group.name + suffix), 'the appended name is auto-saved and listed in the popup').toHaveCount(1);
    });

    // docs/FEATURES.md:49「repeatedly clicking the pencil button focuses the existing editor window, and switches it to the requested prompt group when that differs from the one shown」
    // docs/spec/01-prompt-system.md:12「the same prompt group only focuses the window, and a different one navigates it」；:22「Each target type is a singleton ... the same URL only focuses the window, a different URL switches to the currently active prompt group」
    // docs/architecture/POPUP.md:317「re-clicking the same group focuses without reloading」
    test('clicking the pencil again refocuses the one open editor window, and after picking another group navigates that same window to it', async ({ context, settings, extensionId }) => {
        const first = createTestPreset('lifecycle-first');
        const second = createTestPreset('lifecycle-second');
        await seedOnlyPresets(settings, context, [first, second]);

        const popup = await openPopup(context, extensionId);
        const pencil = popup.locator('#editPresetBtn');
        await pickGroupAndCloseList(popup, first.name);
        const editor = await openEditorWith(context, pencil);
        const opened = await listEditorWindows(context);
        expect(opened, 'one editor window is open after the first pencil click (precondition)').toHaveLength(1);
        const editorWindowId = opened[0].id;

        // 在編輯器文件上留下標記：視窗若重新載入，標記會消失。
        await editor.evaluate(() => { window.__dssE2eSameDocument = true; });
        // 先把焦點移到彈出視窗所在的一般視窗，「重新聚焦」才看得出來；本測試沒有 DeepSeek 分頁，焦點移動不會觸發自動關閉。
        const popupWindow = (await listWindows(context)).find((win) => win.type === 'normal' && win.tabUrls.some((url) => url.includes('/popup/popup.html')));
        await evaluateInWorker(context, (id) => chrome.windows.update(id, { focused: true }), popupWindow.id);
        await expect.poll(async () => (await listEditorWindows(context))[0]?.focused, { message: 'the editor window has lost focus before the second click (precondition)' }).toBe(false);

        const noSecondWindow = expectNoPageWithin(context, EDITOR_PATH, NO_SECOND_WINDOW_MS, 'clicking the pencil for the same group opens no second editor window');
        await pencil.click();
        await noSecondWindow;
        await expect.poll(() => listEditorWindows(context), { message: 'the same single editor window is focused again' }).toEqual([expect.objectContaining({ id: editorWindowId, focused: true })]);
        expect(await editor.evaluate(() => window.__dssE2eSameDocument === true), 'refocusing the same group does not reload the editor').toBe(true);

        await pickGroupAndCloseList(popup, second.name);
        const noWindowForSecond = expectNoPageWithin(context, EDITOR_PATH, NO_SECOND_WINDOW_MS, 'clicking the pencil for another group opens no second editor window');
        await pencil.click();
        await noWindowForSecond;
        await expect(editor.locator('#editorNameInput'), 'the same editor window now shows the newly picked group').toHaveValue(second.name);
        await expect.poll(() => listEditorWindows(context), { message: 'the navigated editor is still the one and only editor window' }).toEqual([expect.objectContaining({ id: editorWindowId })]);
    });

    // docs/FEATURES.md:49「Switching back to the DeepSeek tab also closes any open editor window automatically ... the switch back to the DeepSeek tab ... also save[s] unsaved content first, waiting up to 1 s」
    // docs/spec/01-prompt-system.md:22「so text typed within the 500 ms debounce is written before the window closes」；docs/architecture/POPUP.md:333「only then calls chrome.windows.remove()」
    test('focusing a DeepSeek tab closes the editor window and the edit typed just before is saved by the time it closes', async ({ context, settings, extensionId }) => {
        const group = createTestPreset('lifecycle-autoclose');
        const renamed = group.name + ' renamed';
        const content = 'E2E-AUTOCLOSE-CONTENT-' + Date.now();
        await seedOnlyPresets(settings, context, [group]);

        await inNewHomeTab(context, async (home) => {
            const popup = await openPopup(context, extensionId, { activeTabUrlPart: DEEPSEEK_HOST });
            await pickGroupAndCloseList(popup, group.name);
            const editor = await openEditorWith(context, popup.locator('#editPresetBtn'));
            await expect(editor.locator('#editorNameInput'), 'the editor shows the picked group name (precondition)').toHaveValue(group.name);

            // 名稱最後輸入且不讓輸入框失焦，觸發 focus 時它仍在 500 ms 防抖內、尚未存檔。
            await editor.locator('#editorTextarea').fill(content);
            await editor.locator('#editorNameInput').fill(renamed);
            const closed = editor.waitForEvent('close');
            await focusDeepSeekPage(home);
            await closed;

            // 視窗一關閉就讀一次儲存（不輪詢），確認關閉前已存檔，而不是關閉之後才補寫。
            const key = 'dsPreset_' + group.id;
            const stored = await readBothAreas(context, [key]);
            expect(stored.sync[key], 'the synced copy holds the name and content typed just before the close').toMatchObject({ name: renamed, content });
            expect(stored.local[key], 'the local copy holds the name and content typed just before the close').toMatchObject({ name: renamed, content });
            expect(await listEditorWindows(context), 'no editor window is left open').toEqual([]);

            await openPopupGroupList(popup);
            await expect(popupGroupRow(popup, renamed), 'the popup lists the group under the name saved at close').toHaveCount(1);
        });
    });

    // docs/FEATURES.md:49「a name that duplicates another group keeps the window open (behind the DeepSeek page, not raised) with the error shown」
    // docs/spec/01-prompt-system.md:22「When the save fails because the name duplicates another group, the window is neither closed nor navigated: it keeps the original group and the duplicate-name error」；docs/architecture/POPUP.md:333
    // 「不被拉到前面」無法在此驗證：派發的 focus 事件不改變作業系統焦點，視窗前後順序在此不可觀察。
    test('a duplicate group name keeps the editor window open when a DeepSeek tab gets focus, and the duplicate is not saved', async ({ context, settings, extensionId }) => {
        const edited = createTestPreset('lifecycle-edited');
        const other = createTestPreset('lifecycle-other');
        await seedOnlyPresets(settings, context, [edited, other]);

        await inNewHomeTab(context, async (home) => {
            const popup = await openPopup(context, extensionId, { activeTabUrlPart: DEEPSEEK_HOST });
            await pickGroupAndCloseList(popup, edited.name);
            const editor = await openEditorWith(context, popup.locator('#editPresetBtn'));
            const nameInput = editor.locator('#editorNameInput');
            await expect(nameInput, 'the editor shows the picked group name (precondition)').toHaveValue(edited.name);
            const [editorWindow] = await listEditorWindows(context);

            await nameInput.fill(other.name);
            await focusDeepSeekPage(home);
            await expectPageStaysOpenWithin(editor, STAYS_OPEN_MS, 'a duplicate name keeps the editor window open after the DeepSeek tab gets focus');

            expect(await listEditorWindows(context), 'the same editor window is still open').toEqual([expect.objectContaining({ id: editorWindow.id, url: editorWindow.url })]);
            await expect(nameInput, 'the window keeps the typed name for the user to fix').toHaveValue(other.name);
            const status = editor.locator('#editorSaveStatus');
            await expect(status, 'the save status shows the duplicate-name error').toHaveClass(/save-status--error/);
            await expect(status, 'the duplicate-name error is visible').toBeVisible();

            const keys = ['dsPreset_' + edited.id, 'dsPreset_' + other.id];
            const stored = await readBothAreas(context, keys);
            for (const area of ['sync', 'local']) {
                expect(stored[area][keys[0]]?.name, 'the edited group keeps its original name in ' + area).toBe(edited.name);
                expect(stored[area][keys[1]]?.name, 'the other group keeps its name in ' + area).toBe(other.name);
            }
        });
    });
});
