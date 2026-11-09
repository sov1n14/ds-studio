import { test, expect } from './fixtures.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { PRESET_OVERLAY_SELECTOR } from './helpers/extension-ui.js';
import { expectNeverWithin } from './helpers/observation.js';
import { closeExtensionPages } from './helpers/popup.js';
import { createTestPreset, pickPreset, presetOverlay, seedOnlyPresets } from './helpers/presets.js';
import { documentedPrompt, openBlockingSends, openBlockingSendsWithoutOverlay, sendAndCapturePrompt } from './helpers/prompt-capture.js';

// 總開關（`isEnabled`）與提示詞注入：
// - 總開關優先權最高，關閉時不注入，無論全域提示詞開關為何（docs/FEATURES.md:61；docs/spec/01-prompt-system.md:85）。
// - 功能停用時略過注入（docs/spec/01-prompt-system.md:42-43）；總開關控制提示詞注入是否啟用（docs/spec/02-popup-ui.md:15）。
// - 總開關關閉時系統時間注入一併停用（docs/FEATURES.md:351、362）。
// - 啟用時的提示詞格式：時間行在最前，接著 <system-reminder>（全域提示詞與群組內容以空行相接），再接 <user-input>（docs/spec/01-prompt-system.md:26-37；docs/spec/04-features.md:66）。
// 每次送出的請求都在瀏覽器內被攔截中止，不會送到 DeepSeek；所有寫入的儲存鍵在測試後還原。

const USER_TEXT = 'e2e master switch injection probe (aborted before it leaves the browser)';
const HOME = DEEPSEEK_ORIGIN + '/';
// 文件記載的時間行格式 `Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)`，獨立成行並位於最前（docs/spec/04-features.md:66）。
const TIME_LINE = /^Current Time: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)\n+/;
// 證明浮層「不會出現」的觀察窗長度。
const OVERLAY_ABSENT_WINDOW_MS = 2_000;

/** 設定會改變送出內容的每一項功能：群組自身的全域提示詞開關為開（docs/FEATURES.md:57）、全域提示詞有內容、裝置層級開關為開、系統時間為開；每次寫入一個鍵，與產品相同。 */
async function configureEveryPromptSource(settings, context, group, globalPrompt) {
    await seedOnlyPresets(settings, context, [group]);
    await settings.setInBothAreas({ globalDefaultPrompt: globalPrompt });
    await settings.set({ globalPromptEnabled: true });
    await settings.setInBothAreas({ dsShowSystemTime: true });
}

test.describe('master switch and prompt injection', () => {
    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('with the master switch off, the sent prompt is exactly the typed text although a group is picked and the global prompt and system time are on', async ({ page, context, settings }) => {
        const group = { ...createTestPreset('master-off'), globalPromptEnabled: true };
        const globalPrompt = 'E2E-GLOBAL-PROMPT-' + Date.now();
        await configureEveryPromptSource(settings, context, group, globalPrompt);
        await settings.set({ isEnabled: true });

        const blocked = await openBlockingSends(page, HOME);
        await pickPreset(page, group);
        await settings.set({ isEnabled: false });
        // 浮層隱藏代表頁面已收到總開關關閉的變更（docs/FEATURES.md:364）。
        await expect(presetOverlay(page), 'the preset overlay hides once the master switch is off (precondition)').toBeHidden();

        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'with the master switch off nothing is injected: no time line, no system-reminder, no user-input wrapper').toBe(USER_TEXT);
    });

    test('turning the master switch back on restores injection on the next send: time line, then global prompt and group content, then the typed text', async ({ page, context, settings }) => {
        const group = { ...createTestPreset('master-on-again'), globalPromptEnabled: true };
        const globalPrompt = 'E2E-GLOBAL-PROMPT-' + Date.now();
        await configureEveryPromptSource(settings, context, group, globalPrompt);
        await settings.set({ isEnabled: false });

        // 總開關關閉時載入頁面：浮層不出現（docs/FEATURES.md:364）。
        const blocked = await openBlockingSendsWithoutOverlay(page, HOME);
        await expectNeverWithin(page, (selector) => document.querySelector(selector)?.checkVisibility() ?? false, PRESET_OVERLAY_SELECTOR, OVERLAY_ABSENT_WINDOW_MS, 'the preset overlay stays absent while the master switch is off (precondition)');

        await settings.set({ isEnabled: true });
        await expect(presetOverlay(page), 'the preset overlay appears once the master switch is back on').toBeVisible();
        await pickPreset(page, group);

        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        const timeLine = TIME_LINE.exec(prompt);
        expect(timeLine, `the prompt opens with the documented time line; got ${JSON.stringify(prompt.slice(0, 80))}`).not.toBeNull();
        expect(prompt.slice(timeLine[0].length), 'after the time line: global prompt and group content joined by a blank line inside system-reminder, then the typed text inside user-input').toBe(documentedPrompt({ reminder: `${globalPrompt}\n\n${group.content}`, text: USER_TEXT }));
    });
});
