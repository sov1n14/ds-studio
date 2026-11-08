import { test, expect } from './fixtures.js';
import { closeExtensionPages, openPopup } from './helpers/popup.js';

// Popup live sync (docs/FEATURES.md): a setting changed elsewhere (another tab, window or device) while the popup is open shows in the popup at once, without reopening or reloading it.
// The change is written into chrome.storage.local through the service worker, as another extension page would; the settings fixture restores every written key afterwards.
// A marker set on the popup window before the write proves the same document shows the change (a reload would drop the marker).

/** Sets a marker on the popup window; `expectSameDocument` later proves the popup did not reload. */
async function markDocument(popup) {
    await popup.evaluate(() => { window.__dssE2eLiveSyncMarker = true; });
}

async function expectSameDocument(popup) {
    expect(await popup.evaluate(() => window.__dssE2eLiveSyncMarker === true), 'the popup showed the change without reloading').toBe(true);
}

function radio(popup, name, value) {
    return popup.locator(`input[name="${name}"][value="${value}"]`);
}

function checkedRadioValue(popup, name) {
    return popup.locator(`input[name="${name}"]:checked`).getAttribute('value');
}

test.describe('popup live sync', () => {
    test.beforeEach(async ({ settings }) => {
        await settings.set({ isEnabled: true });
    });

    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('writing isAutoRetryEnabled while the popup is open flips the auto-retry checkbox without a reload', async ({ context, settings, extensionId }) => {
        const popup = await openPopup(context, extensionId);
        const wasChecked = await popup.locator('#autoRetryToggle').isChecked();
        await markDocument(popup);

        await settings.set({ isAutoRetryEnabled: !wasChecked });
        await expect(popup.locator('#autoRetryToggle'), `the auto-retry checkbox turns ${wasChecked ? 'off' : 'on'} live`).toBeChecked({ checked: !wasChecked });
        await expectSameDocument(popup);
    });

    test('writing dsWebSearchToggle while the popup is open checks the matching web-search radio without a reload', async ({ context, settings, extensionId }) => {
        const popup = await openPopup(context, extensionId);
        const startValue = await checkedRadioValue(popup, 'websearchToggle');
        expect(['on', 'off'], 'one web-search radio is checked (precondition)').toContain(startValue);
        const otherValue = startValue === 'on' ? 'off' : 'on';
        await markDocument(popup);

        await settings.set({ dsWebSearchToggle: otherValue });
        await expect(radio(popup, 'websearchToggle', otherValue), `the web-search ${otherValue} radio becomes checked live`).toBeChecked();
        await expect(radio(popup, 'websearchToggle', startValue), `the web-search ${startValue} radio is unchecked`).not.toBeChecked();
        await expectSameDocument(popup);
    });

    test('writing isReplyNotificationEnabled while the popup is open checks the matching reply-notification radio without a reload', async ({ context, settings, extensionId }) => {
        const popup = await openPopup(context, extensionId);
        const startValue = await checkedRadioValue(popup, 'replyNotificationToggle');
        expect(['on', 'off'], 'one reply-notification radio is checked (precondition)').toContain(startValue);
        const otherValue = startValue === 'on' ? 'off' : 'on';
        await markDocument(popup);

        await settings.set({ isReplyNotificationEnabled: otherValue === 'on' });
        await expect(radio(popup, 'replyNotificationToggle', otherValue), `the reply-notification ${otherValue} radio becomes checked live`).toBeChecked();
        await expect(radio(popup, 'replyNotificationToggle', startValue), `the reply-notification ${startValue} radio is unchecked`).not.toBeChecked();
        await expectSameDocument(popup);
    });
});
