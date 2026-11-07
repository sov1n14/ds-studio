import { test, expect } from './fixtures.js';
import { CONVERSATIONS, MESSAGE_IN_VIEW_SELECTOR } from './helpers/conversations.js';
import { DSSelectors } from './helpers/selectors.js';

// Conversation width (`dsChatWidthEnabled` / `dsChatWidth`) and input width (`dsInputWidthEnabled` / `dsInputWidth`) cap their areas at a viewport percentage; the input never exceeds an enabled chat width. Assertions measure rendered widths only, so they fail if DeepSeek stops honouring the injected CSS.

const PX_TOLERANCE = 1;

const ALL_WIDTH_OFF = { isEnabled: true, dsChatWidthEnabled: false, dsInputWidthEnabled: false };

/** Widest rendered message in view, as a fraction of the viewport width. */
function widestMessageRatio(page) {
    return page.evaluate((selector) => {
        const widths = [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect().width);
        return widths.length === 0 ? null : Math.max(...widths) / window.innerWidth;
    }, MESSAGE_IN_VIEW_SELECTOR);
}

/** Rendered input-composer width as a fraction of the viewport width. */
function composerRatio(page) {
    return page.evaluate((selector) => {
        const el = document.querySelector(selector);
        return el ? el.getBoundingClientRect().width / window.innerWidth : null;
    }, DSSelectors.INPUT_COMPOSER_WRAPPER_SELECTOR);
}

/** Polls until `measure` is strictly above / at most `ratio` of the viewport, with 1px tolerance. */
async function expectRatio(page, measure, comparison, ratio, message) {
    const viewport = page.viewportSize().width;
    const limit = ratio + PX_TOLERANCE / viewport;
    await expect.poll(async () => {
        const value = await measure(page);
        if (value === null) return 'element missing';
        return comparison === 'atMost' ? value <= limit : value > limit;
    }, { message }).toBe(true);
}

test.describe('conversation and input width', () => {
    test('chat width 50 caps messages at 50vw and disabling it restores the native width', async ({ page, settings, openConversation }) => {
        await settings.set(ALL_WIDTH_OFF);
        await openConversation(CONVERSATIONS.thinkingWithSearch);
        await expectRatio(page, widestMessageRatio, 'above', 0.5, 'native messages are wider than 50vw (precondition)');

        await settings.set({ dsChatWidth: 50, dsChatWidthEnabled: true });
        await expectRatio(page, widestMessageRatio, 'atMost', 0.5, 'messages render at most 50vw wide');

        await settings.set({ dsChatWidthEnabled: false });
        await expectRatio(page, widestMessageRatio, 'above', 0.5, 'messages return to their native width');
    });

    test('input width 40 caps the composer at 40vw and disabling it restores the native width', async ({ page, settings, openConversation }) => {
        await settings.set(ALL_WIDTH_OFF);
        await openConversation(CONVERSATIONS.thinkingWithSearch);
        await expectRatio(page, composerRatio, 'above', 0.4, 'native composer is wider than 40vw (precondition)');

        await settings.set({ dsInputWidth: 40, dsInputWidthEnabled: true });
        await expectRatio(page, composerRatio, 'atMost', 0.4, 'composer renders at most 40vw wide');

        await settings.set({ dsInputWidthEnabled: false });
        await expectRatio(page, composerRatio, 'above', 0.4, 'composer returns to its native width');
    });

    test('input width 100 is clamped to an enabled chat width of 40 and released when chat width turns off', async ({ page, settings, openConversation }) => {
        await settings.set({ ...ALL_WIDTH_OFF, dsInputWidth: 100, dsInputWidthEnabled: true });
        await openConversation(CONVERSATIONS.thinkingWithSearch);
        await expectRatio(page, composerRatio, 'above', 0.4, 'unclamped composer is wider than 40vw (precondition)');

        await settings.set({ dsChatWidth: 40, dsChatWidthEnabled: true });
        await expectRatio(page, composerRatio, 'atMost', 0.4, 'composer is clamped to the 40vw chat width');

        await settings.set({ dsChatWidthEnabled: false });
        await expectRatio(page, composerRatio, 'above', 0.4, 'composer is released once chat width turns off');
    });
});
