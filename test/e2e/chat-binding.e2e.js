import { test, expect } from './fixtures.js';
import { conversationOtherThan, DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { closeExtensionPages, openPopup, openPopupGroupList, pickGroupInPopup, popupBlankLabel, popupPickedGroup } from './helpers/popup.js';
import { createTestPreset, expectOverlayNeverShows, pickPreset, pickPresetOption, presetOverlay, seedOnlyPreset, seedOnlyPresets } from './helpers/presets.js';
import { documentedPrompt, gotoWithOverlay, openBlockingSends, sendAndCapturePrompt } from './helpers/prompt-capture.js';
import { armReplyStub, expectReplyStreaming, finishAndAwaitToolbar, sendStubbedPrompt } from './helpers/reply-stub.js';

// 對話綁定提示詞群組（docs/FEATURES.md 的 Conversation-Bound Prompt Groups 與 Using Prompt Injection 步驟 4 至 6；docs/spec/01-prompt-system.md 第 4 節；docs/spec/02-popup-ui.md 第 15 節）。
// 綁定僅存在於儲存區：錄製的對話只開啟、從不寫入；除首次送出測試外，每次送出都在瀏覽器內中止，首次送出測試由瀏覽器內替身回覆（helpers/reply-stub.js），沒有任何訊息抵達 DeepSeek。測試結束後還原 chat-binding 金鑰，並移除測試期間新建的任何 chat-binding 金鑰。

const USER_TEXT = 'e2e chat binding probe (aborted before it leaves the browser)';
const HOME = DEEPSEEK_ORIGIN + '/';
const FIRST_SEND_TEXT = 'e2e chat binding first-send probe (answered by an in-browser stub, never sent)';
// 由 beforeEach 從錄製中選出：被綁定的對話（"withSearch" 角色）與另一個不同的對話。
let boundId = null;
let boundUrl = null;
let otherUrl = null;
const COMPLETION_PATH = '/api/v0/chat/completion';
const CHAT_URL_PATTERN = /\/a\/chat\/s\/([0-9a-f-]{36})(?:[/?#]|$)/;
// 兩個新對話分頁的網址標記，讓彈出視窗能指定位於哪個分頁之上。
const TAB_A_MARKER = 'dss-e2e-tab=a';
const TAB_B_MARKER = 'dss-e2e-tab=b';

// 回放的 history 答覆延遲 400 毫秒（真實伺服器的延遲）：即時答覆會讓擴充功能的浮層早於所開啟對話的綁定解析而出現。
test.use({ replayLatency: { history: 400 } });

test.describe('conversation-bound prompt groups', { tag: '@offline' }, () => {
    test.beforeEach(async ({ settings, deepseekReplay }) => {
        const bound = deepseekReplay.requireConversation('withSearch');
        boundId = bound.id;
        boundUrl = `${DEEPSEEK_ORIGIN}/a/chat/s/${bound.id}`;
        otherUrl = `${DEEPSEEK_ORIGIN}/a/chat/s/${conversationOtherThan(deepseekReplay, bound.id).id}`;
        await settings.set({ isEnabled: true, globalPromptEnabled: false });
        await settings.setInBothAreas({ dsShowSystemTime: false });
        // 全域提示詞內容固定為空字串，送出內容不受設定檔殘留值影響。
        await settings.setInBothAreas({ globalDefaultPrompt: '' });
        await settings.trackNewKeys('chatPresetMap');
    });

    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('a group picked in the overlay of a conversation comes back when the conversation is reopened, stays out of other conversations, and the blank option unbinds it', async ({ page, context, settings }) => {
        const group = createTestPreset('bind-overlay');
        await seedOnlyPreset(settings, context, group);

        await gotoWithOverlay(page, boundUrl);
        await expectOverlayNeverShows(page, group.name, 'the conversation starts unbound (precondition)');
        await pickPreset(page, group);

        const blocked = await openBlockingSends(page, otherUrl);
        await expectOverlayNeverShows(page, group.name, 'another conversation does not take the binding');
        const otherPrompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(otherPrompt, 'a message sent in the unbound conversation carries no group content').toBe(documentedPrompt({ text: USER_TEXT }));

        await gotoWithOverlay(page, boundUrl);
        await expect(presetOverlay(page), 'reopening the conversation restores its bound group').toContainText(group.name);
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'a message sent in the reopened conversation carries the bound group content').toBe(documentedPrompt({ reminder: group.content, text: USER_TEXT }));

        await gotoWithOverlay(page, boundUrl);
        await expect(presetOverlay(page), 'the bound group is shown before unbinding (precondition)').toContainText(group.name);
        await pickPresetOption(page, (options) => options.filter({ hasNotText: group.name }));
        await expect(presetOverlay(page), 'the overlay drops the group after the blank option is picked').not.toContainText(group.name);
        await gotoWithOverlay(page, boundUrl);
        await expectOverlayNeverShows(page, group.name, 'after unbinding, reopening the conversation shows no group');
    });

    test('the popup opened on a bound conversation shows its group, and picking the blank option there unbinds the conversation', async ({ page, context, settings, extensionId }) => {
        const group = createTestPreset('bind-popup');
        await seedOnlyPreset(settings, context, group);
        await gotoWithOverlay(page, boundUrl);
        await pickPreset(page, group);
        // Reloading drops the in-memory pick, so from here on only the stored binding can bring the group back.
        await gotoWithOverlay(page, boundUrl);
        await expect(presetOverlay(page), 'the reloaded conversation restores its bound group').toContainText(group.name);

        const popup = await openPopup(context, extensionId, { activeTabUrlPart: boundId });
        await expect(popupPickedGroup(popup), 'the popup on the bound conversation shows the bound group').toHaveText(group.name);

        await openPopupGroupList(popup);
        await popup.locator('#presetSelectPanel .ds-select__item--empty').click();
        await expect(popupPickedGroup(popup), 'the popup now shows the blank option').not.toHaveText(group.name);
        await expect(presetOverlay(page), 'the overlay follows the popup and drops the group').not.toContainText(group.name);

        await popup.close();
        await gotoWithOverlay(page, boundUrl);
        await expectOverlayNeverShows(page, group.name, 'after unbinding in the popup, reopening the conversation shows no group');
    });

    test('tab independence: a group picked in the overlay of one new-conversation tab is not shown in another open new-conversation tab, and each tab sends the group picked in it', async ({ page, context, settings }) => {
        const first = createTestPreset('tab-first');
        const second = createTestPreset('tab-second');
        await seedOnlyPresets(settings, context, [first, second]);

        const blockedFirst = await openBlockingSends(page, HOME);
        const otherTab = await context.newPage();
        try {
            const blockedOther = await openBlockingSends(otherTab, HOME);
            await pickPreset(page, first);
            await expectOverlayNeverShows(otherTab, first.name, 'the other tab does not show the group picked in the first tab');

            await pickPreset(otherTab, second);
            await expectOverlayNeverShows(page, second.name, 'the first tab does not show the group picked in the other tab');
            await expect(presetOverlay(page), 'the first tab still shows its own pick').toContainText(first.name);

            await page.bringToFront();
            expect(await sendAndCapturePrompt(page, blockedFirst, USER_TEXT), 'the first tab sends the content of the group picked in it').toBe(documentedPrompt({ reminder: first.content, text: USER_TEXT }));
            await otherTab.bringToFront();
            expect(await sendAndCapturePrompt(otherTab, blockedOther, USER_TEXT), 'the other tab sends the content of the group picked in it').toBe(documentedPrompt({ reminder: second.content, text: USER_TEXT }));
        } finally {
            await otherTab.close();
        }
    });

    test('popup pick scope: a group picked in the popup over one new-conversation tab is shown and sent there, while another open new-conversation tab keeps showing and sending the group picked in its own overlay', async ({ page, context, settings, extensionId }) => {
        const popupGroup = createTestPreset('popup-tab');
        const ownGroup = createTestPreset('own-tab');
        await seedOnlyPresets(settings, context, [popupGroup, ownGroup]);

        const blockedUnder = await openBlockingSends(page, `${HOME}?${TAB_A_MARKER}`);
        const otherTab = await context.newPage();
        try {
            const blockedOther = await openBlockingSends(otherTab, `${HOME}?${TAB_B_MARKER}`);
            await expect(page, 'the tab under the popup keeps its marker (precondition)').toHaveURL(`${HOME}?${TAB_A_MARKER}`);
            await expect(otherTab, 'the other tab keeps its marker (precondition)').toHaveURL(`${HOME}?${TAB_B_MARKER}`);
            await pickPreset(otherTab, ownGroup);

            const popup = await openPopup(context, extensionId, { activeTabUrlPart: TAB_A_MARKER });
            await expect(popupPickedGroup(popup), 'the popup over the new-conversation tab with no pick starts on the blank option (precondition)').toHaveText(await popupBlankLabel(popup));
            await pickGroupInPopup(popup, popupGroup.name);
            await expect(presetOverlay(page), 'the tab under the popup shows the group picked in the popup').toContainText(popupGroup.name);
            await expectOverlayNeverShows(otherTab, popupGroup.name, 'the other new-conversation tab does not show the group picked in the popup');
            await expect(presetOverlay(otherTab), 'the other new-conversation tab still shows the group picked in its own overlay').toContainText(ownGroup.name);
            await popup.close();

            await page.bringToFront();
            expect(await sendAndCapturePrompt(page, blockedUnder, USER_TEXT), 'the tab under the popup sends the content of the group picked in the popup').toBe(documentedPrompt({ reminder: popupGroup.content, text: USER_TEXT }));
            await otherTab.bringToFront();
            expect(await sendAndCapturePrompt(otherTab, blockedOther, USER_TEXT), 'the other new-conversation tab sends the content of the group picked in its own overlay').toBe(documentedPrompt({ reminder: ownGroup.content, text: USER_TEXT }));
        } finally {
            await otherTab.close();
        }
    });

    test('the first message sent in a new conversation binds the picked group to the conversation id DeepSeek assigns, so reopening that conversation shows and sends the group', async ({ page, context, settings, deepseekReplay }) => {
        const group = createTestPreset('first-send');
        await seedOnlyPreset(settings, context, group);
        // 臨時對話開啟時，離開對話會刪除它；固定為關閉，讓所建立的對話保留下來並能重新開啟。
        await settings.set({ 'dss-temporary-chat-enabled': false });

        // 送出由瀏覽器內替身回覆，沒有任何訊息抵達 DeepSeek；頁面隨後移到 chat_session/create 回應給的對話 id。
        const stub = await armReplyStub(page);
        await gotoWithOverlay(page, HOME);
        await pickPreset(page, group);
        const sent = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === COMPLETION_PATH);
        await sendStubbedPrompt(page, FIRST_SEND_TEXT);
        const request = await sent;
        expect(request.postDataJSON()?.prompt, 'the first message carries the picked group content (precondition)').toBe(documentedPrompt({ reminder: group.content, text: FIRST_SEND_TEXT }));

        await page.waitForURL(CHAT_URL_PATTERN);
        const chatId = CHAT_URL_PATTERN.exec(page.url())[1];
        // 等替身回覆完成，對話完整建立後才在另一個分頁重新開啟。
        await expectReplyStreaming(page);
        await finishAndAwaitToolbar(page, stub);

        // 新分頁沒有原分頁記憶體中的選擇，只有已儲存的綁定能讓群組出現。
        // 錄製裡沒有這個對話：以錄製中另一個對話的訊息代為提供它的頁面與歷史。
        const reopened = await context.newPage();
        try {
            await deepseekReplay.serveConversationAs(reopened, chatId, 'mostMessages');
            const blocked = await openBlockingSends(reopened, `${DEEPSEEK_ORIGIN}/a/chat/s/${chatId}`);
            await expect(presetOverlay(reopened), 'reopening the new conversation shows the group picked before its first message').toContainText(group.name);
            expect(await sendAndCapturePrompt(reopened, blocked, USER_TEXT), 'a message sent in the reopened conversation carries the bound group content').toBe(documentedPrompt({ reminder: group.content, text: USER_TEXT }));
        } finally {
            await reopened.close();
        }
    });
});
