import { test, expect } from './fixtures.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { GO_TOP_SELECTOR as GO_TOP, PRESET_OVERLAY_SELECTOR as PRESET_OVERLAY } from './helpers/extension-ui.js';

// The master switch (`isEnabled`) gates every feature live, without a reload.
// Go-to-top and the preset overlay follow the master switch only.

test.describe('master switch', () => {
    test('turning isEnabled off removes go-top and hides the preset overlay; turning it on brings both back', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: true });
        await openConversation(CONVERSATIONS.longWithCode);

        await expect(page.locator(GO_TOP), 'go-top is injected while the master switch is on').toHaveCount(1);
        await expect(page.locator(PRESET_OVERLAY), 'preset overlay is shown while the master switch is on').toBeVisible();

        await settings.set({ isEnabled: false });
        await expect(page.locator(GO_TOP), 'go-top is removed after the master switch turns off').toHaveCount(0);
        await expect(page.locator(PRESET_OVERLAY), 'preset overlay is hidden after the master switch turns off').toBeHidden();

        await settings.set({ isEnabled: true });
        await expect(page.locator(GO_TOP), 'go-top is injected again after the master switch turns back on').toHaveCount(1);
        await expect(page.locator(PRESET_OVERLAY), 'preset overlay is shown again after the master switch turns back on').toBeVisible();
    });
});
