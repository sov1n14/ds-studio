// Reads and drives the scroll position of DeepSeek's message list.

import { DSSelectors } from './selectors.js';

/** Scroll position of the message list: `top` (scrollTop) and `max` (largest reachable scrollTop). */
export function readListScroll(page) {
    return page.evaluate((itemsSelector) => {
        const scroller = document.querySelector(itemsSelector)?.parentElement;
        if (!scroller) return null;
        return { top: Math.round(scroller.scrollTop), max: scroller.scrollHeight - scroller.clientHeight };
    }, DSSelectors.VIRTUAL_LIST_SELECTOR);
}

/** Turns the mouse wheel by `deltaY` over the centre of the message list's visible box, the way a user scrolls. */
export async function wheelOverList(page, deltaY) {
    const box = await page.locator(DSSelectors.VIRTUAL_LIST_SELECTOR).locator('..').boundingBox();
    if (!box) throw new Error('message list is not rendered');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, deltaY);
}

/** Resolves once the message list's scrollTop is unchanged across two polls 100 ms apart (wheel scrolling animates). */
export async function waitForListScrollToSettle(page) {
    await page.evaluate(() => { delete window.__e2eLastScrollTop; });
    await page.waitForFunction((itemsSelector) => {
        const scroller = document.querySelector(itemsSelector)?.parentElement;
        if (!scroller) return false;
        const now = scroller.scrollTop;
        const previous = window.__e2eLastScrollTop;
        window.__e2eLastScrollTop = now;
        return previous === now;
    }, DSSelectors.VIRTUAL_LIST_SELECTOR, { polling: 100 });
}

/**
 * Scrolls the message list from page JavaScript (the main world), the same way any page script does: `scrollTo`, `scrollBy` or a `scrollTop` write.
 * `direction` 'down' targets the bottom (or two screens down for scrollBy); 'up' targets the top.
 */
export function scrollListFromPage(page, api, direction) {
    return page.evaluate(({ itemsSelector, how, dir }) => {
        const scroller = document.querySelector(itemsSelector).parentElement;
        const down = dir === 'down';
        if (how === 'scrollTo') scroller.scrollTo({ top: down ? scroller.scrollHeight : 0 });
        else if (how === 'scrollBy') scroller.scrollBy(0, (down ? 2 : -2) * scroller.clientHeight);
        else if (how === 'scrollTop') scroller.scrollTop = down ? scroller.scrollHeight : 0;
        else throw new Error(`unknown scroll api ${how}`);
    }, { itemsSelector: DSSelectors.VIRTUAL_LIST_SELECTOR, how: api, dir: direction });
}
