import { test, expect } from './fixtures.js';
import { pacedTimeout } from './helpers/human.js';
import { readListScroll, scrollListFromPage, waitForListScrollToSettle, wheelOverList } from './helpers/scroll.js';

// Prevent auto-scroll (`dsPreventAutoScroll`) stops the page from scrolling the message list downward, while the user's own wheel keeps working; off restores page-driven scrolling.
// Why page-world scroll calls are the trigger: DeepSeek only follows new content while a reply streams, which needs a sent message; appending 1500px to the last message did not move the list (measured live 2026-11-08, scrollTop 12452 before and after). Every page-driven scroll (streaming follow, DeepSeek's go-to-bottom button, any page script) goes through the page's scrollTo / scrollBy / scrollTop APIs, so the spec issues those calls from the page world and asserts the list's rendered scroll position.

test.setTimeout(120_000);

const PAGE_SCROLL_APIS = ['scrollTo', 'scrollBy', 'scrollTop'];
const FAR_FROM_BOTTOM_PX = 1_000;
const MIN_PAGE_SCROLL_PX = 500;

/** Wheels the list up until it sits well above the bottom, waits for the wheel animation, and returns the settled position. */
async function scrollUpByWheel(page) {
    await wheelOverList(page, -3_000);
    // The distance is measured against the current scroll height: a short list renders its unmounted items with estimated heights, so the height grows once the wheel mounts them.
    await expect.poll(async () => { const { top, max } = await readListScroll(page); return max - top; }, { message: 'the mouse wheel scrolls the list up' }).toBeGreaterThan(FAR_FROM_BOTTOM_PX);
    await waitForListScrollToSettle(page);
    return readListScroll(page);
}

// 回放的 history 答覆延遲 400 毫秒（真實伺服器的延遲）：即時答覆會讓擴充功能的浮層早於所開啟對話的綁定解析而出現。
test.use({ replayLatency: { history: 400 } });

test.describe('prevent auto-scroll', { tag: '@offline' }, () => {
    test('on: page scripts cannot scroll the list down while the wheel and upward page scrolls still work; off: page scripts scroll down again', async ({ page, settings, openConversation, deepseekReplay }) => {
        await settings.set({ isEnabled: true, dsPreventAutoScroll: false });
        await openConversation(deepseekReplay.requireConversation('mostMessages').id);
        await expect.poll(async () => (await readListScroll(page))?.max ?? 0, { message: 'the conversation is long enough to scroll beyond the far-from-bottom distance plus the minimum page scroll' }).toBeGreaterThan(FAR_FROM_BOTTOM_PX + MIN_PAGE_SCROLL_PX);

        // Precondition with the feature off: each page-world API really scrolls the list down, so "did not move" below is caused by the feature.
        for (const api of PAGE_SCROLL_APIS) {
            const start = await scrollUpByWheel(page);
            await scrollListFromPage(page, api, 'down');
            await expect.poll(async () => (await readListScroll(page)).top, { message: `with the feature off, page ${api} scrolls the list down` }).toBeGreaterThan(start.top + MIN_PAGE_SCROLL_PX);
        }

        await settings.set({ dsPreventAutoScroll: true });
        for (const api of PAGE_SCROLL_APIS) {
            await expect(async () => {
                const start = await scrollUpByWheel(page);
                await scrollListFromPage(page, api, 'down');
                await waitForListScrollToSettle(page);
                expect((await readListScroll(page)).top, `with the feature on, page ${api} leaves the list where the user scrolled it`).toBe(start.top);
            }).toPass({ timeout: pacedTimeout(20_000) });
        }

        const beforeWheel = await scrollUpByWheel(page);
        await wheelOverList(page, 1_000);
        await expect.poll(async () => (await readListScroll(page)).top, { message: 'with the feature on, the mouse wheel still scrolls the list down' }).toBeGreaterThan(beforeWheel.top);
        await waitForListScrollToSettle(page);
        const beforeUp = await readListScroll(page);
        await scrollListFromPage(page, 'scrollTo', 'up');
        await expect.poll(async () => (await readListScroll(page)).top, { message: 'with the feature on, an upward page scroll still moves the list' }).toBeLessThan(beforeUp.top);

        await settings.set({ dsPreventAutoScroll: false });
        await expect.poll(async () => {
            await scrollListFromPage(page, 'scrollTo', 'down');
            const { top, max } = await readListScroll(page);
            return top >= max - 1;
        }, { message: 'turning the feature off lets a page scrollTo reach the bottom again' }).toBe(true);
    });
});
