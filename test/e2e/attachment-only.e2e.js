import { test, expect } from './fixtures.js';
import { attachTextFile, stubFileUploads } from './helpers/attachment.js';
import { composer, composerSendButton, isComposerSendButtonDisabled } from './helpers/composer.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { createTestPreset, pickPreset, seedOnlyPreset } from './helpers/presets.js';
import { captureSentCompletion, openBlockingSends } from './helpers/prompt-capture.js';
import { expectTimeLine, timedSend } from './helpers/system-time.js';

// 只附檔案的送出（docs/spec/01-prompt-system.md 第 2 節 Attachment/image-only submission；docs/spec/04-features.md 第 19 節 Attachment/Image-Only Sends）：
// - 輸入框為空但送出按鈕未停用時仍會注入，送出內容只有時間行（系統時間開啟時）與群組或全域提示詞的 <system-reminder> 區塊，整個 <user-input> 包裝刻意省略。
// - 按 Enter 與點擊送出按鈕都會觸發；輸入框為空且送出按鈕停用時不注入。
// - 輸入框只有一行舊時間行且附有檔案時，舊時間行換成新的一行（docs/FEATURES.md, System Time Injection, Duplicate Prevention）。
// 上傳請求以瀏覽器內替身回應，不會在測試帳號留下檔案；每個送出請求都在瀏覽器內中止，沒有任何內容抵達 DeepSeek；所有寫入的儲存鍵在測試後還原。

const HOME = DEEPSEEK_ORIGIN + '/';
// 證明「沒有送出」的觀察窗長度；觀察窗本身就是斷言。
const NO_SEND_WINDOW_MS = 2_000;
// 早已過去的舊時間行，與送出當下的時間必然不同。
const STALE_TIME_LINE = 'Current Time: 2001/02/03 04:05:06 (UTC+00:00)';

/** 文件記載的只附檔案送出內容（時間行之後的部分）：只有 <system-reminder> 區塊，沒有 <user-input> 包裝。 */
function attachmentOnlyPrompt(reminder) {
    return `<system-reminder>\n${reminder}\n</system-reminder>`;
}

/** 唯一的附件檔名，讓檔案卡片的定位不會撞到其他測試的檔案。 */
function uniqueFileName(label) {
    return `e2e-attachment-only-${label}-${Date.now()}.txt`;
}

/** 讓 `group` 成為唯一的群組，設定系統時間開關，再以替身上傳、攔截送出的方式開啟首頁並選取該群組。 */
async function openHomeWithGroupPicked(page, context, settings, group, showSystemTime) {
    await seedOnlyPreset(settings, context, group);
    await settings.setInBothAreas({ dsShowSystemTime: showSystemTime });
    const upload = await stubFileUploads(page);
    const blocked = await openBlockingSends(page, HOME);
    await pickPreset(page, group);
    return { upload, blocked };
}

/** 附上一個檔案，並等待替身上傳收到它、頁面查詢到檔案已處理完成（SUCCESS），如同使用者等檔案卡片處理完才送出。 */
async function attachAndWaitUntilReady(page, upload, fileName) {
    await attachTextFile(page, fileName);
    await expect.poll(() => upload.uploads().map((entry) => entry.fileName), { message: 'exactly the attached file went through the stubbed upload (precondition)' }).toEqual([fileName]);
    await expect.poll(() => upload.statusChecks(), { message: 'the page has read the stubbed file status SUCCESS (precondition)', timeout: 20_000 }).toBeGreaterThan(0);
}

/** 附上一個檔案並確認輸入框為空、送出按鈕已解除停用（只附檔案即可送出的狀態）。 */
async function attachOnly(page, upload, fileName) {
    await attachAndWaitUntilReady(page, upload, fileName);
    await expect(composer(page), 'the composer holds no text (precondition)').toHaveValue('');
    await expect.poll(() => isComposerSendButtonDisabled(page), { message: 'the send button is enabled by the attachment alone (precondition)' }).toBe(false);
}

/** 執行 `send`，解析它所產生（已中止）的 completion 請求內文，並附上送出時間窗與頁面的 UTC 偏移，供 expectTimeLine 使用。 */
async function sendTimedCompletion(page, blocked, send, how) {
    let completion;
    const timed = await timedSend(page, async () => {
        completion = await captureSentCompletion(blocked, send, how);
        return completion.prompt;
    });
    return { completion, timed };
}

/** 所有替身上傳得到的檔案 id，依上傳順序。 */
function uploadedIds(upload) {
    return upload.uploads().map((entry) => entry.id);
}

test.describe('prompt injection on an attachment-only send', () => {
    // 固定精確送出內容所依賴的每個鍵，每次寫入一個鍵：全域提示詞、裝置層級的全域提示詞開關，以及總開關；群組自身的全域提示詞開關由 createTestPreset 設為關閉，系統時間開關由各測試設定。
    test.beforeEach(async ({ settings }) => {
        await settings.setInBothAreas({ globalDefaultPrompt: '' });
        await settings.set({ globalPromptEnabled: false });
        await settings.set({ isEnabled: true });
    });

    test('pressing Enter with only an attachment and system time on sends the time line, then the group content in system-reminder, with no user-input wrapper', async ({ page, context, settings }) => {
        const group = createTestPreset('attach-enter');
        const { upload, blocked } = await openHomeWithGroupPicked(page, context, settings, group, true);
        await attachOnly(page, upload, uniqueFileName('enter'));

        const { completion, timed } = await sendTimedCompletion(page, blocked, () => composer(page).press('Enter'), 'pressing Enter in the empty composer');
        expect(completion.ref_file_ids, 'the send carries the attached file (precondition)').toEqual(uploadedIds(upload));
        expect(expectTimeLine(timed), 'after the time line comes only the system-reminder block with the group content, no user-input wrapper').toBe(attachmentOnlyPrompt(group.content));
    });

    test('clicking the send button with only an attachment and system time off sends only the group content in system-reminder, with no user-input wrapper', async ({ page, context, settings }) => {
        const group = createTestPreset('attach-click');
        const { upload, blocked } = await openHomeWithGroupPicked(page, context, settings, group, false);
        await attachOnly(page, upload, uniqueFileName('click'));

        const completion = await captureSentCompletion(blocked, () => composerSendButton(page).click(), 'clicking the send button with the composer empty');
        expect(completion.ref_file_ids, 'the send carries the attached file (precondition)').toEqual(uploadedIds(upload));
        expect(completion.prompt, 'the click sends exactly the system-reminder block with the group content: no time line, no user-input wrapper').toBe(attachmentOnlyPrompt(group.content));
    });

    test('a composer holding only an old time line plus an attachment sends one fresh time line, then the group content in system-reminder', async ({ page, context, settings }) => {
        // 已知與文件不符（2026-11-12 在真實頁面觀察）：按 Enter 時送出的是原封不動的舊時間行，沒有新時間行，也沒有群組內容。
        // 標記為預期失敗，讓此行為缺口持續可見；產品修正後此測試會轉為「意外通過」而失敗，屆時移除這一行。
        test.fail(true, 'known gap: a composer holding only an old time line plus an attachment is sent unchanged, with no injection');
        const group = createTestPreset('attach-stale-time');
        const { upload, blocked } = await openHomeWithGroupPicked(page, context, settings, group, true);
        await attachAndWaitUntilReady(page, upload, uniqueFileName('stale-time'));
        await composer(page).fill(STALE_TIME_LINE);
        await expect.poll(() => isComposerSendButtonDisabled(page), { message: 'the send button is enabled (precondition)' }).toBe(false);

        const { completion, timed } = await sendTimedCompletion(page, blocked, () => composer(page).press('Enter'), 'pressing Enter on the old time line');
        expect(completion.ref_file_ids, 'the send carries the attached file (precondition)').toEqual(uploadedIds(upload));
        expect(timed.prompt.split('Current Time:').length - 1, 'the sent prompt carries exactly one time line').toBe(1);
        expect(expectTimeLine(timed), 'the old time line is replaced by a fresh one, followed only by the system-reminder block with the group content').toBe(attachmentOnlyPrompt(group.content));
    });

    test('with no attachment and an empty composer the send button stays disabled, and neither Enter nor a click injects or sends anything', async ({ page, context, settings }) => {
        const group = createTestPreset('attach-none');
        const { blocked } = await openHomeWithGroupPicked(page, context, settings, group, true);
        await expect(composer(page), 'the composer holds no text (precondition)').toHaveValue('');
        expect(await isComposerSendButtonDisabled(page), 'the send button is disabled with nothing to send (precondition)').toBe(true);

        const before = blocked.requests().length;
        await composer(page).press('Enter');
        await composerSendButton(page).click();
        await new Promise((resolve) => setTimeout(resolve, NO_SEND_WINDOW_MS));
        const sendsAfter = blocked.requests().slice(before).map((request) => request.url);
        expect(sendsAfter, 'no send request within the observation window after Enter and a click').toEqual([]);
        await expect(composer(page), 'nothing is injected into the empty composer').toHaveValue('');
    });
});
