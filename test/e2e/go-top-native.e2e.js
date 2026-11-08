import { test, expect } from './fixtures.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { exportMarkdown, withoutExportTimestamp } from './helpers/export.js';
import { GO_TOP_SELECTOR } from './helpers/extension-ui.js';
import { expectNeverWithin } from './helpers/observation.js';
import { readListScroll, waitForListScrollToSettle } from './helpers/scroll.js';
import { DSSelectors } from './helpers/selectors.js';

// Go Top against the native DeepSeek scroll-to-bottom button on a very long conversation (spec: docs/changelog/v4.md 4.39.5).
// The native button mounts only while the list is away from the bottom, so every press below happens after the list has left the bottom.
// Live timing at 1280x720 (measured 2026-11-08): after a Go Top click from the bottom the native button mounts at about 270 ms and a Playwright click lands at about 345 ms, while Go Top still holds the list at the top; the export scroll-to-top holds the top from about 90 ms to 600 ms.

test.setTimeout(120_000);

const VIEWPORT = { width: 1280, height: 720 };
const NATIVE_CONTROL_SELECTOR = `.${DSSelectors.GO_TOP_NATIVE_BUTTON_CLASS}`;
const NATIVE_GO_BOTTOM_SELECTOR = `${NATIVE_CONTROL_SELECTOR} [role="button"]`;
// Id of the hidden element whose data-enabled is "true" while the extension holds its scroll lock (Go Top or export running); read only to prove a press landed mid-scroll.
const SCROLL_LOCK_ELEMENT_ID = 'dss-prevent-auto-scroll-bridge';
const STAY_AT_BOTTOM_WINDOW_MS = 3_000;
const STAY_VISIBLE_WINDOW_MS = 1_500;

/** Opens the very long conversation with Go Top on and prevent auto-scroll off, and waits until the list rests at its bottom. */
async function openAtBottom(page, settings, openConversation) {
    await page.setViewportSize(VIEWPORT);
    await settings.set({ isEnabled: true, dsPreventAutoScroll: false });
    await openConversation(CONVERSATIONS.veryLongThread);
    await expect.poll(async () => {
        const scroll = await readListScroll(page);
        return scroll !== null && scroll.max > VIEWPORT.height && scroll.top >= scroll.max - 1;
    }, { message: 'the conversation opens scrolled to its bottom (precondition)' }).toBe(true);
    await waitForListScrollToSettle(page);
}

/** True when the list sits at its bottom (within 1 px of the largest reachable scrollTop). */
async function isAtBottom(page) {
    const { top, max } = await readListScroll(page);
    return top >= max - 1;
}

/**
 * Records every pointerdown on the page with the list position and the extension scroll-lock state at that instant.
 * Registered in the capture phase before any Go Top run starts, so it observes the press before the extension reacts to it.
 */
function recordPresses(page) {
    return page.evaluate(({ itemsSelector, nativeSelector, goTopSelector, lockId }) => {
        window.__e2ePresses = [];
        document.addEventListener('pointerdown', (event) => {
            const scroller = document.querySelector(itemsSelector)?.parentElement;
            const target = event.target instanceof Element ? event.target : null;
            window.__e2ePresses.push({
                isTrusted: event.isTrusted,
                isNative: Boolean(target?.closest(nativeSelector)) && !target?.closest(goTopSelector),
                top: scroller ? Math.round(scroller.scrollTop) : null,
                isLockHeld: document.getElementById(lockId)?.dataset.enabled === 'true',
            });
        }, true);
    }, { itemsSelector: DSSelectors.VIRTUAL_LIST_SELECTOR, nativeSelector: NATIVE_CONTROL_SELECTOR, goTopSelector: GO_TOP_SELECTOR, lockId: SCROLL_LOCK_ELEMENT_ID });
}

/** The recorded press on the native control, attached to the report; fails unless it was a trusted press. */
async function readNativePress(page) {
    const presses = await page.evaluate(() => window.__e2ePresses);
    test.info().annotations.push({ type: 'recorded presses', description: JSON.stringify(presses) });
    const nativePress = presses.find((press) => press.isNative);
    expect(nativePress, 'the native scroll-to-bottom button received a press (precondition)').toBeDefined();
    expect(nativePress.isTrusted, 'the press is a trusted user press (precondition)').toBe(true);
    return nativePress;
}

/** Fails when the list leaves the bottom by more than one viewport within `durationMs` (Go Top pulling it back would land at 0). */
function expectToStayAtBottom(page, durationMs, message) {
    return expectNeverWithin(page, (itemsSelector) => {
        const scroller = document.querySelector(itemsSelector).parentElement;
        return scroller.scrollTop < scroller.scrollHeight - 2 * scroller.clientHeight;
    }, DSSelectors.VIRTUAL_LIST_SELECTOR, durationMs, message);
}

test.describe('go to top with the native scroll-to-bottom button', () => {
    test('a native scroll-to-bottom click during Go Top leaves the list at the bottom and Go Top does not pull it back', async ({ page, settings, openConversation }) => {
        await openAtBottom(page, settings, openConversation);
        await recordPresses(page);

        await page.locator(GO_TOP_SELECTOR).click();
        await page.locator(NATIVE_GO_BOTTOM_SELECTOR).click();

        const nativePress = await readNativePress(page);
        expect(nativePress.isLockHeld, 'the press landed while Go Top was still running (precondition)').toBe(true);

        await expect.poll(() => isAtBottom(page), { message: 'the native button takes the list to the bottom' }).toBe(true);
        await expectToStayAtBottom(page, STAY_AT_BOTTOM_WINDOW_MS, 'Go Top must not pull the list back up after the native press');
        expect(await isAtBottom(page), 'the list is still at the bottom once everything has settled').toBe(true);
    });

    test('after a native scroll-to-bottom click from the top of a very long thread, the Go Top button shows at the bottom', async ({ page, settings, openConversation }) => {
        await openAtBottom(page, settings, openConversation);
        const goTop = page.locator(GO_TOP_SELECTOR);
        await goTop.click();
        await expect.poll(async () => (await readListScroll(page)).top, { message: 'Go Top takes the list to the very top (precondition)' }).toBe(0);
        await expect(goTop, 'the Go Top button hides at the top (precondition)').toBeHidden();
        await waitForListScrollToSettle(page);

        await page.locator(NATIVE_GO_BOTTOM_SELECTOR).click();
        await expect.poll(() => isAtBottom(page), { message: 'the native button takes the list to the bottom' }).toBe(true);
        await waitForListScrollToSettle(page);

        const geometry = await page.evaluate(({ itemsSelector, messageSelector }) => {
            const scroller = document.querySelector(itemsSelector).parentElement;
            const first = document.querySelector(`${itemsSelector} ${messageSelector}`);
            return { scrollTop: Math.round(scroller.scrollTop), clientHeight: scroller.clientHeight, firstMountedMessageBottom: first ? Math.round(first.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top) : null };
        }, { itemsSelector: DSSelectors.VIRTUAL_LIST_SELECTOR, messageSelector: DSSelectors.MESSAGE_SELECTOR });
        test.info().annotations.push({ type: 'bottom geometry', description: JSON.stringify(geometry) });

        await expect(goTop, 'the Go Top button shows once the list rests at the bottom of the long thread').toBeVisible();
        await expectNeverWithin(page, (selector) => !document.querySelector(selector)?.checkVisibility(), GO_TOP_SELECTOR, STAY_VISIBLE_WINDOW_MS, 'the Go Top button must stay visible at the bottom');
    });

    test('a native scroll-to-bottom click during the export scroll-to-top does not stop the export', async ({ page, settings, openConversation }) => {
        test.setTimeout(180_000);
        await openAtBottom(page, settings, openConversation);
        const exportOptions = { includeThinking: false, includeReferences: false };
        const undisturbed = await exportMarkdown(page, exportOptions);
        // The export puts the list back at its earlier scrollTop, which is no longer the bottom once the whole thread has been measured; return to the real bottom so the native button unmounts and can only reappear through the next export scroll-to-top.
        await page.locator(NATIVE_GO_BOTTOM_SELECTOR).click();
        await expect.poll(() => isAtBottom(page), { message: 'the list is back at the bottom before the second export (precondition)' }).toBe(true);
        await waitForListScrollToSettle(page);
        await expect(page.locator(NATIVE_GO_BOTTOM_SELECTOR), 'the native button is gone at the bottom (precondition)').toHaveCount(0);
        await recordPresses(page);

        const pendingExport = exportMarkdown(page, exportOptions);
        await page.locator(NATIVE_GO_BOTTOM_SELECTOR).click();
        const disturbed = await pendingExport;

        const nativePress = await readNativePress(page);
        expect(nativePress.top, 'the press landed while the export held the list at the top (precondition)').toBe(0);

        expect(disturbed.fileName, 'the export still downloads a Markdown file').toMatch(/\.md$/);
        expect(withoutExportTimestamp(disturbed.content), 'the export interrupted by the native press equals an undisturbed export').toBe(withoutExportTimestamp(undisturbed.content));
    });
});
