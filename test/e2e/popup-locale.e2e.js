import { test as base, expect } from './fixtures.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { evaluateInExtensionOrigin } from './helpers/extension.js';
import { QUOTE_BUTTON_SELECTOR } from './helpers/extension-ui.js';
import { closeExtensionPages, openPopup } from './helpers/popup.js';
import { dragSelectTwoReplyParagraphs } from './helpers/quote.js';
import { readBothAreas, setSync } from './helpers/settings.js';

// The popup language switcher (docs/spec/02-popup-ui.md:14): the globe button #localeSwitcherBtn opens #localePanel, which switches between Traditional Chinese (zh_TW) and English (en); the popup reloads after switching (also docs/architecture/POPUP.md:302).
// The choice persists (docs/architecture/POPUP.md:300, docs/spec/05-data-storage.md:112): the extension keeps it in chrome.storage.sync under ds_studio_locale and mirrors it into the localStorage of each origin that loads i18n.js (the extension origin and the DeepSeek page), so a reopened popup shows the same language.
// Open DeepSeek pages follow without a reload (docs/architecture/POPUP.md:303, docs/architecture/content-interaction.md:55): the Quote Reply button label (docs/FEATURES.md:280) changes live.
// Every test snapshots the sync key, the extension-origin localStorage entry and, when a DeepSeek page is open, the DeepSeek-origin localStorage entry the content script mirrors into, and puts all of them back in fixture teardown, which runs even when the test fails or times out.
// The kept chat is only read (a text selection), never sent to, renamed or deleted.

const LOCALE_KEY = 'ds_studio_locale';
const RESTORE_ATTEMPTS = 5;
const RESTORE_SETTLE_MS = 500;

// Expected copy per locale: the labels are named in docs/spec/02-popup-ui.md:9 ("Global Prompt" label), docs/FEATURES.md:167 ("Collapse Thinking Process"), docs/spec/02-popup-ui.md:19 (Export button), docs/spec/02-popup-ui.md:14 (globe button) and docs/FEATURES.md:280 ("Quote Reply"); the exact strings are copied from utils/i18n.locales.zhTW.js and utils/i18n.locales.en.js (keys globalPromptLabel, hideThinkingLabel, exportMarkdownButton, switchLanguageTitle, quoteReplyBtnLabel).
const COPY = Object.freeze({
    zh_TW: Object.freeze({
        globalPrompt: '全域提示詞',
        collapseThinking: '隱藏思考過程',
        exportButton: '匯出當前頁面對話為 Markdown',
        switchLanguageTitle: '切換語言',
        quoteReply: '引用回覆',
    }),
    en: Object.freeze({
        globalPrompt: 'Global Prompt',
        collapseThinking: 'Collapse Thinking Process',
        exportButton: 'Export Current Page Conversation as Markdown',
        switchLanguageTitle: 'Switch Language',
        quoteReply: 'Quote Reply',
    }),
});

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Page function: the localStorage locale entry of the page origin, or null when absent. */
function readLocaleItem(key) {
    return localStorage.getItem(key);
}

/** Page function: puts the localStorage locale entry back to the saved value, removing it when that value is null. */
function writeLocaleItem({ key, value }) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
}

/** Asserts the popup shows the copy of `locale` on four documented controls. */
async function expectPopupInLocale(popup, locale, when) {
    const copy = COPY[locale];
    await expect(popup.locator('label[data-i18n="globalPromptLabel"]'), when + ': the Global Prompt card label is in ' + locale).toHaveText(copy.globalPrompt);
    await expect(popup.locator('label[for="hideThinkingToggle"]'), when + ': the Collapse Thinking Process label is in ' + locale).toHaveText(copy.collapseThinking);
    await expect(popup.locator('#exportMdBtn'), when + ': the Export button is in ' + locale).toHaveText(copy.exportButton);
    await expect(popup.locator('#localeSwitcherBtn'), when + ': the globe button tooltip is in ' + locale).toHaveAttribute('title', copy.switchLanguageTitle);
}

/** The radio of `locale` in the language panel. */
function localeRadio(popup, locale) {
    return popup.locator('#localePanel input[name="locale"][value="' + locale + '"]');
}

/** Opens the language panel with the globe button and asserts the radio of `locale` is the checked one. */
async function openPanelAndExpectLocale(popup, locale, when) {
    await popup.locator('#localeSwitcherBtn').click();
    await expect(popup.locator('#localePanel'), when + ': the globe button opens the language panel').toBeVisible();
    await expect(localeRadio(popup, locale), when + ': the panel marks ' + locale + ' as the current language').toBeChecked();
}

/** Picks `locale` in the open language panel the way a user does, then waits for the popup to reload and render again. */
async function pickLocaleAndWaitForReload(popup, locale) {
    await popup.evaluate(() => { window.__dssE2eBeforeSwitch = true; });
    const reloaded = popup.waitForEvent('load');
    await popup.locator('#localePanel label.locale-option', { has: popup.locator('input[name="locale"][value="' + locale + '"]') }).click();
    await reloaded;
    expect(await popup.evaluate(() => window.__dssE2eBeforeSwitch === undefined), 'picking a language reloads the popup (a fresh document)').toBe(true);
    await expect(popup.locator('#presetSelectValue'), 'the reloaded popup has rendered again').not.toHaveText('');
}

/** Reads every place the locale lives: the sync key, the extension-origin localStorage entry and, with a DeepSeek page, the DeepSeek-origin localStorage entry (null marks an absent value). */
async function readLocaleState({ context, extensionId }, deepSeekPage) {
    return {
        sync: (await readBothAreas(context, [LOCALE_KEY])).sync[LOCALE_KEY] ?? null,
        extension: await evaluateInExtensionOrigin(context, extensionId, readLocaleItem, LOCALE_KEY),
        deepSeek: deepSeekPage ? await deepSeekPage.evaluate(readLocaleItem, LOCALE_KEY) : null,
    };
}

/** Snapshots the locale everywhere; `settings.track` also hands the sync key to the settings session, which restores it after the test as well. */
async function snapshotLocale({ context, extensionId, settings }, deepSeekPage) {
    await settings.track([LOCALE_KEY]);
    return readLocaleState({ context, extensionId }, deepSeekPage);
}

/**
 * Puts the locale back everywhere: closes the popup first (no pending reload can write afterwards), restores the sync key through the settings session, then writes both localStorage entries back.
 * An open DeepSeek page can mirror the restored sync value into its localStorage a moment later, so the state is re-read after a settle window and written again while it drifts.
 * A failed settings.restore() does not skip the localStorage write-back: its error is held, the write-back and re-check still run, and the held error is rethrown afterwards.
 */
async function restoreLocale({ context, extensionId, settings }, saved, deepSeekPage) {
    await closeExtensionPages(context);
    let restoreError = null;
    try {
        await settings.restore();
    } catch (error) {
        restoreError = error;
    }
    let current = null;
    for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt += 1) {
        await evaluateInExtensionOrigin(context, extensionId, writeLocaleItem, { key: LOCALE_KEY, value: saved.extension });
        if (deepSeekPage) await deepSeekPage.evaluate(writeLocaleItem, { key: LOCALE_KEY, value: saved.deepSeek });
        await pause(RESTORE_SETTLE_MS);
        current = await readLocaleState({ context, extensionId }, deepSeekPage);
        if (JSON.stringify(current) === JSON.stringify(saved)) break;
    }
    if (restoreError) throw restoreError;
    if (JSON.stringify(current) !== JSON.stringify(saved)) throw new Error('Locale restore left ' + JSON.stringify(current) + ', expected ' + JSON.stringify(saved));
}

/** Stores `locale` as the current choice, opens the popup and asserts it shows that locale (precondition). */
async function openPopupIn({ context, extensionId }, locale) {
    await setSync(context, { [LOCALE_KEY]: locale });
    const popup = await openPopup(context, extensionId);
    await expectPopupInLocale(popup, locale, 'before switching (precondition)');
    return popup;
}

const test = base.extend({
    // The locale in chrome.storage.sync and in the extension-origin localStorage, snapshotted before the test; teardown has its own timeout, so it puts both back even after a failed or timed-out test.
    extensionLocale: async ({ context, extensionId, settings }, use) => {
        const saved = await snapshotLocale({ context, extensionId, settings });
        await use(saved);
        await restoreLocale({ context, extensionId, settings }, saved);
    },
    // Adds the DeepSeek-origin localStorage entry of `page`; it depends on `page` and `extensionLocale`, so it is torn down first, while the DeepSeek page is still open.
    deepSeekLocale: async ({ page, context, extensionId, settings, extensionLocale }, use) => {
        const saved = { ...extensionLocale, deepSeek: await page.evaluate(readLocaleItem, LOCALE_KEY) };
        await use(saved);
        await restoreLocale({ context, extensionId, settings }, saved, page);
    },
});

// Each test requests a locale fixture for its snapshot and teardown restore only; the test body does not read it.
test.describe('popup language switcher', () => {
    for (const [from, to] of [['zh_TW', 'en'], ['en', 'zh_TW']]) {
        test('picking ' + to + ' in the language panel of a ' + from + ' popup reloads it in ' + to + ', stores ' + to + ' in sync and the extension localStorage, and a reopened popup is still in ' + to, async ({ context, extensionId, extensionLocale }) => {
            const popup = await openPopupIn({ context, extensionId }, from);
            await openPanelAndExpectLocale(popup, from, 'before switching (precondition)');

            await pickLocaleAndWaitForReload(popup, to);

            await expectPopupInLocale(popup, to, 'after switching');
            expect((await readBothAreas(context, [LOCALE_KEY])).sync[LOCALE_KEY], 'the choice is stored in chrome.storage.sync ' + LOCALE_KEY).toBe(to);
            expect(await popup.evaluate(readLocaleItem, LOCALE_KEY), 'the choice is mirrored into the extension-origin localStorage').toBe(to);

            await closeExtensionPages(context);
            const reopened = await openPopup(context, extensionId);
            await expectPopupInLocale(reopened, to, 'after reopening the popup');
            await openPanelAndExpectLocale(reopened, to, 'after reopening the popup');
        });
    }
});

test.describe('DeepSeek page follows the popup language', () => {
    test('switching the popup from zh_TW to en relabels the Quote Reply button on an open DeepSeek chat without reloading the page', async ({ page, context, extensionId, settings, openConversation, deepSeekLocale }) => {
        await settings.set({ isEnabled: true });
        await setSync(context, { [LOCALE_KEY]: 'zh_TW' });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        await page.evaluate(() => { window.__dssE2eSamePage = true; });
        const quoteButton = page.locator(QUOTE_BUTTON_SELECTOR);
        const selected = await dragSelectTwoReplyParagraphs(page);
        expect(selected.trim(), 'the drag selected reply text (precondition)').not.toBe('');
        await expect(quoteButton, 'selecting reply text shows the quote button (precondition)').toBeVisible();
        await expect(quoteButton, 'the quote button reads the zh_TW label (precondition)').toHaveText(COPY.zh_TW.quoteReply);

        const popup = await openPopup(context, extensionId);
        await expectPopupInLocale(popup, 'zh_TW', 'before switching (precondition)');
        await openPanelAndExpectLocale(popup, 'zh_TW', 'before switching (precondition)');
        await pickLocaleAndWaitForReload(popup, 'en');
        await expectPopupInLocale(popup, 'en', 'after switching');

        await expect(quoteButton, 'the quote button on the open chat now reads the en label').toHaveText(COPY.en.quoteReply);
        expect(await page.evaluate(() => window.__dssE2eSamePage === true), 'the DeepSeek page was not reloaded to pick up the language').toBe(true);
    });
});
