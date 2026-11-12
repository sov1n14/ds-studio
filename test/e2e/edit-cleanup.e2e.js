import { test, expect } from './fixtures.js';
import { createTestPreset, pickPreset, presetOverlay, seedOnlyPreset } from './helpers/presets.js';
import { documentedPrompt, gotoWithOverlay } from './helpers/prompt-capture.js';
import { armReplyStub, expectReplyStreaming, finishAndAwaitToolbar, sendStubbedPrompt } from './helpers/reply-stub.js';
import { DSSelectors } from './helpers/selectors.js';
import { expectTimeLine, timedSend } from './helpers/system-time.js';

// 編輯訊息清理（docs/FEATURES.md 的 Edit Message Cleanup；docs/spec/01-prompt-system.md 第 3 節）：
// - 點 DeepSeek 使用者訊息的編輯按鈕後，編輯框只顯示使用者自己輸入的文字；提示詞注入加上的 <user-input> 包裝、外層的 <system-reminder> 與其他注入內容（系統時間行）都被移除（docs/FEATURES.md 的 Cleanup Content 條目；docs/spec/01-prompt-system.md 第 3 節的 Unwrap condition）。
// - 這個功能沒有獨立開關，也不受總開關控制（docs/FEATURES.md 的 Fully Automatic 條目）；總開關只測到文件寫明的範圍，不斷言只能從實作得知的行為。
// - 清理前，編輯框載入的是完整的包裝內容（docs/spec/01-prompt-system.md 第 3 節的 Purpose）；測試先確認使用者泡泡顯示了注入內容，編輯框只剩原文才代表清理確實發生。
// 送出的訊息由瀏覽器內替身回覆（helpers/reply-stub.js），沒有任何訊息抵達 DeepSeek；編輯框一律以「取消」關閉，從不按編輯框的送出，所有寫入的儲存鍵在測試後還原。

// 兩行文字：清理後必須原樣保留使用者輸入中的換行。
const USER_TEXT = 'e2e edit-cleanup probe line 1\ne2e edit-cleanup probe line 2';
const PROBE_LINE = 'e2e edit-cleanup probe line 1';
const GLOBAL_PROMPT = 'E2E-GLOBAL-MARKER-edit-cleanup';
const COMPLETION_PATH = '/api/v0/chat/completion';
// DeepSeek 編輯框的送出端點；替身回覆已在瀏覽器內中止所有非 GET 的 API 請求，這裡另外計數，證明編輯從未送出。
const EDIT_PATH = '/api/v0/chat/edit_message';
// DeepSeek 編輯框的「取消」按鈕（介面語系為簡體中文或英文）。
const CANCEL_LABEL = /^(取消|Cancel)$/;

/**
 * 固定每個會影響送出內容的鍵，一次寫一個鍵，總開關最後寫：提示詞群組（含全域提示詞）、全域提示詞內容與系統時間都開啟，讓送出的訊息帶有文件所說的全部注入內容。
 * 臨時對話固定關閉，離開頁面時不會刪除 DeepSeek 預先建立的對話。
 */
async function pinInjectedSettings(settings, context, group) {
    await seedOnlyPreset(settings, context, group);
    await settings.setInBothAreas({ globalDefaultPrompt: GLOBAL_PROMPT });
    await settings.setInBothAreas({ dsShowSystemTime: true });
    await settings.set({ 'dss-temporary-chat-enabled': false });
    await settings.set({ isEnabled: true });
}

/** 記錄 `page` 每一個 completion 請求的內文，以及編輯送出請求的次數；須在送出之前呼叫。 */
function recordRequests(page) {
    const completions = [];
    let edits = 0;
    page.on('request', (request) => {
        const { pathname } = new URL(request.url());
        if (pathname === COMPLETION_PATH) completions.push(request.postDataJSON());
        if (pathname === EDIT_PATH) edits += 1;
    });
    return { completions: () => [...completions], edits: () => edits };
}

/**
 * 在首頁選取 `group`、送出 USER_TEXT 並讓替身回覆完成；回傳實際送出的提示詞與送出時間窗。
 * 先斷言送出的提示詞帶有文件所說的全部注入內容（時間行、system-reminder、user-input 包裝），編輯框之後只顯示原文才有意義。
 */
async function sendInjectedMessage(page, group, requests) {
    const stub = await armReplyStub(page);
    await gotoWithOverlay(page);
    await pickPreset(page, group);
    const sent = await timedSend(page, async () => {
        await sendStubbedPrompt(page, USER_TEXT);
        await expect.poll(() => requests.completions().length, { message: 'pressing Enter posts one completion request (answered by the stub)' }).toBe(1);
        return requests.completions()[0].prompt;
    });
    expect(expectTimeLine(sent), 'the sent prompt carries the system-reminder block (global prompt, then the group) and the user-input wrapper after the time line (precondition)')
        .toBe(documentedPrompt({ reminder: `${GLOBAL_PROMPT}\n\n${group.content}`, text: USER_TEXT }));
    await expectReplyStreaming(page);
    await finishAndAwaitToolbar(page, stub);
}

/** 送出的使用者訊息所在的虛擬列表項目，以 key 釘住（虛擬列表會重新渲染，位置型定位可能飄到別則訊息）；先確認泡泡顯示的是帶有注入內容 `injected` 的完整送出內容。 */
async function sentUserItem(page, injected) {
    const byText = page.locator(DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR).filter({ has: page.locator(DSSelectors.USER_CONTENT_SELECTOR, { hasText: PROBE_LINE }) });
    await expect(byText, 'the sent user message is rendered once (precondition)').toHaveCount(1);
    await expect(byText.locator(DSSelectors.USER_CONTENT_SELECTOR), 'the user bubble shows the full sent prompt with the injected content, which is what the edit box loads (precondition)').toContainText(injected);
    const key = await byText.getAttribute(DSSelectors.VIRTUAL_ITEM_KEY_ATTR);
    return page.locator(`${DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR}[${DSSelectors.VIRTUAL_ITEM_KEY_ATTR}="${key}"]`);
}

/** 點使用者訊息的編輯按鈕，等待 DeepSeek 的編輯框出現；回傳編輯框與它的「取消」按鈕。 */
async function openEditBox(page, item) {
    await item.hover();
    await page.locator(DSSelectors.EDIT_MESSAGE_BUTTON_SELECTOR).and(item.locator('[role="button"]')).click();
    const editBox = item.locator('textarea');
    await expect(editBox, 'the native edit box opens inside the edited message').toBeVisible();
    const cancel = item.getByRole('button', { name: CANCEL_LABEL });
    await expect(cancel, 'the edit box shows its Cancel button (precondition)').toBeVisible();
    return { editBox, cancel };
}

/** 以「取消」關閉編輯框（從不送出編輯），並等待編輯框消失。 */
async function cancelEdit(page, item, cancel) {
    await cancel.click();
    await expect(item.locator('textarea'), 'Cancel closes the edit box without submitting').toHaveCount(0);
}

test.describe('edit message cleanup', () => {
    test('the edit box of a message sent with a group, the global prompt and the system time holds only the typed text', async ({ page, context, settings }) => {
        const group = { ...createTestPreset('edit-cleanup'), globalPromptEnabled: true };
        await pinInjectedSettings(settings, context, group);
        const requests = recordRequests(page);
        await sendInjectedMessage(page, group, requests);

        const item = await sentUserItem(page, group.content);
        const { editBox, cancel } = await openEditBox(page, item);
        try {
            await expect(editBox, 'the edit box holds exactly the typed text: no time line, no system-reminder block, no user-input wrapper').toHaveValue(USER_TEXT);
        } finally {
            await cancelEdit(page, item, cancel);
        }
        expect(requests.edits(), 'no edit was submitted').toBe(0);
    });

    test('with the master switch turned off the edit box still holds only the typed text', async ({ page, context, settings }) => {
        const group = { ...createTestPreset('edit-cleanup-off'), globalPromptEnabled: true };
        await pinInjectedSettings(settings, context, group);
        const requests = recordRequests(page);
        await sendInjectedMessage(page, group, requests);

        await settings.set({ isEnabled: false });
        await expect(presetOverlay(page), 'the page has applied the master switch off: the preset overlay is hidden (precondition)').toBeHidden();

        const item = await sentUserItem(page, group.content);
        const { editBox, cancel } = await openEditBox(page, item);
        try {
            await expect(editBox, 'the cleanup is not gated by the master switch: the edit box holds exactly the typed text').toHaveValue(USER_TEXT);
        } finally {
            await cancelEdit(page, item, cancel);
        }
        expect(requests.edits(), 'no edit was submitted').toBe(0);
    });
});
