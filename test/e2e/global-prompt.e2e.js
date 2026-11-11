import { test, expect } from './fixtures.js';
import { CONVERSATIONS, DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { clickPopupSwitch, closeEditorWithEscape, closeExtensionPages, fillEditorAndWaitForSave, openEditorWith, openPopup } from './helpers/popup.js';
import { createTestPreset, expectOverlayNeverShows, pickPreset, seedOnlyPreset, seedOnlyPresets } from './helpers/presets.js';
import { documentedPrompt, gotoWithOverlay, openBlockingSends, sendAndCapturePrompt } from './helpers/prompt-capture.js';
import { readBothAreas } from './helpers/settings.js';

// Global Prompt (docs/FEATURES.md, Global Prompt and Using No Prompt Group; docs/spec/01-prompt-system.md sections 2 and 5).
// Prompt layout: the global prompt, then the group content, joined by a blank line inside <system-reminder>, then the typed text inside <user-input>.
// Each send happens on a freshly loaded page (DeepSeek moves to a new chat URL after the aborted send). The popup page is opened in a tab; every send request is aborted in the browser, and every touched storage key is restored after the test.

const USER_TEXT = 'e2e global prompt probe (aborted before it leaves the browser)';
const HOME = DEEPSEEK_ORIGIN + '/';
// 保留在測試帳號中的既有對話（chat-binding.e2e.js 也把它當作未綁定的對話）；只開啟並送出會被中止的請求，從不寫入或刪除。
const EXISTING_CHAT_URL = `${DEEPSEEK_ORIGIN}/a/chat/s/${CONVERSATIONS.fiveThinkingReplies}`;

/** A test group whose own global-prompt switch is `isGlobalPromptEnabled`. */
function groupWithGlobalSwitch(label, isGlobalPromptEnabled) {
    return { ...createTestPreset(label), globalPromptEnabled: isGlobalPromptEnabled };
}

/** 模擬 v4.20.0 之前儲存的測試群組：完全沒有 `globalPromptEnabled` 欄位。 */
function legacyGroupWithoutGlobalSwitch(label) {
    const group = { ...createTestPreset(label) };
    delete group.globalPromptEnabled;
    return group;
}

test.describe('global prompt', () => {
    test.beforeEach(async ({ settings }) => {
        await settings.set({ isEnabled: true });
        await settings.setInBothAreas({ dsShowSystemTime: false });
    });

    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('the global prompt written in the popup editor window is sent before the picked group content and the typed text', async ({ page, context, settings, extensionId }) => {
        const group = groupWithGlobalSwitch('global-on', true);
        const globalPrompt = 'E2E-GLOBAL-PROMPT-' + Date.now();
        await seedOnlyPreset(settings, context, group);
        await settings.setInBothAreas({ globalDefaultPrompt: '' });
        await settings.set({ globalPromptEnabled: false });

        const popup = await openPopup(context, extensionId);
        const editor = await openEditorWith(context, popup.locator('#editGlobalPromptBtn'));
        await fillEditorAndWaitForSave(editor, globalPrompt);
        await closeEditorWithEscape(editor);

        const blocked = await openBlockingSends(page, HOME);
        await pickPreset(page, group);
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'global prompt, blank line, group content inside system-reminder, then the typed text').toBe(documentedPrompt({ reminder: `${globalPrompt}\n\n${group.content}`, text: USER_TEXT }));
    });

    test('each group keeps its own global-prompt switch: off sends only the group content, and switching it on in the popup adds the global prompt', async ({ page, context, settings, extensionId }) => {
        const switchedOn = groupWithGlobalSwitch('switch-on', true);
        const switchedOff = groupWithGlobalSwitch('switch-off', false);
        const globalPrompt = 'E2E-GLOBAL-PROMPT-' + Date.now();
        await seedOnlyPresets(settings, context, [switchedOn, switchedOff]);
        await settings.setInBothAreas({ globalDefaultPrompt: globalPrompt });
        // The device-level switch is on, so a group switch that is ignored would show up as an injected global prompt.
        await settings.set({ globalPromptEnabled: true });

        const blocked = await openBlockingSends(page, HOME);
        await pickPreset(page, switchedOff);
        const popup = await openPopup(context, extensionId, { activeTabUrlPart: HOME });
        await expect(popup.locator('#presetSelectValue'), 'the popup follows the group picked in the tab (precondition)').toHaveText(switchedOff.name);
        await expect(popup.locator('#globalPromptToggle'), 'the popup switch shows the picked group switch, off').not.toBeChecked();
        const offPrompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(offPrompt, 'with the group switch off only the group content is sent, although the device-level switch is on').toBe(documentedPrompt({ reminder: switchedOff.content, text: USER_TEXT }));

        await clickPopupSwitch(popup, 'globalPromptToggle');
        await expect(popup.locator('#globalPromptToggle'), 'the popup switch turns on').toBeChecked();
        await expect(async () => {
            const reblocked = await openBlockingSends(page, HOME);
            await pickPreset(page, switchedOff);
            const onPrompt = await sendAndCapturePrompt(page, reblocked, USER_TEXT);
            expect(onPrompt, 'after switching it on the global prompt comes before the group content').toBe(documentedPrompt({ reminder: `${globalPrompt}\n\n${switchedOff.content}`, text: USER_TEXT }));
        }).toPass({ timeout: 30_000 });
    });

    test('with no group picked the device-level switch in the popup decides whether the global prompt is sent', async ({ page, context, settings, extensionId }) => {
        const globalPrompt = 'E2E-GLOBAL-PROMPT-' + Date.now();
        await seedOnlyPreset(settings, context, groupWithGlobalSwitch('unpicked', true));
        await settings.setInBothAreas({ globalDefaultPrompt: globalPrompt });
        await settings.set({ globalPromptEnabled: false });

        const popup = await openPopup(context, extensionId);
        await expect(popup.locator('#globalPromptToggle'), 'with no group picked the popup shows the device-level switch, off (precondition)').not.toBeChecked();
        const blocked = await openBlockingSends(page, HOME);
        const offPrompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(offPrompt, 'with the device-level switch off only the typed text is sent').toBe(documentedPrompt({ text: USER_TEXT }));

        await clickPopupSwitch(popup, 'globalPromptToggle');
        await expect(popup.locator('#globalPromptToggle'), 'the popup switch turns on').toBeChecked();
        await expect(async () => {
            await gotoWithOverlay(page, HOME);
            const onPrompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
            expect(onPrompt, 'with the device-level switch on the global prompt alone fills the system-reminder').toBe(documentedPrompt({ reminder: globalPrompt, text: USER_TEXT }));
        }).toPass({ timeout: 30_000 });
    });

    test('picking the last-picked group again on a new conversation still sends the global prompt when that group switch is on', async ({ page, context, settings }) => {
        const group = groupWithGlobalSwitch('repick', true);
        const globalPrompt = 'E2E-GLOBAL-PROMPT-' + Date.now();
        await seedOnlyPreset(settings, context, group);
        await settings.setInBothAreas({ globalDefaultPrompt: globalPrompt });
        await settings.set({ globalPromptEnabled: false });
        const expected = documentedPrompt({ reminder: `${globalPrompt}\n\n${group.content}`, text: USER_TEXT });

        const blocked = await openBlockingSends(page, HOME);
        await pickPreset(page, group);
        expect(await sendAndCapturePrompt(page, blocked, USER_TEXT), 'the first pick sends the global prompt (precondition)').toBe(expected);

        await gotoWithOverlay(page, HOME);
        await pickPreset(page, group);
        const repickPrompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        await test.info().attach('repick-new-conversation.png', { body: await page.screenshot(), contentType: 'image/png' });
        expect(repickPrompt, 'picking the same group again on a new conversation sends the global prompt too').toBe(expected);
    });

    test('a legacy group stored without its own global-prompt switch counts as switched on: picking it sends the global prompt before the group content', async ({ page, context, settings }) => {
        const group = legacyGroupWithoutGlobalSwitch('legacy');
        const globalPrompt = 'E2E-GLOBAL-PROMPT-' + Date.now();
        await seedOnlyPreset(settings, context, group);
        await settings.setInBothAreas({ globalDefaultPrompt: globalPrompt });
        // 裝置層級開關固定為關閉：若缺少的欄位被當成關閉，或改由裝置層級開關決定，送出的內容就不會帶全域提示詞。
        await settings.set({ globalPromptEnabled: false });
        const groupKey = 'dsPreset_' + group.id;
        const stored = await readBothAreas(context, [groupKey]);
        expect(stored.sync[groupKey], 'sync holds the group exactly as seeded, without a globalPromptEnabled field (precondition)').toStrictEqual(group);
        expect(stored.local[groupKey], 'local holds the group exactly as seeded, without a globalPromptEnabled field (precondition)').toStrictEqual(group);

        const blocked = await openBlockingSends(page, HOME);
        await pickPreset(page, group);
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'a group without the field is treated as switched on: the global prompt, a blank line, then the group content').toBe(documentedPrompt({ reminder: `${globalPrompt}\n\n${group.content}`, text: USER_TEXT }));
    });

    test('an existing conversation bound to no group sends the global prompt alone when the device-level switch is on, even right after a group was picked in a new conversation', async ({ page, context, settings }) => {
        // 所選群組自身的開關為關閉：若既有對話誤沿用此群組，送出內容會帶群組內容且缺少全域提示詞。
        const group = groupWithGlobalSwitch('unbound-chat', false);
        const globalPrompt = 'E2E-GLOBAL-PROMPT-' + Date.now();
        await seedOnlyPreset(settings, context, group);
        await settings.setInBothAreas({ globalDefaultPrompt: globalPrompt });
        // 未綁定的對話不顯示任何群組，文件規定此時由裝置層級開關決定，因此固定為開啟。
        await settings.set({ globalPromptEnabled: true });

        await gotoWithOverlay(page, HOME);
        await pickPreset(page, group);
        const blocked = await openBlockingSends(page, EXISTING_CHAT_URL);
        await expectOverlayNeverShows(page, group.name, 'the existing conversation shows no group (precondition: it is bound to none)');
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'the unbound existing conversation sends the global prompt alone in the system-reminder, with no group content').toBe(documentedPrompt({ reminder: globalPrompt, text: USER_TEXT }));
    });
});
