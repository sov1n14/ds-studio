import { test, expect } from './fixtures.js';
import { composer } from './helpers/composer.js';
import { CONVERSATIONS } from './helpers/conversations.js';
import { QUOTE_BUTTON_SELECTOR } from './helpers/extension-ui.js';
import { expectNeverWithin } from './helpers/observation.js';
import { asBlockquote, dragSelectTwoReplyParagraphs, dragSelectWithinReplyLine } from './helpers/quote.js';
import { readListScroll, waitForListScrollToSettle, wheelOverList } from './helpers/scroll.js';

// Quote reply follows the master switch only: selecting reply text shows a floating quote button; clicking it appends the selection to the composer as a Markdown blockquote, every selected line prefixed with "> " (docs/FEATURES.md, Quote Reply). Nothing is sent.

// The quote button appears 250 ms after the selection settles; 1.5 s is six times that.
const NO_BUTTON_WINDOW_MS = 1_500;

// 新增測試的預期值出處：附加與換行分隔 docs/spec/04-features.md:54-55 與 docs/FEATURES.md:283；單行格式 docs/FEATURES.md:283 與 docs/spec/04-features.md:54；自動隱藏條件 docs/FEATURES.md:285 與 docs/spec/04-features.md:58。

/** 撰寫框中預先存在的草稿；只寫入撰寫框，從不送出。 */
const DRAFT = 'E2E 既有草稿（不送出）';

/** 目前選取範圍在視窗中的外框，以及視窗高度；沒有選取範圍時回傳 null。 */
function readSelectionBox(page) {
    return page.evaluate(() => {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
    });
}

/** 開啟測試對話、拖曳選取回覆中的兩段文字，並確認引用按鈕已顯示；回傳選取的文字。 */
async function showQuoteButtonOverReply(page, settings, openConversation) {
    await settings.set({ isEnabled: true });
    await openConversation(CONVERSATIONS.fiveThinkingReplies);
    const selected = await dragSelectTwoReplyParagraphs(page);
    expect(selected.trim(), 'the drag selected reply text (precondition)').not.toBe('');
    await expect(page.locator(QUOTE_BUTTON_SELECTOR), 'selecting reply text shows the quote button (precondition)').toBeVisible();
    return selected;
}

test.describe('quote reply', () => {
    test('quoting a two-paragraph reply selection writes it into the empty composer as a blockquote', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: true });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        const input = composer(page);
        const quoteButton = page.locator(QUOTE_BUTTON_SELECTOR);
        try {
            await input.fill('');
            await expect(quoteButton, 'no quote button before any selection').toBeHidden();

            const selected = await dragSelectTwoReplyParagraphs(page);
            expect(selected, 'the drag selected text spanning more than one line').toMatch(/\S[\s\S]*\n[\s\S]*\S/);
            await expect(quoteButton, 'selecting reply text shows the quote button').toBeVisible();
            await expect(input, 'the composer is still empty before quoting').toHaveValue('');

            await quoteButton.click();
            await expect(input, 'the composer holds the selection as a blockquote, every line prefixed with "> "').toHaveValue(asBlockquote(selected));
        } finally {
            await input.fill('');
        }
    });

    test('with the master switch off a reply selection shows no quote button; switching it on brings the button back', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: false });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        const quoteButton = page.locator(QUOTE_BUTTON_SELECTOR);

        const selectedWhileOff = await dragSelectTwoReplyParagraphs(page);
        expect(selectedWhileOff.trim(), 'the drag selected reply text (precondition)').not.toBe('');
        await expectNeverWithin(page, (selector) => !!document.querySelector(selector)?.checkVisibility(), QUOTE_BUTTON_SELECTOR, NO_BUTTON_WINDOW_MS, 'with the master switch off no quote button may appear');

        await settings.set({ isEnabled: true });
        // The switch reaches the page asynchronously, so the selection gesture is repeated until the feature is live.
        await expect(async () => {
            await page.evaluate(() => window.getSelection().removeAllRanges());
            await dragSelectTwoReplyParagraphs(page);
            await expect(quoteButton, 'after switching on, the same selection shows the quote button').toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
    });
});

test.describe('quote reply: appending and single-line format', () => {
    // 撰寫框已有內容時，引用附加在原內容之後：原內容沒有結尾換行時補一個 `\n`，已有結尾換行時不再多補（docs/spec/04-features.md:55）。
    for (const { name, draft } of [
        { name: 'a draft without a trailing newline gets one newline before the quote', draft: DRAFT },
        { name: 'a draft already ending with a newline gets no extra one before the quote', draft: DRAFT + '\n' },
    ]) {
        test(`quoting into a non-empty composer appends the blockquote after the draft: ${name}`, async ({ page, settings, openConversation }) => {
            await settings.set({ isEnabled: true });
            await openConversation(CONVERSATIONS.fiveThinkingReplies);
            const input = composer(page);
            const quoteButton = page.locator(QUOTE_BUTTON_SELECTOR);
            try {
                await input.fill(draft);
                await expect(input, 'the composer holds the draft first (precondition)').toHaveValue(draft);

                const selected = await dragSelectTwoReplyParagraphs(page);
                expect(selected.trim(), 'the drag selected reply text (precondition)').not.toBe('');
                await expect(quoteButton, 'selecting reply text shows the quote button').toBeVisible();
                await expect(input, 'the composer still holds only the draft before quoting').toHaveValue(draft);

                await quoteButton.click();
                await expect(input, 'the draft is kept, not replaced; exactly one newline separates the draft from the quote, a blockquote with every line prefixed with "> "').toHaveValue(DRAFT + '\n' + asBlockquote(selected));
            } finally {
                await input.fill('');
            }
        });
    }

    test('quoting a selection inside one line writes "> " plus exactly that text into the empty composer', async ({ page, settings, openConversation }) => {
        await settings.set({ isEnabled: true });
        await openConversation(CONVERSATIONS.fiveThinkingReplies);
        const input = composer(page);
        const quoteButton = page.locator(QUOTE_BUTTON_SELECTOR);
        try {
            await input.fill('');
            const selected = await dragSelectWithinReplyLine(page);
            expect(selected.trim(), 'the drag selected reply text (precondition)').not.toBe('');
            expect(selected, 'the selection lies within one line and holds no line break (precondition)').not.toMatch(/[\r\n]/);
            await expect(quoteButton, 'selecting text within one line shows the quote button').toBeVisible();

            await quoteButton.click();
            // 空撰寫框直接填入 `> 選取內容`，前後不加空行（docs/spec/04-features.md:54）。
            await expect(input, 'the composer holds exactly "> " plus the selected text').toHaveValue('> ' + selected);
        } finally {
            await input.fill('');
        }
    });
});

test.describe('quote reply: auto-dismiss', () => {
    test('clearing the selection hides the quote button', async ({ page, settings, openConversation }) => {
        await showQuoteButtonOverReply(page, settings, openConversation);
        await page.evaluate(() => window.getSelection().removeAllRanges());
        expect(await page.evaluate(() => window.getSelection().rangeCount), 'the selection is cleared (precondition)').toBe(0);
        await expect(page.locator(QUOTE_BUTTON_SELECTOR), 'clearing the selection hides the quote button').toBeHidden();
    });

    test('collapsing the selection to a caret hides the quote button', async ({ page, settings, openConversation }) => {
        await showQuoteButtonOverReply(page, settings, openConversation);
        await page.evaluate(() => window.getSelection().collapseToEnd());
        expect(await page.evaluate(() => window.getSelection().isCollapsed), 'the selection is collapsed to a caret (precondition)').toBe(true);
        await expect(page.locator(QUOTE_BUTTON_SELECTOR), 'collapsing the selection hides the quote button').toBeHidden();
    });

    test('a click outside the button hides it even while the selection stays', async ({ page, settings, openConversation }) => {
        const selected = await showQuoteButtonOverReply(page, settings, openConversation);
        const quoteButton = page.locator(QUOTE_BUTTON_SELECTOR);
        // 一般點擊也會清除選取範圍，無法區分是哪個條件讓按鈕隱藏；取消 mousedown 的預設動作可保住選取範圍，事件仍會傳到文件上的監聽器。
        await page.evaluate(() => window.addEventListener('mousedown', (event) => event.preventDefault(), { capture: true }));
        const point = await page.evaluate(() => {
            const rects = window.getSelection().getRangeAt(0).getClientRects();
            const last = rects[rects.length - 1];
            return { x: last.left + last.width / 2, y: last.top + last.height / 2 };
        });
        const box = await quoteButton.boundingBox();
        const insideButton = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
        expect(insideButton, 'the click point lies outside the quote button (precondition)').toBe(false);

        await page.mouse.click(point.x, point.y);
        expect(await page.evaluate(() => window.getSelection().toString()), 'the selection is unchanged after the click (precondition)').toBe(selected);
        await expect(quoteButton, 'a click outside the button hides the quote button').toBeHidden();
    });

    test('scrolling the selection fully out of the viewport hides the quote button', async ({ page, settings, openConversation }) => {
        const selected = await showQuoteButtonOverReply(page, settings, openConversation);
        const box = await readSelectionBox(page);
        const scroll = await readListScroll(page);
        // 往有空間的方向捲動，讓整個選取範圍離開視窗：向下捲時選取範圍移到視窗上緣之上，向上捲時移到下緣之下。
        const down = Math.ceil(box.bottom) + 100;
        const up = Math.ceil(box.viewportHeight - box.top) + 100;
        let deltaY;
        if (scroll.max - scroll.top >= down) deltaY = down;
        else if (scroll.top >= up) deltaY = -up;
        else throw new Error(`message list cannot scroll the selection out of view: ${JSON.stringify({ box, scroll })}`);

        await wheelOverList(page, deltaY);
        await waitForListScrollToSettle(page);
        expect(await page.evaluate(() => window.getSelection().toString()), 'the selection is unchanged after scrolling (precondition)').toBe(selected);
        const after = await readSelectionBox(page);
        expect(after.bottom < 0 || after.top > after.viewportHeight, `the whole selection is outside the viewport (precondition): ${JSON.stringify(after)}`).toBe(true);
        await expect(page.locator(QUOTE_BUTTON_SELECTOR), 'scrolling the selection out of the viewport hides the quote button').toBeHidden();
    });

    test('resizing the window so the selection falls below the viewport hides the quote button', async ({ page, settings, openConversation }) => {
        const selected = await showQuoteButtonOverReply(page, settings, openConversation);
        const viewport = page.viewportSize();
        const box = await readSelectionBox(page);
        // 視窗高度縮到選取範圍上緣之上，整個選取範圍便落在新視窗之外（docs/spec/04-features.md:58 第 4 項）。
        const height = Math.floor(box.top) - 40;
        expect(height, `the selection top is far enough from the viewport top to shrink the window (precondition): ${JSON.stringify(box)}`).toBeGreaterThanOrEqual(150);

        await page.setViewportSize({ width: viewport.width, height });
        expect(await page.evaluate(() => window.getSelection().toString()), 'the selection is unchanged after shrinking the window (precondition)').toBe(selected);
        const after = await readSelectionBox(page);
        expect(after.top > after.viewportHeight, `the whole selection is outside the new viewport (precondition): ${JSON.stringify(after)}`).toBe(true);
        await expect(page.locator(QUOTE_BUTTON_SELECTOR), 'shrinking the window until the selection leaves the viewport hides the quote button').toBeHidden();
    });
});
