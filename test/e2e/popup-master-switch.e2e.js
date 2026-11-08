import { test, expect } from './fixtures.js';
import { DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import { PRESET_OVERLAY_SELECTOR as PRESET_OVERLAY } from './helpers/extension-ui.js';
import { clickPopupSwitch, closeExtensionPages, openPopup } from './helpers/popup.js';

// Master switch clicked in the popup (docs/FEATURES.md): off disables every feature sub-control in the popup and turns the extension off on the open DeepSeek page; on brings both back.
// The global prompt toggle is not a sub-control and stays usable. The in-page preset overlay stands for the page side (master-switch.e2e.js covers the storage-driven path).

const SUB_CONTROLS = [
    { selector: '#sidebarAutoHideToggle', name: 'sidebar auto-hide toggle' },
    { selector: '#hideThinkingToggle', name: 'hide-thinking toggle' },
    { selector: '#showSystemTimeToggle', name: 'system-time toggle' },
    { selector: '#chatWidthToggle', name: 'chat-width toggle' },
    { selector: '#chatWidthSlider', name: 'chat-width slider' },
    { selector: '#inputWidthToggle', name: 'input-width toggle' },
    { selector: '#inputWidthSlider', name: 'input-width slider' },
    { selector: '#preventAutoScrollToggle', name: 'prevent-auto-scroll toggle' },
    { selector: '#autoExpandMessagesToggle', name: 'auto-expand toggle' },
    { selector: '#autoRetryToggle', name: 'auto-retry toggle' },
    { selector: '#autoContinueToggle', name: 'auto-continue toggle' },
    { selector: '#autoOpenSidebarToggle', name: 'auto-open-sidebar toggle' },
    { selector: '#autoCopyReplyToggle', name: 'auto-copy-reply toggle' },
    { selector: '#autoCopyCodeToggle', name: 'auto-copy-code toggle' },
    { selector: 'input[name="websearchToggle"][value="on"]', name: 'web-search on radio' },
    { selector: 'input[name="websearchToggle"][value="off"]', name: 'web-search off radio' },
    { selector: 'input[name="replyNotificationToggle"][value="on"]', name: 'reply-notification on radio' },
    { selector: 'input[name="replyNotificationToggle"][value="off"]', name: 'reply-notification off radio' },
];

/** Asserts every sub-control is enabled (`isEnabled`) or disabled, naming each control and the master state in its message. */
async function expectSubControls(popup, isEnabled, suffix) {
    for (const { selector, name } of SUB_CONTROLS) {
        const control = popup.locator(selector);
        if (isEnabled) await expect(control, `${name} enabled ${suffix}`).toBeEnabled();
        else await expect(control, `${name} disabled ${suffix}`).toBeDisabled();
    }
}

test.describe('popup master switch', () => {
    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('master off in the popup disables every sub-control (system-time toggle disabled when master off), keeps the global prompt toggle enabled and hides the preset overlay; master on restores them', async ({ page, context, settings, extensionId }) => {
        await settings.set({ isEnabled: true });
        await expect(page.locator(PRESET_OVERLAY), 'the preset overlay is shown on the DeepSeek page while the master switch is on (precondition)').toBeVisible();

        const popup = await openPopup(context, extensionId, { activeTabUrlPart: DEEPSEEK_ORIGIN });
        await expect(popup.locator('#enableToggle'), 'the popup shows the master switch on (precondition)').toBeChecked();
        await expectSubControls(popup, true, 'while master on (precondition)');

        await clickPopupSwitch(popup, 'enableToggle');
        await expect(popup.locator('#enableToggle'), 'the master switch turns off').not.toBeChecked();
        await expectSubControls(popup, false, 'when master off');
        await expect(popup.locator('#globalPromptToggle'), 'global prompt toggle stays enabled when master off').toBeEnabled();
        await expect(page.locator(PRESET_OVERLAY), 'the preset overlay hides when master off').toBeHidden();

        await clickPopupSwitch(popup, 'enableToggle');
        await expect(popup.locator('#enableToggle'), 'the master switch turns back on').toBeChecked();
        await expectSubControls(popup, true, 'when master back on');
        await expect(popup.locator('#globalPromptToggle'), 'global prompt toggle enabled when master back on').toBeEnabled();
        await expect(page.locator(PRESET_OVERLAY), 'the preset overlay shows again when master back on').toBeVisible();
    });
});
