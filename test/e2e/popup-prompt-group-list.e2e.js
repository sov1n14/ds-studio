import { test, expect } from './fixtures.js';
import {
    answerPopupConfirmation, closeExtensionPages, openPopup, openPopupGroupList, pickGroupInPopup, popupBlankLabel, popupBlankRow,
    popupDeleteAllButton, popupDeleteButton, popupGroupNames, popupGroupRow, popupPickedGroup, popupPinButton, popupVisibleGroupNames,
} from './helpers/popup.js';
import { createTestPreset, expectOverlayNeverShows, presetOverlay, seedOnlyPresets } from './helpers/presets.js';
import { inNewHomeTab } from './helpers/prompt-capture.js';
import { expectNoPageWithin } from './helpers/observation.js';
import { readBothAreas } from './helpers/settings.js';

// The popup prompt-group list: search filter, delete one, delete all, the pin after a delete, and the pencil with the blank option.
// Sources: docs/FEATURES.md lines 38, 42, 43, 47, 50 and 75; docs/spec/01-prompt-system.md lines 13, 14 and 100; docs/spec/02-popup-ui.md lines 10 and 11; docs/architecture/POPUP.md line 19.
// Every group is seeded by the test, so a delete never touches the profile's own groups; every touched storage key is restored after the test.

const EDITOR_PATH = '/popup/editor/editor.html';
// How long a click on the disabled pencil is watched to prove it opens no editor window.
const NO_EDITOR_WINDOW_MS = 2_000;

/** Polls `pinnedPresetId` in both storage areas until it equals `expected` in each. */
async function expectPinnedIdInBothAreas(context, expected, message) {
    await expect.poll(async () => {
        const { local, sync } = await readBothAreas(context, ['pinnedPresetId']);
        return { local: local.pinnedPresetId, sync: sync.pinnedPresetId };
    }, { message }).toEqual({ local: expected, sync: expected });
}

test.describe('popup prompt group list', () => {
    test.beforeEach(async ({ settings }) => {
        await settings.set({ isEnabled: true });
    });

    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('search filter narrows the listed groups by name, shows the no-match hint, restores every group when cleared, and keeps the picked group', async ({ context, settings, extensionId }) => {
        const groups = ['search-apple', 'search-banana', 'search-cherry'].map((label) => createTestPreset(label));
        const [apple, banana, cherry] = groups;
        const allNames = groups.map((group) => group.name);
        await seedOnlyPresets(settings, context, groups);

        const popup = await openPopup(context, extensionId);
        await pickGroupInPopup(popup, apple.name);
        await openPopupGroupList(popup);
        const search = popup.locator('#presetSearchInput');
        const emptyHint = popup.locator('#presetSelectEmptyHint');
        expect(await popupVisibleGroupNames(popup), 'every seeded group is listed before any search (precondition)').toEqual(allNames);

        // docs/FEATURES.md:38 and docs/spec/02-popup-ui.md:10: typing filters the group names in real time.
        await search.fill('banana');
        await expect.poll(() => popupVisibleGroupNames(popup), { message: 'a keyword lists only the group whose name contains it' }).toEqual([banana.name]);
        await expect(emptyHint, 'the no-match hint stays hidden while a group matches').toBeHidden();

        await search.fill('search-');
        await expect.poll(() => popupVisibleGroupNames(popup), { message: 'a keyword shared by every name lists every group' }).toEqual(allNames);

        await search.fill('zzqx-nomatch');
        await expect.poll(() => popupVisibleGroupNames(popup), { message: 'a keyword no name contains lists no group' }).toEqual([]);
        await expect(emptyHint, 'a keyword no name contains shows the no-match hint').toBeVisible();

        await search.fill('cherry');
        await expect.poll(() => popupVisibleGroupNames(popup), { message: 'a new keyword after a no-match lists its group again' }).toEqual([cherry.name]);
        await expect(emptyHint, 'the no-match hint hides again once a group matches').toBeHidden();

        await search.fill('');
        await expect.poll(() => popupVisibleGroupNames(popup), { message: 'clearing the search lists every group again, in order' }).toEqual(allNames);
        await expect(popupPickedGroup(popup), 'filtering never changes the picked group').toHaveText(apple.name);
    });

    test('deleting a group with its row ✕ asks for confirmation: cancel keeps it, confirm removes it, also after reopening the popup', async ({ context, settings, extensionId }) => {
        const groups = ['delete-keep', 'delete-gone'].map((label) => createTestPreset(label));
        const [kept, deleted] = groups;
        await seedOnlyPresets(settings, context, groups);

        const popup = await openPopup(context, extensionId);
        await openPopupGroupList(popup);

        // docs/FEATURES.md:43, docs/spec/01-prompt-system.md:13 and docs/architecture/POPUP.md:19: the row ✕ opens a confirmation with a danger-styled confirm button.
        await (await popupDeleteButton(popup, deleted.name)).click();
        await answerPopupConfirmation(popup, false);
        await openPopupGroupList(popup);
        expect(await popupGroupNames(popup), 'cancelling the confirmation keeps every group').toEqual([kept.name, deleted.name]);

        await (await popupDeleteButton(popup, deleted.name)).click();
        await answerPopupConfirmation(popup, true);
        await openPopupGroupList(popup);
        await expect(popupGroupRow(popup, deleted.name), 'confirming removes the group from the list').toHaveCount(0);
        expect(await popupGroupNames(popup), 'confirming removes only the deleted group').toEqual([kept.name]);

        await popup.close();
        const reopened = await openPopup(context, extensionId);
        await openPopupGroupList(reopened);
        expect(await popupGroupNames(reopened), 'the reopened popup no longer lists the deleted group').toEqual([kept.name]);
    });

    test('deleting the picked group leaves the blank option picked and the pencil disabled', async ({ context, settings, extensionId }) => {
        const groups = ['active-other', 'active-picked'].map((label) => createTestPreset(label));
        const [other, picked] = groups;
        await seedOnlyPresets(settings, context, groups);

        const popup = await openPopup(context, extensionId);
        const blankLabel = await popupBlankLabel(popup);
        await pickGroupInPopup(popup, picked.name);
        await expect(popup.locator('#editPresetBtn'), 'the pencil is enabled while a group is picked (precondition)').toBeEnabled();

        await openPopupGroupList(popup);
        await (await popupDeleteButton(popup, picked.name)).click();
        await answerPopupConfirmation(popup, true);

        // docs/spec/01-prompt-system.md:13 and line 100: deleting the active group resets to the empty state instead of picking another group.
        await expect(popupPickedGroup(popup), 'the trigger shows the blank option, not the remaining group').toHaveText(blankLabel);
        // docs/FEATURES.md:42: the pencil is disabled when no group is selected.
        await expect(popup.locator('#editPresetBtn'), 'the pencil is disabled once the picked group is deleted').toBeDisabled();
        await openPopupGroupList(popup);
        expect(await popupGroupNames(popup), 'the other group is still listed').toEqual([other.name]);
    });

    test('delete all from the blank row asks for confirmation: cancel keeps every group, confirm empties the list, picks the blank option and disables the pencil', async ({ context, settings, extensionId }) => {
        const groups = ['all-first', 'all-second'].map((label) => createTestPreset(label));
        await seedOnlyPresets(settings, context, groups);

        const popup = await openPopup(context, extensionId);
        const blankLabel = await popupBlankLabel(popup);
        await pickGroupInPopup(popup, groups[0].name);
        await openPopupGroupList(popup);

        // docs/FEATURES.md:50 and docs/spec/01-prompt-system.md:14: hovering the blank row reveals a delete-all button that deletes every group after a confirmation.
        await (await popupDeleteAllButton(popup)).click();
        await answerPopupConfirmation(popup, false);
        await openPopupGroupList(popup);
        expect(await popupGroupNames(popup), 'cancelling delete all keeps every group').toEqual(groups.map((group) => group.name));
        await expect(popupPickedGroup(popup), 'cancelling delete all keeps the picked group').toHaveText(groups[0].name);

        await (await popupDeleteAllButton(popup)).click();
        await answerPopupConfirmation(popup, true);
        await openPopupGroupList(popup);
        await expect.poll(() => popupGroupNames(popup), { message: 'confirming delete all empties the list' }).toEqual([]);
        await expect(popupBlankRow(popup), 'the blank option always stays in the list').toBeVisible();
        await expect(popupPickedGroup(popup), 'confirming delete all picks the blank option').toHaveText(blankLabel);
        // docs/FEATURES.md:42 and docs/spec/02-popup-ui.md:11: the pencil is disabled with the blank option.
        await expect(popup.locator('#editPresetBtn'), 'the pencil is disabled after delete all').toBeDisabled();

        await popup.close();
        const reopened = await openPopup(context, extensionId);
        await openPopupGroupList(reopened);
        expect(await popupGroupNames(reopened), 'the reopened popup lists no group').toEqual([]);
    });

    test('deleting another group keeps the pinned default, and deleting the pinned group clears it', async ({ context, settings, extensionId }) => {
        const groups = ['pin-kept', 'pin-other', 'pin-spare'].map((label) => createTestPreset(label));
        const [pinned, other, spare] = groups;
        await seedOnlyPresets(settings, context, groups);

        const popup = await openPopup(context, extensionId);
        await openPopupGroupList(popup);
        await (await popupPinButton(popup, pinned.name)).click();
        await expect(await popupPinButton(popup, pinned.name), 'the clicked pin lights up (precondition)').toHaveAttribute('aria-pressed', 'true');
        await expectPinnedIdInBothAreas(context, pinned.id, 'pinning stores the group id (precondition)');

        await (await popupDeleteButton(popup, other.name)).click();
        await answerPopupConfirmation(popup, true);
        await openPopupGroupList(popup);
        await expect(popupGroupRow(popup, other.name), 'the other group is deleted (precondition)').toHaveCount(0);
        // docs/FEATURES.md:47 and docs/spec/01-prompt-system.md:100 clear the default only when the deleted group is the default.
        await expect(await popupPinButton(popup, pinned.name), 'deleting another group keeps the pin lit').toHaveAttribute('aria-pressed', 'true');
        await inNewHomeTab(context, async (tab) => {
            await expect(presetOverlay(tab), 'a new conversation still opens with the pinned group').toContainText(pinned.name);
        });

        await (await popupDeleteButton(popup, pinned.name)).click();
        await answerPopupConfirmation(popup, true);
        // docs/FEATURES.md:47 and docs/spec/01-prompt-system.md:100: deleting the default group clears pinnedPresetId to an empty string.
        await expectPinnedIdInBothAreas(context, '', 'deleting the pinned group clears pinnedPresetId to an empty string');
        await inNewHomeTab(context, async (tab) => {
            await expectOverlayNeverShows(tab, pinned.name, 'a new conversation no longer opens with the deleted default');
        });
        await openPopupGroupList(popup);
        await expect(await popupPinButton(popup, spare.name), 'no remaining group inherits the pin').toHaveAttribute('aria-pressed', 'false');
    });

    test('delete all while a group is pinned clears the pinned default', async ({ context, settings, extensionId }) => {
        const groups = ['pinall-pinned', 'pinall-other'].map((label) => createTestPreset(label));
        await seedOnlyPresets(settings, context, groups);

        const popup = await openPopup(context, extensionId);
        await openPopupGroupList(popup);
        await (await popupPinButton(popup, groups[0].name)).click();
        await expect(await popupPinButton(popup, groups[0].name), 'the clicked pin lights up (precondition)').toHaveAttribute('aria-pressed', 'true');
        await expectPinnedIdInBothAreas(context, groups[0].id, 'pinning stores the group id (precondition)');

        await (await popupDeleteAllButton(popup)).click();
        await answerPopupConfirmation(popup, true);
        // docs/FEATURES.md:47 and docs/spec/01-prompt-system.md:100; docs/architecture/POPUP.md:19 applies the same pin clearing to delete all.
        await expectPinnedIdInBothAreas(context, '', 'delete all clears pinnedPresetId to an empty string');
        await inNewHomeTab(context, async (tab) => {
            await expectOverlayNeverShows(tab, groups[0].name, 'a new conversation no longer opens with the deleted default');
        });
    });

    test('the pencil is disabled with the blank option, opens no editor when clicked, and is disabled again after picking the blank row', async ({ context, settings, extensionId }) => {
        const groups = ['pencil-first', 'pencil-second'].map((label) => createTestPreset(label));
        await seedOnlyPresets(settings, context, groups);

        const popup = await openPopup(context, extensionId);
        const pencil = popup.locator('#editPresetBtn');
        const blankLabel = await popupBlankLabel(popup);
        await expect(popupPickedGroup(popup), 'the popup opens on the blank option (precondition)').toHaveText(blankLabel);

        // docs/FEATURES.md:42 and line 75, docs/spec/02-popup-ui.md:11: the pencil is disabled while the blank option is selected.
        await expect(pencil, 'the pencil is disabled with the blank option').toBeDisabled();
        const watching = expectNoPageWithin(context, EDITOR_PATH, NO_EDITOR_WINDOW_MS, 'clicking the disabled pencil opens no editor window');
        await pencil.click({ force: true });
        await watching;

        await pickGroupInPopup(popup, groups[1].name);
        await expect(pencil, 'picking a group enables the pencil (precondition)').toBeEnabled();

        await openPopupGroupList(popup);
        await popupBlankRow(popup).locator('.ds-select__item-name').click();
        await expect(popupPickedGroup(popup), 'picking the blank row shows the blank option').toHaveText(blankLabel);
        await expect(pencil, 'picking the blank row disables the pencil again').toBeDisabled();
    });
});
