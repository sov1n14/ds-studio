import { test, expect } from './fixtures.js';

// Rendered control order of the popup settings cards (DECISIONS D-27, unit counterpart: test/unit/popup-card-order.spec.js).
// The popup page is opened in a tab and only read: no toggle is clicked, so no permission prompt can appear.
// A control is a checkbox id or a radio group name; the spec checks both the DOM order and that the rows render top to bottom in that order.

const POPUP_PATH = 'popup/popup.html';

const EXPECTED_CARDS = [
    ['Features', [
        'showSystemTimeToggle',
        'autoCopyReplyToggle',
        'autoCopyCodeToggle',
        'preventAutoScrollToggle',
        'autoRetryToggle',
        'autoContinueToggle',
        'radio:websearchToggle',
        'radio:replyNotificationToggle',
    ]],
    ['UI Adjustments', [
        'sidebarAutoHideToggle',
        'hideThinkingToggle',
        'autoExpandMessagesToggle',
        'autoOpenSidebarToggle',
        'chatWidthToggle',
        'inputWidthToggle',
    ]],
];

/** Controls of the card titled `heading` in DOM order, each with the rendered top of its row; radio groups are listed once. */
function readCardControls(page, heading) {
    return page.evaluate((title) => {
        const titleEl = [...document.querySelectorAll('.card-title')].find((el) => el.textContent.trim() === title);
        if (!titleEl) return null;
        const controls = [];
        const seen = new Set();
        for (const input of titleEl.closest('.card').querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
            const key = input.type === 'radio' ? `radio:${input.name}` : input.id;
            if (seen.has(key)) continue;
            seen.add(key);
            const row = input.closest('.input-group') ?? input;
            controls.push({ key, rowTop: Math.round(row.getBoundingClientRect().top) });
        }
        return controls;
    }, heading);
}

test.describe('popup control order', () => {
    test('the Features and UI Adjustments cards render their controls in the D-27 order', async ({ page, extensionId }) => {
        await page.goto(`chrome-extension://${extensionId}/${POPUP_PATH}`);
        await expect(page.locator('.card-title', { hasText: 'Features' }), 'the popup has rendered its cards (precondition)').toBeVisible();

        await test.info().attach('popup.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

        for (const [heading, expected] of EXPECTED_CARDS) {
            const controls = await readCardControls(page, heading);
            expect(controls, `the ${heading} card is rendered`).not.toBeNull();
            expect(controls.map((control) => control.key), `${heading} card controls in DOM order`).toEqual(expected);
            const tops = controls.map((control) => control.rowTop);
            const sortedTops = [...tops].sort((a, b) => a - b);
            expect(tops, `${heading} card rows render top to bottom in the same order`).toEqual(sortedTops);
            expect(new Set(tops).size, `${heading} card rows each sit on their own line`).toBe(tops.length);
        }
    });
});
