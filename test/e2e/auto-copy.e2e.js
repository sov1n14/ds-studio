import { test, expect } from './fixtures.js';
import { expectNeverWithin } from './helpers/observation.js';
import { hasPermissions } from './helpers/extension.js';
import { armReplyStub, clipboardWrites, expectReplyStreaming, finishAndAwaitToolbar, openHome, recordClipboardWrites, sendStubbedPrompt, STUB_CODE, STUB_REPLY, stubReplyToolbar } from './helpers/reply-stub.js';

// 自動複製回覆與程式碼區塊（docs/FEATURES.md 的 Auto Copy Reply and Code Blocks；docs/spec/04-features.md 第 26 節）：
// - 新回覆完成時，程式碼區塊開關開啟就依序按下每個程式碼區塊的複製按鈕，回覆開關開啟就最後按下回覆工具列的第一個按鈕；兩者都開時先程式碼、後回覆。
// - 兩個開關都關閉，或總開關關閉時，什麼都不複製。
// 回覆由瀏覽器內替身提供（helpers/reply-stub.js），沒有任何訊息抵達 DeepSeek；觀察的是頁面上每一次 navigator.clipboard.writeText 的文字，預期值取自替身送出的內容。
// 分頁維持在前景，因此由網站自己的寫入完成複製；未取得焦點時的備援寫入不在這裡測試。所有寫入的儲存鍵在測試後還原。

const PROMPT = 'e2e auto-copy probe (answered by an in-browser stub, never sent)';
const CLIPBOARD_PERMISSIONS = ['clipboardWrite', 'offscreen'];
// 證明「沒有寫入」或「沒有多寫」的觀察窗長度；觀察窗本身就是斷言。
const NO_WRITE_WINDOW_MS = 3_000;

/** 設定兩個自動複製開關與總開關，一次寫一個鍵，總開關最後寫；臨時對話固定關閉，離開頁面時不會刪除 DeepSeek 預先建立的對話。 */
async function pinSettings(settings, { reply, code, master = true }) {
    await settings.setInBothAreas({ isAutoCopyReplyEnabled: reply });
    await settings.setInBothAreas({ isAutoCopyCodeEnabled: code });
    await settings.set({ 'dss-temporary-chat-enabled': false });
    await settings.set({ isEnabled: master });
}

/** 裝好剪貼簿記錄與替身回覆、重新載入首頁、送出一次，等回覆以串流狀態出現後讓它完成，並等待工具列掛載。 */
async function sendAndCompleteReply(page) {
    await recordClipboardWrites(page);
    const stub = await armReplyStub(page);
    await openHome(page);
    await sendStubbedPrompt(page, PROMPT);
    await expectReplyStreaming(page);
    expect(await clipboardWrites(page), 'nothing is written to the clipboard while the reply streams').toEqual([]);
    await finishAndAwaitToolbar(page, stub);
    return stub;
}

/** 斷言剪貼簿寫入恰好是 `expected`（依序），並在觀察窗內沒有再多寫。 */
async function expectExactWrites(page, expected, message) {
    await expect.poll(() => clipboardWrites(page), { message }).toEqual(expected);
    await expectNeverWithin(page, (count) => (window.__dssE2eClipboardWrites || []).length > count, expected.length, NO_WRITE_WINDOW_MS, `${message}: no further clipboard write`);
}

/** 斷言觀察窗內沒有任何寫入，再由使用者親手按回覆的複製按鈕，證明記錄器在這一頁看得到寫入。 */
async function expectNoAutoWriteThenManualCopyIsSeen(page, message) {
    await expectNeverWithin(page, () => (window.__dssE2eClipboardWrites || []).length > 0, null, NO_WRITE_WINDOW_MS, message);
    await stubReplyToolbar(page).locator(':scope > [role="button"]').first().click();
    await expect.poll(() => clipboardWrites(page), { message: 'a manual click on the reply copy button is recorded (the observer sees writes on this page)' }).toEqual([STUB_REPLY]);
}

test.describe('auto copy reply and code blocks', () => {
    test.beforeEach(async ({ context }) => {
        expect(await hasPermissions(context, CLIPBOARD_PERMISSIONS), `optional permissions ${CLIPBOARD_PERMISSIONS.join(' + ')} must already be granted in .browser-profile (a permission prompt cannot be driven)`).toBe(true);
    });

    test('with only the reply toggle on, a newly finished reply is copied once as the whole reply text', async ({ page, settings }) => {
        await pinSettings(settings, { reply: true, code: false });
        await sendAndCompleteReply(page);
        await expectExactWrites(page, [STUB_REPLY], 'the clipboard receives exactly the whole reply');
    });

    test('with only the code toggle on, a newly finished reply has its code block copied once and the reply is not copied', async ({ page, settings }) => {
        await pinSettings(settings, { reply: false, code: true });
        await sendAndCompleteReply(page);
        await expectExactWrites(page, [STUB_CODE], 'the clipboard receives exactly the code block content');
    });

    test('with both toggles on, the code block is copied first and the whole reply last', async ({ page, settings }) => {
        await pinSettings(settings, { reply: true, code: true });
        await sendAndCompleteReply(page);
        await expectExactWrites(page, [STUB_CODE, STUB_REPLY], 'the clipboard receives the code block, then the whole reply');
    });

    test('with both toggles off, a newly finished reply is not copied', async ({ page, settings }) => {
        await pinSettings(settings, { reply: false, code: false });
        await sendAndCompleteReply(page);
        await expectNoAutoWriteThenManualCopyIsSeen(page, 'nothing is copied after the reply finishes with both toggles off');
    });

    test('with the master switch off, a newly finished reply is not copied even with both toggles on', async ({ page, settings }) => {
        await pinSettings(settings, { reply: true, code: true, master: false });
        await sendAndCompleteReply(page);
        await expectNoAutoWriteThenManualCopyIsSeen(page, 'nothing is copied after the reply finishes with the master switch off');
    });
});
