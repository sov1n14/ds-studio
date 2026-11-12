import { test, expect } from './fixtures.js';
import { blockSendRequests, clickSendWith, composer } from './helpers/composer.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { createTestPreset, pickPreset, presetOverlay, seedOnlyPreset } from './helpers/presets.js';
import { humanType } from './helpers/human.js';
import { documentedPrompt } from './helpers/prompt-capture.js';

// Prompt injection prepends the picked preset's content to the message when it is sent; with the empty option picked no preset content is sent (docs/FEATURES.md, Using Prompt Injection and Using No Prompt Group).
// 注入觸發條件（docs/spec/01-prompt-system.md 第 2 節）：按下 Enter（不含會插入換行的 Shift+Enter）；點擊畫面上的送出按鈕。
// 此 spec 走 DeepSeek 真實的送出路徑（在輸入框按 Enter 或點擊送出按鈕），並讀取 DeepSeek 原本會送出的提示詞：每個送出請求都在瀏覽器內中止，因此沒有任何內容抵達 DeepSeek。

const PRESET = createTestPreset('inject');
const USER_TEXT = 'e2e prompt injection probe (aborted before it leaves the browser)';
const COMPLETION_PATH = '/api/v0/chat/completion';
// 觀察頁面的時長，用以證明 Shift+Enter 不會發出任何送出請求。
const NO_SEND_WINDOW_MS = 2_000;

/** 執行 `send`，並解析出它所產生（已中止）的 completion 請求中的提示詞；`how` 是失敗訊息中對該送出動作的稱呼。 */
async function captureSentPrompt(blocked, send, how) {
    const before = blocked.requests().length;
    await send();
    const isCompletion = ({ url }) => new URL(url).pathname === COMPLETION_PATH;
    await expect.poll(() => blocked.requests().slice(before).some(isCompletion), { message: `${how} posts a completion request (aborted)` }).toBe(true);
    const completion = blocked.requests().slice(before).find(isCompletion);
    expect(typeof completion.body?.prompt, 'the completion request carries a prompt field').toBe('string');
    return completion.body.prompt;
}

/** Types `text` into the composer, presses Enter and resolves the prompt of the (aborted) completion request it produced. */
async function sendAndCapturePrompt(page, blocked, text) {
    return captureSentPrompt(blocked, async () => {
        await humanType(composer(page), text);
        await composer(page).press('Enter');
    }, 'pressing Enter');
}

/** 前 `before` 個請求之後只要有任何送出請求發出即失敗，並持續觀察到觀察時段結束；這段觀察時段本身就是斷言。 */
async function expectNoSendWithin(blocked, before, durationMs, message) {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    expect(blocked.requests().slice(before).map(({ url }) => url), `${message}: no send request within ${durationMs} ms`).toEqual([]);
}

/** Opens a fresh home page with every send request blocked, the overlay shown and no preset picked. */
async function openHomeBlockingSends(page, preset = PRESET) {
    const blocked = await blockSendRequests(page);
    await page.goto(DEEPSEEK_ORIGIN + '/');
    await expect(presetOverlay(page), 'the preset overlay is shown (precondition)').toBeVisible();
    await expect(presetOverlay(page), 'no preset is picked on a new chat (precondition)').not.toContainText(preset.name);
    return blocked;
}

test.describe('prompt injection', () => {
    test.beforeEach(async ({ context, settings }) => {
        await seedOnlyPreset(settings, context, PRESET);
        await settings.set({ isEnabled: true });
    });

    test('with no preset picked the sent prompt carries the typed text and no preset content', async ({ page }) => {
        const blocked = await openHomeBlockingSends(page);
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'the sent prompt carries the typed text').toContain(USER_TEXT);
        expect(prompt, 'with no preset picked the sent prompt carries no preset content').not.toContain(PRESET.content);
    });

    test('with a preset picked the sent prompt carries the preset content before the typed text', async ({ page }) => {
        const blocked = await openHomeBlockingSends(page);
        await pickPreset(page, PRESET);
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'the sent prompt carries the picked preset content').toContain(PRESET.content);
        expect(prompt, 'the sent prompt still carries the typed text').toContain(USER_TEXT);
        expect(prompt.indexOf(PRESET.content), 'the preset content comes before the typed text').toBeLessThan(prompt.indexOf(USER_TEXT));
    });
});

test.describe('prompt injection triggers', () => {
    // 固定精確提示詞所依賴的每個鍵，每次寫入一個鍵：所選群組（其自身的全域提示詞開關為關閉）、全域提示詞、裝置層級的全域提示詞開關，以及系統時間行。
    test.beforeEach(async ({ settings }) => {
        await settings.setInBothAreas({ globalDefaultPrompt: '' });
        await settings.set({ globalPromptEnabled: false });
        await settings.setInBothAreas({ dsShowSystemTime: false });
        await settings.set({ isEnabled: true });
    });

    test('clicking the send button sends the picked group content in the system-reminder block, then the typed text', async ({ page, context, settings }) => {
        const group = createTestPreset('click-send');
        await seedOnlyPreset(settings, context, group);
        const blocked = await openHomeBlockingSends(page, group);
        await pickPreset(page, group);

        const prompt = await captureSentPrompt(blocked, () => clickSendWith(page, USER_TEXT), 'clicking the send button');
        expect(prompt, 'the click sends the group content inside system-reminder, a blank line, then the typed text inside user-input').toBe(documentedPrompt({ reminder: group.content, text: USER_TEXT }));
    });

    test('Shift+Enter inserts a line break and sends nothing; Enter then sends the multi-line text after the group content', async ({ page, context, settings }) => {
        const group = createTestPreset('shift-enter');
        const firstLine = 'e2e shift+enter first line';
        const secondLine = 'e2e shift+enter second line (aborted before it leaves the browser)';
        await seedOnlyPreset(settings, context, group);
        const blocked = await openHomeBlockingSends(page, group);
        await pickPreset(page, group);

        const input = composer(page);
        await humanType(input, firstLine);
        const sendsBeforeShiftEnter = blocked.requests().length;
        await input.press('Shift+Enter');
        await expect(input, 'Shift+Enter inserts a line break at the caret and injects nothing into the composer').toHaveValue(`${firstLine}\n`);
        await expectNoSendWithin(blocked, sendsBeforeShiftEnter, NO_SEND_WINDOW_MS, 'Shift+Enter does not send');
        await humanType(input, secondLine, { isAppending: true });
        await expect(input, 'the second line follows the line break (precondition)').toHaveValue(`${firstLine}\n${secondLine}`);

        const prompt = await captureSentPrompt(blocked, () => input.press('Enter'), 'pressing Enter');
        expect(prompt, 'Enter sends the group content inside system-reminder, then both typed lines inside user-input').toBe(documentedPrompt({ reminder: group.content, text: `${firstLine}\n${secondLine}` }));
    });
});
