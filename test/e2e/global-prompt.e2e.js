import { test, expect } from './fixtures.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { clickPopupSwitch, closeEditorWithEscape, closeExtensionPages, fillEditorAndWaitForSave, openEditorWith, openPopup } from './helpers/popup.js';
import { createTestPreset, pickPreset, seedOnlyPreset, seedOnlyPresets } from './helpers/presets.js';
import { documentedPrompt, gotoWithOverlay, openBlockingSends, sendAndCapturePrompt } from './helpers/prompt-capture.js';

// Global Prompt (docs/FEATURES.md, Global Prompt and Using No Prompt Group; docs/spec/01-prompt-system.md sections 2 and 5).
// Prompt layout: the global prompt, then the group content, joined by a blank line inside <system-reminder>, then the typed text inside <user-input>.
// Each send happens on a freshly loaded page (DeepSeek moves to a new chat URL after the aborted send). The popup page is opened in a tab; every send request is aborted in the browser, and every touched storage key is restored after the test.

const USER_TEXT = 'e2e global prompt probe (aborted before it leaves the browser)';
const HOME = DEEPSEEK_ORIGIN + '/';

/** A test group whose own global-prompt switch is `isGlobalPromptEnabled`. */
function groupWithGlobalSwitch(label, isGlobalPromptEnabled) {
    return { ...createTestPreset(label), globalPromptEnabled: isGlobalPromptEnabled };
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
});
