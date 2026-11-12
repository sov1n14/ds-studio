// The extension popup opened as a tab, its prompt-group dropdown, and the editor windows it opens.

import { expect } from '@playwright/test';
import { evaluateInWorker, findTabId, listWindows } from './extension.js';
import { humanType } from './human.js';

const EXTENSION_SCHEME = 'chrome-extension://';
const POPUP_PATH = 'popup/popup.html';
const EDITOR_PATH = '/popup/editor/editor.html';

/**
 * Opens the popup page in a new tab and waits until its prompt-group dropdown has rendered (every popup control is bound by then).
 * The popup resolves "the current DeepSeek tab" as the active DeepSeek tab of its window, so with `activeTabUrlPart` the DeepSeek tab whose URL contains it is made active before the popup loads (the popup tab then stays in the background, as the real popup sits over that tab).
 * @returns {Promise<import('@playwright/test').Page>}
 */
export async function openPopup(context, extensionId, { activeTabUrlPart } = {}) {
    const popup = await context.newPage();
    if (activeTabUrlPart) {
        const tabId = await findTabId(context, activeTabUrlPart);
        await evaluateInWorker(context, (id) => chrome.tabs.update(id, { active: true }), tabId);
    }
    await popup.goto(`${EXTENSION_SCHEME}${extensionId}/${POPUP_PATH}`);
    await expect(popup.locator('#presetSelectValue'), 'the popup has rendered its prompt-group dropdown (precondition)').not.toHaveText('');
    return popup;
}

/** Closes every extension page (popups, editor windows) still open, so no extension page reacts to the storage restore that follows the test. */
export async function closeExtensionPages(context) {
    for (const extensionPage of context.pages().filter((p) => p.url().startsWith(EXTENSION_SCHEME))) {
        await extensionPage.close();
    }
}

/** The text of the popup dropdown trigger (the picked group's name, or the blank-option label). */
export function popupPickedGroup(popup) {
    return popup.locator('#presetSelectValue');
}

/** Opens the popup dropdown panel when it is closed. */
export async function openPopupGroupList(popup) {
    const panel = popup.locator('#presetSelectPanel');
    if (!(await panel.isVisible())) await popup.locator('#presetSelect').click();
    await expect(panel, 'the popup group list opens').toBeVisible();
}

/** The dropdown row of the group named `name` (the panel must be open). */
export function popupGroupRow(popup, name) {
    return popup.locator('#presetSelectList [role="option"]').filter({ has: popup.locator('.ds-select__item-name', { hasText: name }) });
}

/** The names of the groups listed in the dropdown, top to bottom (the panel must be open). */
export function popupGroupNames(popup) {
    return popup.locator('#presetSelectList [role="option"] .ds-select__item-name').allTextContents();
}

/** The pin (set as default) button of the group named `name`; it appears on row hover, so the row is hovered first. */
export async function popupPinButton(popup, name) {
    const row = popupGroupRow(popup, name);
    await row.hover();
    return row.locator('.ds-select__item-btn--pin');
}

/** The names of the groups the dropdown currently shows (rows hidden by the search filter are left out), top to bottom (the panel must be open). */
export function popupVisibleGroupNames(popup) {
    return popup.locator('#presetSelectList [role="option"]:visible .ds-select__item-name').allTextContents();
}

/** The blank "(No Prompt Group)" row at the top of the dropdown panel. */
export function popupBlankRow(popup) {
    return popup.locator('#presetSelectPanel .ds-select__item--empty');
}

/** The localized label of the blank option, read from its own row, so a spec compares the picked label with it instead of a hardcoded string. */
export async function popupBlankLabel(popup) {
    return (await popupBlankRow(popup).locator('.ds-select__item-name').textContent()).trim();
}

/** Picks the group named `name` by clicking its row name in the dropdown, and waits until the trigger shows it. */
export async function pickGroupInPopup(popup, name) {
    await openPopupGroupList(popup);
    await popupGroupRow(popup, name).locator('.ds-select__item-name').click();
    await expect(popupPickedGroup(popup), 'the popup trigger shows the picked group').toHaveText(name);
}

/** The delete (✕) button of the group named `name`; it appears on row hover, so the row is hovered first. */
export async function popupDeleteButton(popup, name) {
    const row = popupGroupRow(popup, name);
    await row.hover();
    return row.locator('.ds-select__item-btn--delete');
}

/** The delete-all (✕) button of the blank row; it appears on row hover, so the row is hovered first. */
export async function popupDeleteAllButton(popup) {
    const row = popupBlankRow(popup);
    await row.hover();
    return row.locator('.ds-select__item-btn--delete-all');
}

/** Answers the open confirmation dialog with its danger (confirm) button when `isConfirmed`, else with its other (cancel) button, and waits until the dialog closes. */
export async function answerPopupConfirmation(popup, isConfirmed) {
    await expect(popup.locator('#modalOverlay'), 'the confirmation dialog opens').toBeVisible();
    const actions = popup.locator('#modalActions');
    await expect(actions.locator('.modal-btn'), 'the confirmation offers cancel and a danger confirm').toHaveCount(2);
    await (isConfirmed ? actions.locator('.modal-btn--danger') : actions.locator('.modal-btn:not(.modal-btn--danger)')).click();
    await expect(popup.locator('#modalOverlay'), 'the confirmation dialog closes').toBeHidden();
}

/** Adds a group named `name` through the popup "+" button and its naming dialog. */
export async function addGroupInPopup(popup, name) {
    await popup.locator('#addPresetBtn').click();
    const input = popup.locator('#modalInput');
    await expect(input, 'the naming dialog opens').toBeVisible();
    await humanType(input, name);
    await popup.locator('#modalActions .modal-btn--primary').click();
    await expect(popup.locator('#modalOverlay'), 'the naming dialog closes').toBeHidden();
}

/** Clicks `button` in the popup and resolves the editor window it opens, once it has loaded its target. */
export async function openEditorWith(context, button) {
    const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/popup/editor/editor.html') });
    await button.click();
    const editor = await opened;
    // The editor fills the placeholder in the same step that binds its auto-save listeners, so typing after this point is saved.
    await expect(editor.locator('#editorTextarea'), 'the editor window has loaded its target and bound auto-save').toHaveAttribute('placeholder', /\S/);
    return editor;
}

/**
 * Types `text` into the editor textarea and resolves once the editor reports the auto-save finished (its status turns to the localized "saved" text).
 * The status shows "saved" for only one second, so a MutationObserver installed before typing records it instead of polling for it.
 * Esc right after typing loses the typed text (reported deviation), so a spec waits for this before closing the window.
 * The text is pasted in one step, not typed: think pauses longer than the 500 ms auto-save debounce would save a partial text first, and the first "saved" status recorded here would then not cover the whole text.
 */
export async function fillEditorAndWaitForSave(editor, text) {
    await editor.evaluate(() => {
        const status = document.getElementById('editorSaveStatus');
        window.__dssE2eSaved = false;
        new MutationObserver(() => {
            const isShown = !status.classList.contains('save-status--hidden') && !status.classList.contains('save-status--error');
            if (isShown && status.textContent === dsI18n.t('savedStatus')) window.__dssE2eSaved = true;
        }).observe(status, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    await editor.locator('#editorTextarea').fill(text);
    await editor.waitForFunction(() => window.__dssE2eSaved === true, null, { timeout: 15_000 });
}

/** Presses Esc in the editor window, which saves unsaved content and closes the window; resolves once the window is closed. */
export async function closeEditorWithEscape(editor) {
    const closed = editor.waitForEvent('close');
    // The window closes on keydown, so the key-up half of the press can find the page already gone.
    await editor.keyboard.press('Escape').catch((error) => {
        if (!editor.isClosed()) throw error;
    });
    await closed;
}

/** Clicks the switch (the visible label wrapping the hidden checkbox `checkboxId`) in the popup. */
export async function clickPopupSwitch(popup, checkboxId) {
    await popup.locator('label.switch', { has: popup.locator('#' + checkboxId) }).click();
}

/**
 * Resolves once the popup has bound its width sliders, the last controls it binds; every other control is bound by then too.
 * `openPopup` returns before that (the popup awaits a storage read between binding the toggles and binding the sliders), so a spec that changes a width control waits for this first.
 * The probe clears the input-width label and fires `input` on its slider: a bound slider writes its value back into the label, an unbound one leaves it blank and the probe puts the old text back.
 */
export async function waitForPopupFullyBound(popup) {
    await popup.waitForFunction(() => {
        const slider = document.getElementById('inputWidthSlider');
        const label = document.getElementById('inputWidthValue');
        const shownText = label.textContent;
        label.textContent = '';
        slider.dispatchEvent(new Event('input'));
        const isBound = label.textContent !== '';
        if (!isBound) label.textContent = shownText;
        return isBound;
    }, null, { timeout: 15_000 });
}

/** 目前開著的編輯器視窗（分頁網址含編輯器頁面路徑的視窗），每筆含 `id`、`focused` 與該視窗的編輯器網址 `url`。 */
export async function listEditorWindows(context) {
    return (await listWindows(context))
        .filter((win) => win.tabUrls.some((url) => url.includes(EDITOR_PATH)))
        .map((win) => ({ id: win.id, focused: win.focused, url: win.tabUrls.find((url) => url.includes(EDITOR_PATH)) }));
}
