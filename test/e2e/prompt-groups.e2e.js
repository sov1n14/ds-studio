import { test, expect } from './fixtures.js';
import { CONVERSATIONS, DEEPSEEK_ORIGIN } from './helpers/conversations.js';
import {
    addGroupInPopup, closeEditorWithEscape, closeExtensionPages, openEditorWith, openPopup, openPopupGroupList,
    popupGroupNames, popupGroupRow, popupPickedGroup, popupPinButton,
} from './helpers/popup.js';
import { createTestPreset, expectOverlayNeverShows, pickPreset, presetOverlay, seedOnlyPreset, seedOnlyPresets, trackPresetsCreatedDuringTest } from './helpers/presets.js';
import { documentedPrompt, gotoWithOverlay, openBlockingSends, sendAndCapturePrompt } from './helpers/prompt-capture.js';

// Managing Prompt Groups in the popup (docs/FEATURES.md, Managing Prompt Groups; docs/spec/01-prompt-system.md sections 1 and 6; docs/spec/02-popup-ui.md sections 7 and 15).
// The popup page is opened in a tab; every send request is aborted in the browser, and every touched storage key (plus each group the popup creates) is restored after the test.

const USER_TEXT = 'e2e prompt group probe (aborted before it leaves the browser)';

/** Opens a new tab on the DeepSeek home page (a new conversation), runs `check(tab)`, then closes the tab. */
async function inNewHomeTab(context, check) {
    const tab = await context.newPage();
    try {
        await gotoWithOverlay(tab, DEEPSEEK_ORIGIN + '/');
        await check(tab);
    } finally {
        await tab.close();
    }
}

test.describe('managing prompt groups in the popup', () => {
    test.beforeEach(async ({ settings }) => {
        await settings.set({ isEnabled: true, globalPromptEnabled: false });
        await settings.setInBothAreas({ dsShowSystemTime: false });
    });

    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('a group added with + and edited in its editor window appears in the in-page overlay and its content is sent', async ({ page, context, settings, extensionId }) => {
        const existing = createTestPreset('existing');
        const stamp = Date.now();
        const addedName = 'E2E added ' + stamp;
        const renamed = addedName + ' renamed';
        const addedContent = 'E2E-ADDED-GROUP-CONTENT-' + stamp;
        await seedOnlyPreset(settings, context, existing);
        await trackPresetsCreatedDuringTest(settings);
        const blocked = await openBlockingSends(page);

        const popup = await openPopup(context, extensionId);
        await addGroupInPopup(popup, addedName);
        await expect(popupPickedGroup(popup), 'the popup picks the group it just added').toHaveText(addedName);
        await expect(popup.locator('#editPresetBtn'), 'the pencil is enabled for the picked group').toBeEnabled();

        const editor = await openEditorWith(context, popup.locator('#editPresetBtn'));
        await expect(editor.locator('#editorNameInput'), 'the editor shows the added group name').toHaveValue(addedName);
        await editor.locator('#editorTextarea').fill(addedContent);
        await editor.locator('#editorNameInput').fill(renamed);
        await openPopupGroupList(popup);
        await expect(popupGroupRow(popup, renamed), 'the editor auto-saves the new name and the open popup list shows it').toHaveCount(1);
        await closeEditorWithEscape(editor);

        await pickPreset(page, { name: renamed });
        const prompt = await sendAndCapturePrompt(page, blocked, USER_TEXT);
        expect(prompt, 'the sent prompt carries the content written in the editor window, then the typed text').toBe(documentedPrompt({ reminder: addedContent, text: USER_TEXT }));
    });

    test('pinning a group preselects it on new conversations only, one group at a time, and unpinning restores the blank option', async ({ context, settings, extensionId }) => {
        const first = createTestPreset('pin-first');
        const second = createTestPreset('pin-second');
        await seedOnlyPresets(settings, context, [first, second]);

        const popup = await openPopup(context, extensionId);
        await openPopupGroupList(popup);
        await (await popupPinButton(popup, first.name)).click();
        await expect(await popupPinButton(popup, first.name), 'the clicked pin lights up').toHaveAttribute('aria-pressed', 'true');

        await inNewHomeTab(context, async (tab) => {
            await expect(presetOverlay(tab), 'a new conversation opens with the pinned group').toContainText(first.name);
            await gotoWithOverlay(tab, `${DEEPSEEK_ORIGIN}/a/chat/s/${CONVERSATIONS.fiveThinkingReplies}`);
            await expectOverlayNeverShows(tab, first.name, 'an existing unbound conversation never takes the pinned group');
        });

        await (await popupPinButton(popup, second.name)).click();
        await expect(await popupPinButton(popup, second.name), 'pinning another group lights its pin').toHaveAttribute('aria-pressed', 'true');
        await expect(await popupPinButton(popup, first.name), 'pinning another group moves the default away from the first').toHaveAttribute('aria-pressed', 'false');
        await inNewHomeTab(context, async (tab) => {
            await expect(presetOverlay(tab), 'a new conversation opens with the newly pinned group').toContainText(second.name);
        });

        await (await popupPinButton(popup, second.name)).click();
        await expect(await popupPinButton(popup, second.name), 'clicking the lit pin again turns it off').toHaveAttribute('aria-pressed', 'false');
        await inNewHomeTab(context, async (tab) => {
            await expectOverlayNeverShows(tab, second.name, 'with no default a new conversation preselects no group');
            await expectOverlayNeverShows(tab, first.name, 'with no default a new conversation preselects no group');
        });
    });

    test('dragging a group by its handle reorders the popup list, and the order is kept after reopening the popup', async ({ context, settings, extensionId }) => {
        const groups = ['drag-a', 'drag-b', 'drag-c'].map((label) => createTestPreset(label));
        const [first, middle, last] = groups;
        await seedOnlyPresets(settings, context, groups);

        const popup = await openPopup(context, extensionId);
        await openPopupGroupList(popup);
        expect(await popupGroupNames(popup), 'the list starts in the seeded order (precondition)').toEqual([first.name, middle.name, last.name]);

        const handle = await popupGroupRow(popup, last.name).locator('.ds-select__drag-handle').boundingBox();
        const target = await popupGroupRow(popup, first.name).boundingBox();
        const startX = handle.x + handle.width / 2;
        const startY = handle.y + handle.height / 2;
        await popup.mouse.move(startX, startY);
        await popup.mouse.down();
        await popup.mouse.move(startX, startY - 10, { steps: 5 });
        await popup.mouse.move(startX, target.y + 2, { steps: 10 });
        await popup.mouse.up();

        const dragged = [last.name, first.name, middle.name];
        await expect.poll(() => popupGroupNames(popup), { message: 'dropping the last group on top of the first moves it to the top' }).toEqual(dragged);

        await popup.close();
        const reopened = await openPopup(context, extensionId);
        await openPopupGroupList(reopened);
        expect(await popupGroupNames(reopened), 'the reopened popup keeps the dragged order').toEqual(dragged);
    });
});

test.describe('prompt group editor window', () => {
    test.afterEach(async ({ context }) => {
        await closeExtensionPages(context);
    });

    test('Esc pressed right after typing saves the typed name and content before the editor window closes', async ({ context, settings, extensionId }) => {
        const stamp = Date.now();
        const addedName = 'E2E esc ' + stamp;
        const renamed = addedName + ' renamed';
        await seedOnlyPreset(settings, context, createTestPreset('esc-existing'));
        await trackPresetsCreatedDuringTest(settings);
        await settings.set({ isEnabled: true });

        const popup = await openPopup(context, extensionId);
        await addGroupInPopup(popup, addedName);
        const editor = await openEditorWith(context, popup.locator('#editPresetBtn'));
        await expect(editor.locator('#editorNameInput'), 'the editor shows the added group name (precondition)').toHaveValue(addedName);
        await editor.locator('#editorTextarea').fill('E2E-ESC-CONTENT-' + stamp);
        await editor.locator('#editorNameInput').fill(renamed);
        await closeEditorWithEscape(editor);

        await openPopupGroupList(popup);
        await expect(popupGroupRow(popup, renamed), 'the name typed just before Esc was saved').toHaveCount(1);
    });
});
