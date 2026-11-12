import { test as base, expect } from './fixtures.js';
import { CONVERSATIONS, openConversation } from './helpers/conversations.js';
import { PRESET_OVERLAY_SELECTOR } from './helpers/extension-ui.js';
import { expectNeverWithin } from './helpers/observation.js';
import { SIDEBAR_STATE_ARG, isPanelHiddenInPage, isPanelShownInPage } from './helpers/sidebar.js';

// 手機側邊欄滑動手勢（docs/FEATURES.md「Mobile Sidebar Swipe Gesture」第 188-195 行；docs/spec/03-ui-adjustments.md 第 19 節第 95-120 行）：
// - 只在手機上運作（FEATURES.md:190）；以 User-Agent 判斷裝置型態，回報觸控點的桌機仍是桌機（03-ui-adjustments.md:98）。
// - 在畫面中央 80% 區域內水平滑動：右滑開啟側邊欄、左滑關閉（FEATURES.md:192；03-ui-adjustments.md:99-101、110）。
// - 只有明確的水平滑動才觸發：距離 ≥ 50px、以水平為主（|dx| > |dy| × 1.5）、歷時 < 500ms（FEATURES.md:193；03-ui-adjustments.md:105-107）。
// - 跟隨總開關，沒有獨立開關（FEATURES.md:195），切換即時生效（03-ui-adjustments.md:114）。
// 持久設定檔是桌機 Chrome，所以用 CDP 模擬一支真實的 Android 手機（Pixel 8 的 User-Agent、platform、觸控點數與 412×915 視窗），
// 再以 CDP `Input.dispatchTouchEvent` 送出真的觸控事件。觀察的是使用者看得到的結果：DeepSeek 的側邊欄面板是否顯示在畫面內。
// 只開啟保留的對話並滑動，不送出訊息、不修改或刪除任何對話；每個測試結束時還原視窗大小與模擬設定，寫入的儲存鍵由 settings fixture 還原。

// 真實 Android 手機（Pixel 8，Chrome）回報的完整裝置資料。
const ANDROID_PHONE = Object.freeze({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv81',
    maxTouchPoints: 5,
});
// 真實 Windows 桌機 Chrome，且系統回報 10 個觸控點（觸控筆電或觸控注入軟體都會這樣回報）。
const TOUCH_DESKTOP = Object.freeze({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    platform: 'Win32',
    maxTouchPoints: 10,
});
// Pixel 8 的 CSS 視窗大小。中央 80% 區域為 x ∈ [41.2, 370.8]、y ∈ [91.5, 823.5]（03-ui-adjustments.md:100-101）。
const PHONE_VIEWPORT = Object.freeze({ width: 412, height: 915 });

// 手勢座標：觸控起點都在中央區域內、避開頂端標題列與底端輸入框；左滑從遮罩區（側邊欄右側）開始。
const MID_Y = 450;
const RIGHT_SWIPE_START = Object.freeze({ x: 120, y: MID_Y });
const LEFT_SWIPE_START = Object.freeze({ x: 300, y: MID_Y });
// 明確的滑動距離，遠超過 50px 門檻（FEATURES.md:193）。
const CLEAR_DISTANCE_PX = 180;
// 門檻兩側各取 5px：45px 不足 50px，55px 達到門檻（FEATURES.md:193；03-ui-adjustments.md:105）。
const BELOW_THRESHOLD_PX = 45;
const ABOVE_THRESHOLD_PX = 55;
// 快速滑動的總歷時，遠低於 500ms；慢速拖曳的總歷時，遠高於 500ms（FEATURES.md:193；03-ui-adjustments.md:107）。
const FAST_MS = 150;
const SLOW_MS = 800;
// 證明「沒有發生」的觀察窗長度；觀察窗本身就是斷言。
const NEVER_WINDOW_MS = 1_500;
// 第一次滑動時，擴充功能可能仍在尋找按鈕、尚未綁定觸控事件；只有第一次「應該開啟」的滑動允許重試。
const FIRST_SWIPE_RETRY_MS = 15_000;
const FIRST_SWIPE_ATTEMPT_MS = 2_000;
// 觸控移動拆成幾步送出，模擬手指連續移動。
const MOVE_STEPS = 5;
// 擴充功能找到按鈕前每 500ms 重試一次（docs/architecture/content-ui.md:186）；桌機情境在幾倍於此間隔的時間內反覆滑動，晚綁定也逃不過。
const DESKTOP_SWIPE_ROUNDS = 3;

const test = base.extend({
    // 手機視窗與 CDP 工作階段；拆除時（早於 page 關閉）關閉觸控模擬、還原 User-Agent 與視窗大小。
    touch: async ({ page }, use) => {
        const originalViewport = page.viewportSize();
        const originalUserAgent = await page.evaluate(() => navigator.userAgent);
        const cdp = await page.context().newCDPSession(page);
        await page.setViewportSize(PHONE_VIEWPORT);
        try {
            await use(cdp);
        } finally {
            if (!page.isClosed()) {
                await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
                await cdp.send('Emulation.setUserAgentOverride', { userAgent: originalUserAgent });
                await cdp.detach();
                if (originalViewport) await page.setViewportSize(originalViewport);
            }
        }
    },
});

/** 固定會改變側邊欄的另外兩項設定為關閉，一次寫一個鍵，總開關最後寫。 */
async function pinSettings(settings) {
    await settings.set({ isAutoOpenSidebarEnabled: false });
    await settings.set({ dsSidebarAutoHide: false });
    await settings.set({ isEnabled: true });
}

/** 以 `device` 的裝置資料載入保留的對話；回傳時頁面看到的是模擬的 User-Agent，側邊欄面板未顯示。 */
async function loadConversationAs(page, cdp, device) {
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: device.userAgent, platform: device.platform });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: device.maxTouchPoints });
    await openConversation(page, CONVERSATIONS.fiveThinkingReplies);
    expect(await page.evaluate(() => navigator.userAgent), 'the page sees the emulated User-Agent (precondition)').toBe(device.userAgent);
    await expect.poll(() => panelShown(page), { message: 'the sidebar panel starts hidden in the phone layout (precondition)' }).toBe(false);
}

/** 從 `start` 以 `durationMs` 滑動 (`dx`, `dy`) 後放開手指，全程是真的觸控事件。 */
async function swipe(cdp, start, { dx, dy = 0, durationMs = FAST_MS }) {
    const at = (fraction) => ({ x: start.x + dx * fraction, y: start.y + dy * fraction });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0)] });
    for (let step = 1; step <= MOVE_STEPS; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, durationMs / MOVE_STEPS));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(step / MOVE_STEPS)] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function panelShown(page) {
    return page.evaluate(isPanelShownInPage, SIDEBAR_STATE_ARG);
}

async function expectPanel(page, shown, message) {
    await expect.poll(() => panelShown(page), { message }).toBe(shown);
}

async function expectStaysClosed(page, message) {
    await expectNeverWithin(page, isPanelShownInPage, SIDEBAR_STATE_ARG, NEVER_WINDOW_MS, message);
}

async function expectStaysOpen(page, message) {
    await expectNeverWithin(page, isPanelHiddenInPage, SIDEBAR_STATE_ARG, NEVER_WINDOW_MS, message);
}

/** 第一次右滑：擴充功能綁定觸控事件前的滑動不會有反應，所以重試到側邊欄開啟為止；之後每次滑動都只送一次。 */
async function openWithFirstSwipe(page, cdp, message) {
    await expect(async () => {
        await swipe(cdp, RIGHT_SWIPE_START, { dx: CLEAR_DISTANCE_PX });
        await expect.poll(() => panelShown(page), { timeout: FIRST_SWIPE_ATTEMPT_MS }).toBe(true);
    }, message).toPass({ timeout: FIRST_SWIPE_RETRY_MS });
}

/** 先右滑開啟再左滑關閉，證明觸控事件已綁定；回傳時側邊欄面板未顯示。 */
async function armSwipe(page, cdp) {
    await openWithFirstSwipe(page, cdp, 'a clear right swipe opens the sidebar once the gesture is bound (control)');
    await swipe(cdp, LEFT_SWIPE_START, { dx: -CLEAR_DISTANCE_PX });
    await expectPanel(page, false, 'a clear left swipe closes the sidebar (control)');
}

test.describe('mobile sidebar swipe', () => {
    test('on a phone, a right swipe in the central area opens the sidebar and a left swipe closes it', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, ANDROID_PHONE);

        // FEATURES.md:192：右滑（左→右）開啟側邊欄。
        await openWithFirstSwipe(page, touch, 'a right swipe opens the sidebar');
        // FEATURES.md:192：左滑（右→左）關閉側邊欄。
        await swipe(touch, LEFT_SWIPE_START, { dx: -CLEAR_DISTANCE_PX });
        await expectPanel(page, false, 'a left swipe closes the sidebar');
        // 再來一輪，每次只滑一次，證明不是重試造成的。
        await swipe(touch, RIGHT_SWIPE_START, { dx: CLEAR_DISTANCE_PX });
        await expectPanel(page, true, 'a second right swipe opens the sidebar again');
        await swipe(touch, LEFT_SWIPE_START, { dx: -CLEAR_DISTANCE_PX });
        await expectPanel(page, false, 'a second left swipe closes the sidebar again');
    });

    test('a swipe shorter than 50px does nothing, while one past 50px acts', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, ANDROID_PHONE);
        await armSwipe(page, touch);

        // FEATURES.md:193、03-ui-adjustments.md:105：|dx| ≥ 50px 才觸發，兩個方向都一樣。
        await swipe(touch, RIGHT_SWIPE_START, { dx: BELOW_THRESHOLD_PX });
        await expectStaysClosed(page, `a ${BELOW_THRESHOLD_PX}px right swipe must not open the sidebar`);
        await swipe(touch, RIGHT_SWIPE_START, { dx: ABOVE_THRESHOLD_PX });
        await expectPanel(page, true, `a ${ABOVE_THRESHOLD_PX}px right swipe opens the sidebar`);

        await swipe(touch, LEFT_SWIPE_START, { dx: -BELOW_THRESHOLD_PX });
        await expectStaysOpen(page, `a ${BELOW_THRESHOLD_PX}px left swipe must not close the sidebar`);
        await swipe(touch, LEFT_SWIPE_START, { dx: -ABOVE_THRESHOLD_PX });
        await expectPanel(page, false, `a ${ABOVE_THRESHOLD_PX}px left swipe closes the sidebar`);
    });

    test('a left swipe does not open a closed sidebar', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, ANDROID_PHONE);
        await armSwipe(page, touch);

        // FEATURES.md:192、03-ui-adjustments.md:110：左滑只會關閉側邊欄。
        await swipe(touch, LEFT_SWIPE_START, { dx: -CLEAR_DISTANCE_PX });
        await expectStaysClosed(page, 'a left swipe must not open a closed sidebar');
    });

    test('a right swipe does not close an open sidebar', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, ANDROID_PHONE);
        await armSwipe(page, touch);
        await swipe(touch, RIGHT_SWIPE_START, { dx: CLEAR_DISTANCE_PX });
        await expectPanel(page, true, 'a right swipe opens the sidebar (control)');

        // FEATURES.md:192、03-ui-adjustments.md:110：右滑只會開啟側邊欄。
        await swipe(touch, RIGHT_SWIPE_START, { dx: CLEAR_DISTANCE_PX });
        await expectStaysOpen(page, 'a right swipe must not close an open sidebar');
    });

    test('vertical scrolling and a swipe that is not mostly horizontal do nothing', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, ANDROID_PHONE);
        await armSwipe(page, touch);

        // FEATURES.md:193：垂直捲動不會觸發。
        await swipe(touch, RIGHT_SWIPE_START, { dx: 0, dy: -CLEAR_DISTANCE_PX });
        await expectStaysClosed(page, 'a vertical scroll must not open the sidebar');
        // 03-ui-adjustments.md:106：|dx| > |dy| × 1.5 才算水平為主；60 不大於 50 × 1.5 = 75。
        await swipe(touch, RIGHT_SWIPE_START, { dx: 60, dy: 50 });
        await expectStaysClosed(page, 'a 60px right / 50px down swipe is not mostly horizontal and must not open the sidebar');
        // 60 大於 30 × 1.5 = 45，且 60 ≥ 50：水平為主的斜向滑動會觸發。
        await swipe(touch, RIGHT_SWIPE_START, { dx: 60, dy: 30 });
        await expectPanel(page, true, 'a 60px right / 30px down swipe is mostly horizontal and opens the sidebar');
    });

    test('a slow drag does nothing, while the same swipe done fast acts', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, ANDROID_PHONE);
        await armSwipe(page, touch);

        // FEATURES.md:193、03-ui-adjustments.md:107：歷時 < 500ms 才觸發。
        await swipe(touch, RIGHT_SWIPE_START, { dx: CLEAR_DISTANCE_PX, durationMs: SLOW_MS });
        await expectStaysClosed(page, `a right drag lasting ${SLOW_MS}ms must not open the sidebar`);
        await swipe(touch, RIGHT_SWIPE_START, { dx: CLEAR_DISTANCE_PX, durationMs: FAST_MS });
        await expectPanel(page, true, `the same right swipe lasting ${FAST_MS}ms opens the sidebar`);
    });

    test('a swipe that starts in the 10% edge margins does nothing, while one just inside acts', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, ANDROID_PHONE);
        await armSwipe(page, touch);

        // FEATURES.md:192、03-ui-adjustments.md:100：起點 x 須在 [41.2, 370.8]；x = 30 落在左側邊界內。
        await swipe(touch, { x: 30, y: MID_Y }, { dx: CLEAR_DISTANCE_PX });
        await expectStaysClosed(page, 'a right swipe starting in the left 10% margin must not open the sidebar');
        // 03-ui-adjustments.md:101：起點 y 須在 [91.5, 823.5]；y = 70 落在頂端邊界內。
        await swipe(touch, { x: RIGHT_SWIPE_START.x, y: 70 }, { dx: CLEAR_DISTANCE_PX });
        await expectStaysClosed(page, 'a right swipe starting in the top 10% margin must not open the sidebar');
        await swipe(touch, { x: 55, y: MID_Y }, { dx: CLEAR_DISTANCE_PX });
        await expectPanel(page, true, 'a right swipe starting just inside the left margin opens the sidebar');

        // 03-ui-adjustments.md:100：x = 385 落在右側邊界內。
        await swipe(touch, { x: 385, y: MID_Y }, { dx: -CLEAR_DISTANCE_PX });
        await expectStaysOpen(page, 'a left swipe starting in the right 10% margin must not close the sidebar');
        await swipe(touch, LEFT_SWIPE_START, { dx: -CLEAR_DISTANCE_PX });
        await expectPanel(page, false, 'a left swipe starting inside the central area closes the sidebar');
    });

    test('turning the master switch off stops the swipe, and turning it back on restores it', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, ANDROID_PHONE);
        await armSwipe(page, touch);
        const overlay = page.locator(PRESET_OVERLAY_SELECTOR);
        await expect(overlay, 'the preset overlay is shown while the master switch is on (precondition)').toBeVisible();

        // FEATURES.md:195：跟隨總開關；03-ui-adjustments.md:114：切換即時生效，不需重新載入。
        await settings.set({ isEnabled: false });
        await expect(overlay, 'the page has applied the master switch off (sync point)').toBeHidden();
        await swipe(touch, RIGHT_SWIPE_START, { dx: CLEAR_DISTANCE_PX });
        await expectStaysClosed(page, 'with the master switch off a right swipe must not open the sidebar');

        await settings.set({ isEnabled: true });
        await expect(overlay, 'the page has applied the master switch on (sync point)').toBeVisible();
        await openWithFirstSwipe(page, touch, 'after the master switch turns back on a right swipe opens the sidebar');
    });

    test('a desktop browser that reports touch points gets no swipe gesture', async ({ page, settings, touch }) => {
        await pinSettings(settings);
        await loadConversationAs(page, touch, TOUCH_DESKTOP);

        // FEATURES.md:190：只在手機上運作；03-ui-adjustments.md:98：桌機 User-Agent 即使回報觸控點仍是桌機。
        // 同樣的窄版面、同樣的手勢，分幾輪滑動，涵蓋擴充功能每 500ms 重試綁定的時間。
        for (let round = 1; round <= DESKTOP_SWIPE_ROUNDS; round += 1) {
            await swipe(touch, RIGHT_SWIPE_START, { dx: CLEAR_DISTANCE_PX });
            await expectStaysClosed(page, `round ${round}: on a touch-reporting desktop a right swipe must not open the sidebar`);
        }

        // 同一分頁改為手機重新載入，同樣的手勢就會開啟側邊欄，證明上面的結果來自裝置判斷。
        await loadConversationAs(page, touch, ANDROID_PHONE);
        await openWithFirstSwipe(page, touch, 'the same right swipe opens the sidebar once the tab is a phone (control)');
    });
});
