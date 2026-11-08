import { test, expect } from './fixtures.js';
import { CONVERSATIONS, DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { closeExtensionPages, openPopup, openPopupGroupList, popupPickedGroup } from './helpers/popup.js';
import { createTestPreset, expectOverlayNeverShows, pickPreset, pickPresetOption, presetOverlay, seedOnlyPreset } from './helpers/presets.js';
import { documentedPrompt, gotoWithOverlay, openBlockingSends, sendAndCapturePrompt } from './helpers/prompt-capture.js';

// Conversation-Bound Prompt Groups (docs/FEATURES.md, Conversation-Bound Prompt Groups and Using Prompt Injection step 4; docs/spec/01-prompt-system.md section 4; docs/spec/02-popup-ui.md section 15).
// Binding is storage only: the kept conversations are opened, never written to; every send is aborted in the browser. The chat-binding keys are restored after the test, and any chat-binding key created during it is removed.

const USER_TEXT = 'e2e chat binding probe (aborted before it leaves the browser)';
const BOUND_URL = `${DEEPSEEK_ORIGIN}/a/chat/s/${CONVERSATIONS.thinkingWithSearch}`;
const OTHER_URL = `${DEEPSEEK_ORIGIN}/a/chat/s/${CONVERSATIONS.fiveThinkingReplies}`;

test.describe('conversation-bound prompt groups', () => {
    test.beforeEach(async ({ settings }) => {
        await settings.set({ isEnabled: true, globalPromptEnabled: false });
        await settings.setInBothAreas({ dsShowSystemTime: false });
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
});
