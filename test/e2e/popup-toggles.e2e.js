import { test, expect } from './fixtures.js';
import { evaluateInWorker } from './helpers/extension.js';
import { clickPopupSwitch, closeExtensionPages, openPopup, waitForPopupFullyBound } from './helpers/popup.js';
import { readBothAreas } from './helpers/settings.js';

// Popup feature controls (docs/FEATURES.md): a click in the popup saves the setting to its storage area(s), and a popup opened afterwards shows the saved state.
// Synced settings land in chrome.storage.sync and chrome.storage.local; device settings (master switch, reply notification) land in local only and leave sync untouched.
// Popup only: no DeepSeek page is opened. Each test flips the control from whatever the profile holds, and the settings fixture restores every tracked key afterwards.
// Permission-gated controls are tested only when the profile has already granted the permission: a permission prompt cannot be driven, so a missing grant skips the test.

const SYNC_AND_LOCAL = ['sync', 'local'];
const LOCAL_ONLY = ['local'];
// Keys the extension sync writer may update next to the saved key.
const WRITER_SIDE_KEYS = ['dsLocalAuth', 'syncConflictPending', 'dsOversizedKeys'];
const STORAGE_TIMEOUT_MS = 10_000;

const CHECKBOX_ROWS = [
    { control: 'includeThinkingToggle', key: 'includeThinking', areas: SYNC_AND_LOCAL },
    { control: 'includeReferencesToggle', key: 'includeReferences', areas: SYNC_AND_LOCAL },
    { control: 'sidebarAutoHideToggle', key: 'dsSidebarAutoHide', areas: SYNC_AND_LOCAL },
    { control: 'hideThinkingToggle', key: 'dsHideThinking', areas: SYNC_AND_LOCAL },
    { control: 'showSystemTimeToggle', key: 'dsShowSystemTime', areas: SYNC_AND_LOCAL },
    { control: 'preventAutoScrollToggle', key: 'dsPreventAutoScroll', areas: SYNC_AND_LOCAL },
    { control: 'autoExpandMessagesToggle', key: 'dsAutoExpandMessages', areas: SYNC_AND_LOCAL },
    { control: 'autoRetryToggle', key: 'isAutoRetryEnabled', areas: SYNC_AND_LOCAL },
    { control: 'autoContinueToggle', key: 'isAutoContinueEnabled', areas: SYNC_AND_LOCAL },
    { control: 'autoOpenSidebarToggle', key: 'isAutoOpenSidebarEnabled', areas: SYNC_AND_LOCAL },
    { control: 'chatWidthToggle', key: 'dsChatWidthEnabled', areas: SYNC_AND_LOCAL },
    { control: 'inputWidthToggle', key: 'dsInputWidthEnabled', areas: SYNC_AND_LOCAL },
    { control: 'enableToggle', key: 'isEnabled', areas: LOCAL_ONLY },
];

const SLIDER_ROWS = [
    { slider: 'chatWidthSlider', label: 'chatWidthValue', toggle: 'chatWidthToggle', key: 'dsChatWidth', enabledKey: 'dsChatWidthEnabled' },
    { slider: 'inputWidthSlider', label: 'inputWidthValue', toggle: 'inputWidthToggle', key: 'dsInputWidth', enabledKey: 'dsInputWidthEnabled' },
];

const CLIPBOARD_PERMISSIONS = ['clipboardWrite', 'offscreen'];
const NOTIFICATION_PERMISSIONS = ['notifications'];

const AUTO_COPY_ROWS = [
    { control: 'autoCopyReplyToggle', key: 'isAutoCopyReplyEnabled', intentKey: 'dsPermissionIntent_autoCopyReply' },
    { control: 'autoCopyCodeToggle', key: 'isAutoCopyCodeEnabled', intentKey: 'dsPermissionIntent_autoCopyCode' },
];

/** Clicks a popup checkbox the way a user does: the header switch for the master switch, the checkbox label otherwise. */
async function clickCheckbox(popup, id) {
    if (id === 'enableToggle') {
        await clickPopupSwitch(popup, id);
        return;
    }
    await popup.locator(`label[for="${id}"]`).click();
}

function radio(popup, name, value) {
    return popup.locator(`input[name="${name}"][value="${value}"]`);
}

/** The value of the checked radio in group `name`. */
function checkedRadioValue(popup, name) {
    return popup.locator(`input[name="${name}"]:checked`).getAttribute('value');
}

/** Whether every permission in `permissions` is granted to the extension. */
function hasPermissions(context, permissions) {
    return evaluateInWorker(context, (list) => chrome.permissions.contains({ permissions: list }), permissions);
}

/**
 * Polls storage until `key` holds `expected` in every area of `areas`; an area outside `areas` must still hold its value from `before`.
 * @param {{local: object, sync: object}} before - both areas read before the click
 */
async function expectStored(context, key, areas, expected, before, message) {
    const wanted = {
        local: areas.includes('local') ? expected : before.local[key],
        sync: areas.includes('sync') ? expected : before.sync[key],
    };
    await expect.poll(async () => {
        const now = await readBothAreas(context, [key]);
        return { local: now.local[key], sync: now.sync[key] };
    }, { message, timeout: STORAGE_TIMEOUT_MS }).toEqual(wanted);
}

/** Closes `popup` and opens a fresh one. */
async function reopenPopup(popup, context, extensionId) {
    await popup.close();
    return openPopup(context, extensionId);
}

test.describe('popup toggles save and persist', () => {
    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    for (const { control, key, areas } of CHECKBOX_ROWS) {
        const areaLabel = areas.length === 2 ? 'sync and local' : 'local only';
        test(`${control} saves ${key} (${areaLabel}) and the reopened popup shows the saved state`, async ({ context, settings, extensionId }) => {
            await settings.set({ isEnabled: true });
            await settings.track([key, ...WRITER_SIDE_KEYS]);
            const before = await readBothAreas(context, [key]);

            let popup = await openPopup(context, extensionId);
            await waitForPopupFullyBound(popup);
            const wasChecked = await popup.locator('#' + control).isChecked();
            if (control === 'enableToggle') expect(wasChecked, 'the master switch shows the seeded on state (precondition)').toBe(true);

            await clickCheckbox(popup, control);
            await expect(popup.locator('#' + control), `${control} flips on click`).toBeChecked({ checked: !wasChecked });
            await expectStored(context, key, areas, !wasChecked, before, `${key} is saved as ${!wasChecked} in ${areaLabel}`);

            popup = await reopenPopup(popup, context, extensionId);
            await expect(popup.locator('#' + control), `the reopened popup shows ${control} ${wasChecked ? 'unchecked' : 'checked'}`).toBeChecked({ checked: !wasChecked });
        });
    }

    test('websearchToggle radios save each choice to dsWebSearchToggle (sync and local) and the reopened popup shows it', async ({ context, settings, extensionId }) => {
        const key = 'dsWebSearchToggle';
        await settings.set({ isEnabled: true });
        await settings.track([key, ...WRITER_SIDE_KEYS]);
        const before = await readBothAreas(context, [key]);

        let popup = await openPopup(context, extensionId);
        const startValue = await checkedRadioValue(popup, 'websearchToggle');
        expect(['on', 'off'], 'one web-search radio is checked (precondition)').toContain(startValue);
        const otherValue = startValue === 'on' ? 'off' : 'on';

        for (const value of [otherValue, startValue]) {
            await radio(popup, 'websearchToggle', value).click();
            await expect(radio(popup, 'websearchToggle', value), `the ${value} radio becomes checked`).toBeChecked();
            await expectStored(context, key, SYNC_AND_LOCAL, value, before, `${key} is saved as ${value} in sync and local`);
            popup = await reopenPopup(popup, context, extensionId);
            await expect(radio(popup, 'websearchToggle', value), `the reopened popup shows the ${value} radio checked`).toBeChecked();
        }
    });

    for (const { slider, label, toggle, key, enabledKey } of SLIDER_ROWS) {
        test(`#${slider} saves ${key} (sync and local) after the debounce, shows the percentage, and the reopened popup shows it`, async ({ context, settings, extensionId }) => {
            await settings.set({ isEnabled: true });
            await settings.track([key, enabledKey, ...WRITER_SIDE_KEYS]);
            const before = await readBothAreas(context, [key]);

            let popup = await openPopup(context, extensionId);
            await waitForPopupFullyBound(popup);
            // The slider is collapsed while its width feature is off, so the user turns the feature on first.
            if (!(await popup.locator('#' + toggle).isChecked())) {
                await clickCheckbox(popup, toggle);
                await expect(popup.locator('#' + toggle), `${toggle} turns on to expand the slider (precondition)`).toBeChecked();
            }
            const target = (await popup.locator('#' + slider).inputValue()) === '55' ? '56' : '55';

            await popup.locator('#' + slider).fill(target);
            await expect(popup.locator('#' + label), `#${label} shows the slider value`).toHaveText(`${target}%`);
            await expectStored(context, key, SYNC_AND_LOCAL, Number(target), before, `${key} is saved as ${target} in sync and local`);

            popup = await reopenPopup(popup, context, extensionId);
            await expect(popup.locator('#' + slider), `the reopened popup sets #${slider} to ${target}`).toHaveValue(target);
            await expect(popup.locator('#' + label), `the reopened popup shows ${target}% in #${label}`).toHaveText(`${target}%`);
        });
    }

    for (const { control, key, intentKey } of AUTO_COPY_ROWS) {
        test(`${control} with clipboard permission granted saves ${key} = true (sync and local) and the reopened popup shows it checked`, async ({ context, settings, extensionId }) => {
            const isGranted = await hasPermissions(context, CLIPBOARD_PERMISSIONS);
            test.skip(isGranted === false, `optional permissions ${CLIPBOARD_PERMISSIONS.join(' + ')} are not granted in .browser-profile; turning ${control} on would open a permission prompt`);
            await settings.set({ isEnabled: true });
            await settings.track([key, intentKey, ...WRITER_SIDE_KEYS]);
            const before = await readBothAreas(context, [key]);

            let popup = await openPopup(context, extensionId);
            await waitForPopupFullyBound(popup);
            if (await popup.locator('#' + control).isChecked()) {
                await clickCheckbox(popup, control);
                await expectStored(context, key, SYNC_AND_LOCAL, false, before, `${key} is first turned off so the on-state can be tested (precondition)`);
            }

            await clickCheckbox(popup, control);
            await expect(popup.locator('#' + control), `${control} stays checked after the click`).toBeChecked();
            await expectStored(context, key, SYNC_AND_LOCAL, true, before, `${key} is saved as true in sync and local`);

            popup = await reopenPopup(popup, context, extensionId);
            await expect(popup.locator('#' + control), `the reopened popup shows ${control} checked`).toBeChecked();
        });
    }

    test('reply-notification on radio with notification permission granted saves isReplyNotificationEnabled = true (local only) and the reopened popup shows it', async ({ context, settings, extensionId }) => {
        const isGranted = await hasPermissions(context, NOTIFICATION_PERMISSIONS);
        test.skip(isGranted === false, 'optional permission notifications is not granted in .browser-profile; choosing on would open a permission prompt');
        const key = 'isReplyNotificationEnabled';
        await settings.set({ isEnabled: true });
        await settings.track([key, 'dsPermissionIntent_replyNotification', ...WRITER_SIDE_KEYS]);
        const before = await readBothAreas(context, [key]);

        let popup = await openPopup(context, extensionId);
        if (await checkedRadioValue(popup, 'replyNotificationToggle') === 'on') {
            await radio(popup, 'replyNotificationToggle', 'off').click();
            await expectStored(context, key, LOCAL_ONLY, false, before, `${key} is first turned off so the on-state can be tested (precondition)`);
        }

        await radio(popup, 'replyNotificationToggle', 'on').click();
        await expect(radio(popup, 'replyNotificationToggle', 'on'), 'the on radio stays checked after the click').toBeChecked();
        await expectStored(context, key, LOCAL_ONLY, true, before, `${key} is saved as true in local and sync is left untouched`);

        popup = await reopenPopup(popup, context, extensionId);
        await expect(radio(popup, 'replyNotificationToggle', 'on'), 'the reopened popup shows the on radio checked').toBeChecked();
    });
});
