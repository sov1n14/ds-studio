import { devices } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { armReplyStub, openHome, REPLY_MESSAGE_ID, sendStubbedPrompt, sseEvent, USER_MESSAGE_ID } from './helpers/reply-stub.js';
import { wheelOverList } from './helpers/scroll.js';
import { normalizeToSelector } from './helpers/selector-normalizer.js';
import { DSSelectors } from './helpers/selectors.js';
import { readSidebar, setNativeSidebar } from './helpers/sidebar.js';

// 選擇器健康檢查：在離線通道的 HAR 重播上，確認 content/ds-selectors.js 匯出的每個 DeepSeek 選擇器在它所屬的頁面狀態下至少命中一個元素。
// 使用者錄製新的 HAR 時執行本檔：DeepSeek 改版輪換 class 名稱後，失效的選擇器會以「鍵名、選擇器、頁面狀態」具名失敗。
// 每個測試把頁面帶到一個狀態，逐鍵軟斷言該狀態宣告的鍵；最後一個測試確認每個匯出的鍵都歸屬某個狀態、允許不命中清單或非選擇器清單。
// 總開關固定關閉，量到的是 DeepSeek 自己渲染的 DOM，擴充功能的注入與改寫不會影響計數。回覆由瀏覽器內替身或中止的請求提供，沒有任何訊息抵達 DeepSeek。

const SELECTOR_BY_KEY = Object.fromEntries(Object.entries(DSSelectors).map(([key, value]) => [key, normalizeToSelector(value)]));
const INVALID = -1;
// 晚掛載的元素（虛擬列表、提示框、替身回覆）有這麼久的時間出現。
const SETTLE_MS = 10_000;

// 不是選擇器的匯出值：屬性名稱、SVG path 前綴與 class 陣列，由消費端自行組合。
const NON_SELECTOR_KEYS = ['VIRTUAL_ITEM_KEY_ATTR', 'SEARCH_ICON_PATH_PREFIX', 'EDIT_SEND_BUTTON_VARIANT_CLASSES'];
// 在 HAR 重播上已證實到不了任何頁面狀態的鍵，每個附一行原因。
const ALLOWED_NOWHERE_KEYS = [];

const STATE_KEYS = {
    home: [
        'SCROLL_AREA_CLASS', 'ICON_BUTTON_ROLE_SELECTOR', 'INPUT_TEXTAREA_SELECTOR', 'ANY_TEXTAREA_SELECTOR', 'ROLE_BUTTON_DIV_SELECTOR',
        'TOGGLE_BUTTON_SELECTOR', 'TOGGLE_BUTTON_FALLBACK_SELECTOR', 'SCROLL_ROOT_SELECTOR', 'CHAT_HEADER_SELECTOR', 'NEW_CHAT_HEADER_MODIFIER_SELECTOR',
        'FLOATING_BUTTON_BAR_SELECTOR', 'FLOATING_BUTTON_BAR_DIV_SELECTOR', 'SIDEBAR_WRAPPER_SELECTOR', 'SIDEBAR_INNER_SELECTOR', 'SIDEBAR_DATE_GROUP_SELECTOR',
        'SIDEBAR_DATE_LABEL_CLASS', 'SIDEBAR_CHAT_LINK_SELECTOR', 'SIDEBAR_TITLE_CLASS', 'SIDEBAR_ACTIONS_CLASS', 'SIDEBAR_HAMBURGER_BUTTON_SELECTOR',
        'CHAT_HEADER_TITLE_ROW_SELECTOR', 'CHAT_TITLE_FALLBACK_SELECTOR', 'SEND_BUTTON_ROW_CLASS', 'SEND_BUTTON_ROLE_SELECTOR', 'SEND_BUTTON_ICON_SELECTOR',
        'BUTTON_DISABLED_CLASS', 'DS_BUTTON_CAPSULE_CLASS', 'DS_BUTTON_ICON_LABEL_PRIMARY_CLASS', 'DS_BUTTON_ICON_LABEL_TERTIARY_CLASS', 'DS_BUTTON_XL_CLASS',
        'DS_BUTTON_CIRCLE_CLASS', 'DS_BUTTON_PRIMARY_CLASS', 'DS_BUTTON_FILLED_CLASS',
    ],
    thinkingConversation: [
        'VIRTUAL_LIST_SELECTOR', 'VIRTUAL_LIST_FALLBACK', 'VIRTUAL_LIST_CONTAINER_SELECTOR', 'VIRTUAL_ITEM_KEY_SELECTOR', 'VISIBLE_ITEMS_SELECTOR',
        'MESSAGE_CLASS', 'MESSAGE_SELECTOR', 'MARKDOWN_CLASS', 'MARKDOWN_SELECTOR', 'MARKDOWN_CITE_SELECTOR', 'ASSISTANT_MAIN_CONTENT_SELECTOR',
        'FLEX_ROW_SELECTOR', 'USER_CONTENT_SELECTOR', 'CONTENT_COLUMN_SELECTOR', 'INPUT_COMPOSER_WRAPPER_SELECTOR', 'MESSAGE_TOOLBAR_SELECTOR',
        'EDIT_MESSAGE_BUTTON_SELECTOR', 'GO_TOP_ANCHOR_FALLBACK1_SELECTOR', 'STRAY_BUTTON_CLASS',
        'THINK_CONTENT_CLASS', 'THINK_CONTENT_SELECTOR', 'THINK_BLOCK_CLASS', 'THINK_BLOCK_SELECTOR', 'THINK_SEPARATOR_CLASS', 'THINK_SEPARATOR_SELECTOR',
        'THINK_HEADER_CLASS', 'THINK_HEADER_TOGGLE_SELECTOR', 'THINK_SPACER_CLASS', 'THINK_CONTENT_OUTER_CLASS', 'THINK_CONTENT_MODIFIER_CLASS',
        'THINK_LOADING_DOTS_CLASS', 'THINK_FOOTER_CLASS', 'THINK_ICON_CLASS', 'THINK_HEADER_ICON_ROW_CLASS', 'THINK_TIME_CLASS', 'THINK_DIVIDER_CLASS',
        'THINK_CONTENT_WRAPPER_CLASS', 'THINK_INNER_CONTENT_CLASS', 'THINK_STATUS_CLASS', 'THINK_STATUS_SELECTOR',
        'THINK_REFERENCE_LABEL_SELECTOR', 'THINK_REFERENCE_LINK_SELECTOR',
    ],
    editBoxOpen: ['EDIT_BOX_SELECTOR', 'EDIT_BOX_HEIGHT_CONTAINER_SELECTOR'],
    codeBlockInView: ['CODE_BLOCK_CLASS', 'BUTTON_CONTENT_SELECTOR', 'GO_TOP_ANCHOR_SELECTOR'],
    longThreadAwayFromBottom: ['GO_TOP_NATIVE_BUTTON_CLASS', 'DS_BUTTON_FLOATING_CLASS'],
    sidebarCollapsedHoveringOpen: ['SIDEBAR_NATIVE_COLLAPSED_SELECTOR', 'SIDEBAR_WRAPPER_COLLAPSED_SELECTOR', 'SIDEBAR_OPEN_BUTTON_SELECTOR', 'FLOATING_POSITION_WRAPPER_SELECTOR'],
    phoneHome: ['HOMEPAGE_MOBILE_CLEANUP_SELECTOR'],
    longPromptIncompleteReply: ['EXPAND_BUTTON_CONTAINER_SELECTOR', 'EXPAND_BUTTON_ICON_SELECTOR', 'CONTINUE_BUTTON_SELECTOR', 'CONTINUE_BUTTON_FALLBACK_SELECTOR'],
    failedReply: ['RETRY_BUTTON_SELECTOR'],
};

// 真實 Android 手機：Playwright 內建 Pixel 7 的 User-Agent 與視窗，加上 Android Chrome 回報的 platform。
const PHONE = { userAgent: devices['Pixel 7'].userAgent, viewport: devices['Pixel 7'].viewport, platform: 'Linux armv81', maxTouchPoints: 5 };
// 40 行文字遠高於 DeepSeek 收合使用者泡泡的高度上限（192px），泡泡會帶展開切換鈕。
const LONG_PROMPT = Array.from({ length: 40 }, (_, index) => `e2e selector health line ${index + 1}`).join('\n');
const COMPLETION_ROUTE = '**/api/v0/chat/completion';
// DeepSeek 記住側欄收合狀態（"siderCollapsed"）的 localStorage 鍵；設定檔在同一個 worker 的測試之間沿用。
const LAST_SESSION_KEY = '__appKit_@deepseek/chat_lastSessionValue';

/** 一次完成、狀態為 INCOMPLETE 的 completion 串流（回覆因長度上限中斷），DeepSeek 會在回覆下方掛上「繼續生成」按鈕。 */
function incompleteReplyBody() {
    const response = {
        message_id: REPLY_MESSAGE_ID, parent_id: USER_MESSAGE_ID, model: '', role: 'ASSISTANT', thinking_enabled: false, ban_edit: false, ban_regenerate: false,
        status: 'WIP', incomplete_message: null, accumulated_token_usage: 0, files: [], feedback: null, inserted_at: Date.now() / 1000, search_enabled: false,
        fragments: [{ id: 1, type: 'RESPONSE', content: 'e2e selector health partial reply' }], has_pending_fragment: false, auto_continue: false,
    };
    return [
        sseEvent({ request_message_id: USER_MESSAGE_ID, response_message_id: REPLY_MESSAGE_ID }, 'ready'),
        sseEvent({ v: { response } }),
        sseEvent({ p: 'response/status', o: 'SET', v: 'INCOMPLETE' }),
        sseEvent({ click_behavior: 'none' }, 'close'),
    ].join('');
}

/** 每個鍵在目前頁面上命中的元素數；不合法的選擇器（或不是選擇器的值）記為 INVALID。 */
function countMatches(page, keys) {
    const selectors = Object.fromEntries(keys.map((key) => [key, SELECTOR_BY_KEY[key] ?? null]));
    return page.evaluate(({ map, invalid }) => Object.fromEntries(Object.entries(map).map(([key, selector]) => {
        if (selector === null) return [key, invalid];
        try {
            return [key, document.querySelectorAll(selector).length];
        } catch {
            return [key, invalid];
        }
    })), { map: selectors, invalid: INVALID });
}

/** 輪詢 `check` 直到成立或逾時；逾時不拋錯，交給之後逐鍵的軟斷言具名回報哪個選擇器沒有命中。 */
async function pollUntil(check, timeout = SETTLE_MS) {
    await expect.poll(check, { timeout }).toBe(true).catch(() => {});
}

/** 逐鍵軟斷言 `state` 宣告的鍵在目前頁面至少命中一個元素；等到全部命中或逾時才讀最後的計數。 */
async function expectStateSelectorsMatch(page, state) {
    const keys = STATE_KEYS[state];
    let counts = {};
    await pollUntil(async () => {
        counts = await countMatches(page, keys);
        return keys.every((key) => counts[key] > 0);
    });
    for (const key of keys) {
        const label = `\`${key}\` (\`${SELECTOR_BY_KEY[key]}\`)`;
        if (counts[key] === INVALID) {
            expect.soft(counts[key], `${label} is not a valid selector`).not.toBe(INVALID);
            continue;
        }
        expect.soft(counts[key], `${label} matches no element on ${state}`).toBeGreaterThan(0);
    }
}

/** 載入首頁並送出 `text`；completion 由呼叫端事先安排的路由回答。 */
async function sendFromHome(page, text) {
    await openHome(page);
    await sendStubbedPrompt(page, text);
}

test.describe('selector health on the HAR replay', { tag: '@offline' }, () => {
    test.beforeEach(async ({ settings }) => {
        await settings.set({ isEnabled: false });
    });

    test('home page', async ({ page }) => {
        await page.reload();
        await expectStateSelectorsMatch(page, 'home');
    });

    test('recorded conversation with a thinking block', async ({ openRecorded, page }) => {
        await openRecorded('withThinking');
        await expectStateSelectorsMatch(page, 'thinkingConversation');
    });

    test('native edit box open on a user message', async ({ openRecorded, page }) => {
        await openRecorded('withThinking');
        const item = page.locator(`${DSSelectors.VISIBLE_ITEMS_SELECTOR} > ${DSSelectors.VIRTUAL_ITEM_KEY_SELECTOR}:has(${DSSelectors.USER_CONTENT_SELECTOR})`).first();
        await item.hover();
        await page.locator(DSSelectors.EDIT_MESSAGE_BUTTON_SELECTOR).and(item.locator('[role="button"]')).click();
        // 編輯中的訊息不再含可摺疊文字，item 定位會移到別則訊息，所以改以頁面上的 textarea 數判斷：編輯框加主輸入框。
        await expect(page.locator(DSSelectors.ANY_TEXTAREA_SELECTOR), 'the native edit box opens beside the main composer (precondition)').toHaveCount(2);
        await expectStateSelectorsMatch(page, 'editBoxOpen');
    });

    test('code block scrolled into view', async ({ openPurpose, page }) => {
        await openPurpose('withCodeBlocks');
        // 列表開在底部且只掛載可見訊息：往上捲到某則回覆的程式碼區塊掛載為止。
        await pollUntil(async () => {
            if (await page.locator(SELECTOR_BY_KEY.CODE_BLOCK_CLASS).count() > 0) return true;
            await page.mouse.move(640, 360);
            await page.mouse.wheel(0, -1500);
            return false;
        }, 30_000);
        await expectStateSelectorsMatch(page, 'codeBlockInView');
    });

    test('long thread scrolled away from its bottom', async ({ openPurpose, page }) => {
        await openPurpose('longThread');
        // 原生「回到底部」按鈕只在列表離開底部時掛載。
        await wheelOverList(page, -1500);
        await expectStateSelectorsMatch(page, 'longThreadAwayFromBottom');
    });

    test('sidebar collapsed with the pointer on its open button', async ({ page }) => {
        await page.reload();
        await expect.poll(() => readSidebar(page), { message: 'DeepSeek sidebar is rendered (precondition)' }).not.toBeNull();
        const wasShown = (await readSidebar(page)).panelShown;
        try {
            await setNativeSidebar(page, true);
            // 停在展開按鈕上會叫出提示框，提示框掛在浮動定位容器內。
            const openButton = page.locator(SELECTOR_BY_KEY.SIDEBAR_OPEN_BUTTON_SELECTOR).first();
            if (await openButton.count() > 0) await openButton.hover();
            await expectStateSelectorsMatch(page, 'sidebarCollapsedHoveringOpen');
        } finally {
            // DeepSeek 會記住側邊欄的收合狀態；還原成測試前的樣子，同一個 worker 之後的規格才看得到原本的狀態。
            await setNativeSidebar(page, !wasShown);
        }
    });

    test('home page on a phone', async ({ page }) => {
        // 模擬只作用在這個 page，測試結束時 page fixture 會關閉它。
        // 手機寬度下 DeepSeek 會把 "siderCollapsed":true 寫進 LAST_SESSION_KEY；測試前存下原值、結束前寫回，同一個 worker 之後的規格才看得到測試前的側欄狀態。
        const savedSession = await page.evaluate((key) => localStorage.getItem(key), LAST_SESSION_KEY);
        try {
            const cdp = await page.context().newCDPSession(page);
            await page.setViewportSize(PHONE.viewport);
            await cdp.send('Emulation.setUserAgentOverride', { userAgent: PHONE.userAgent, platform: PHONE.platform });
            await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: PHONE.maxTouchPoints });
            await page.reload();
            expect(await page.evaluate(() => navigator.userAgent), 'the page sees the phone User-Agent (precondition)').toBe(PHONE.userAgent);
            await expectStateSelectorsMatch(page, 'phoneHome');
        } finally {
            await page.evaluate(({ key, value }) => {
                if (value === null) localStorage.removeItem(key);
                else localStorage.setItem(key, value);
            }, { key: LAST_SESSION_KEY, value: savedSession });
        }
    });

    test('long prompt whose reply ends incomplete', async ({ page }) => {
        await armReplyStub(page, { completionBody: incompleteReplyBody() });
        await sendFromHome(page, LONG_PROMPT);
        await expectStateSelectorsMatch(page, 'longPromptIncompleteReply');
    });

    test('reply whose request fails', async ({ page }) => {
        await page.route(COMPLETION_ROUTE, (route) => route.abort());
        await sendFromHome(page, 'e2e selector health failed reply');
        await expectStateSelectorsMatch(page, 'failedReply');
    });

    test('every exported key is checked in a page state, allowed to match nowhere, or not a selector', () => {
        const covered = new Set([...Object.values(STATE_KEYS).flat(), ...ALLOWED_NOWHERE_KEYS, ...NON_SELECTOR_KEYS]);
        for (const key of Object.keys(DSSelectors)) {
            expect.soft(covered.has(key), `${key} is checked in no page state`).toBe(true);
        }
    });
});
