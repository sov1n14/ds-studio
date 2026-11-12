import { test, expect } from './fixtures.js';
import { composer } from './helpers/composer.js';
import { CONVERSATIONS, DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { humanType } from './helpers/human.js';
import { closeExtensionPages, openPopup, openPopupGroupList, pickGroupInPopup, popupBlankLabel, popupPickedGroup } from './helpers/popup.js';
import { createTestPreset, expectOverlayNeverShows, pickPreset, pickPresetOption, presetOverlay, seedOnlyPreset, seedOnlyPresets } from './helpers/presets.js';
import { documentedPrompt, gotoWithOverlay, openBlockingSends, sendAndCapturePrompt } from './helpers/prompt-capture.js';

// 對話綁定提示詞群組（docs/FEATURES.md 的 Conversation-Bound Prompt Groups 與 Using Prompt Injection 步驟 4 至 6；docs/spec/01-prompt-system.md 第 4 節；docs/spec/02-popup-ui.md 第 15 節）。
// 綁定僅存在於儲存區：保留的對話只開啟、從不寫入；除一次之外的每次送出都在瀏覽器內中止（首次送出測試會送出一則真實訊息，並保留其建立的對話）。測試結束後還原 chat-binding 金鑰，並移除測試期間新建的任何 chat-binding 金鑰。

const USER_TEXT = 'e2e chat binding probe (aborted before it leaves the browser)';
const HOME = DEEPSEEK_ORIGIN + '/';
const BOUND_URL = `${DEEPSEEK_ORIGIN}/a/chat/s/${CONVERSATIONS.thinkingWithSearch}`;
const OTHER_URL = `${DEEPSEEK_ORIGIN}/a/chat/s/${CONVERSATIONS.fiveThinkingReplies}`;
// 真正送到 DeepSeek 的訊息；所建立的對話保留在測試帳號中，不刪除。
const REAL_SEND_TEXT = 'e2e chat binding first-send probe: reply with the single word OK';
const COMPLETION_PATH = '/api/v0/chat/completion';
const CHAT_URL_PATTERN = /\/a\/chat\/s\/([0-9a-f-]{36})(?:[/?#]|$)/;
// 兩個新對話分頁的網址標記，讓彈出視窗能指定位於哪個分頁之上。
const TAB_A_MARKER = 'dss-e2e-tab=a';
const TAB_B_MARKER = 'dss-e2e-tab=b';

test.describe('conversation-bound prompt groups', () => {
    test.beforeEach(async ({ settings }) => {
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

        await gotoWithOverlay(page, BOUND_URL);
        await expectOverlayNeverShows(page, group.name, 'the conversation starts unbound (precondition)');
        await pickPreset(page, group);

        const blocked = await openBlockingSends(page, OTHER_URL);
        await expectOverlayNeverShows(page, group.name, 'another conversation does not take the binding');
        const otherPrompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(otherPrompt, 'a message sent in the unbound conversation carries no group content').toBe(documentedPrompt({ text: USER_TEXT }));

        await gotoWithOverlay(page, BOUND_URL);
        await expect(presetOverlay(page), 'reopening the conversation restores its bound group').toContainText(group.name);
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'a message sent in the reopened conversation carries the bound group content').toBe(documentedPrompt({ reminder: group.content, text: USER_TEXT }));

        await gotoWithOverlay(page, BOUND_URL);
        await expect(presetOverlay(page), 'the bound group is shown before unbinding (precondition)').toContainText(group.name);
        await pickPresetOption(page, (options) => options.filter({ hasNotText: group.name }));
        await expect(presetOverlay(page), 'the overlay drops the group after the blank option is picked').not.toContainText(group.name);
        await gotoWithOverlay(page, BOUND_URL);
        await expectOverlayNeverShows(page, group.name, 'after unbinding, reopening the conversation shows no group');
    });

    test('the popup opened on a bound conversation shows its group, and picking the blank option there unbinds the conversation', async ({ page, context, settings, extensionId }) => {
        const group = createTestPreset('bind-popup');
        await seedOnlyPreset(settings, context, group);
        await gotoWithOverlay(page, BOUND_URL);
        await pickPreset(page, group);
        // Reloading drops the in-memory pick, so from here on only the stored binding can bring the group back.
        await gotoWithOverlay(page, BOUND_URL);
        await expect(presetOverlay(page), 'the reloaded conversation restores its bound group').toContainText(group.name);

        const popup = await openPopup(context, extensionId, { activeTabUrlPart: CONVERSATIONS.thinkingWithSearch });
        await expect(popupPickedGroup(popup), 'the popup on the bound conversation shows the bound group').toHaveText(group.name);

        await openPopupGroupList(popup);
        await popup.locator('#presetSelectPanel .ds-select__item--empty').click();
        await expect(popupPickedGroup(popup), 'the popup now shows the blank option').not.toHaveText(group.name);
        await expect(presetOverlay(page), 'the overlay follows the popup and drops the group').not.toContainText(group.name);

        await popup.close();
        await gotoWithOverlay(page, BOUND_URL);
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

    test('the first message sent in a new conversation binds the picked group to the conversation id DeepSeek assigns, so reopening that conversation shows and sends the group', async ({ page, context, settings }) => {
        // 這個測試真正送出一則訊息，並等 DeepSeek 建立對話、回覆完畢，所以時間上限放寬。
        test.setTimeout(180_000);
        const group = createTestPreset('first-send');
        await seedOnlyPreset(settings, context, group);
        // 臨時對話開啟時，離開對話會刪除它；固定為關閉，讓所建立的對話保留下來並能重新開啟。
        await settings.set({ 'dss-temporary-chat-enabled': false });

        await gotoWithOverlay(page, HOME);
        await pickPreset(page, group);
        const sent = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === COMPLETION_PATH);
        await humanType(composer(page), REAL_SEND_TEXT);
        await composer(page).press('Enter');
        const request = await sent;
        expect(request.postDataJSON()?.prompt, 'the first message carries the picked group content (precondition)').toBe(documentedPrompt({ reminder: group.content, text: REAL_SEND_TEXT }));

        await page.waitForURL(CHAT_URL_PATTERN);
        const chatId = CHAT_URL_PATTERN.exec(page.url())[1];
        test.info().annotations.push({ type: 'created conversation', description: chatId });
        console.log(`[chat-binding e2e] created conversation ${chatId} (kept in the account)`);
        // 等回覆串流結束，對話完整建立後才在另一個分頁重新開啟。
        const response = await request.response();
        expect(response?.status(), 'DeepSeek accepts the first message').toBe(200);
        await response.finished();

        // 新分頁沒有原分頁記憶體中的選擇，只有已儲存的綁定能讓群組出現。
        const reopened = await context.newPage();
        try {
            const blocked = await openBlockingSends(reopened, `${DEEPSEEK_ORIGIN}/a/chat/s/${chatId}`);
            await expect(presetOverlay(reopened), 'reopening the new conversation shows the group picked before its first message').toContainText(group.name);
            expect(await sendAndCapturePrompt(reopened, blocked, USER_TEXT), 'a message sent in the reopened conversation carries the bound group content').toBe(documentedPrompt({ reminder: group.content, text: USER_TEXT }));
        } finally {
            await reopened.close();
        }
    });
});
