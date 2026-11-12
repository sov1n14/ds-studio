import { test, expect } from './fixtures.js';
import { expectNeverWithin } from './helpers/observation.js';
import { armReplyStub, expectReplyStreaming, finishAndAwaitToolbar, openHome, sendStubbedPrompt } from './helpers/reply-stub.js';

// 自動展開訊息（docs/FEATURES.md 的 Auto Expand Messages；docs/spec/03-ui-adjustments.md 第 16 節）：
// - 總開關與 dsAutoExpandMessages 都開啟時，頁面上已收合的訊息與之後才掛載的收合訊息都會被展開，而且每則只按一次（不會被再按一次而收合回去）。
// - 關閉 dsAutoExpandMessages 時，畫面上已展開的訊息會收合回去。
// - dsAutoExpandMessages 關閉，或總開關關閉時，收合的訊息維持收合。
// 使用真實頁面的 DOM：在首頁送出一段很長的使用者文字，DeepSeek 會把這則使用者泡泡渲染成可收合的文字框（2026-11-12 實測：收合時 `.ds-collapsible-text` 帶 `max-height: 192px`，圖示為 `rotate(180deg)`；手動展開後高度約 1008 px）。
// 回覆由瀏覽器內替身提供（helpers/reply-stub.js），沒有任何訊息抵達 DeepSeek。觀察的是使用者看得到的結果：文字框實際顯示的高度與全文是否完整顯示。所有寫入的儲存鍵在測試後還原。

const PROBE_LINE = 'e2e auto-expand probe line';
// 40 行文字遠高於收合上限，展開與收合的高度差距一目了然。
const LONG_PROMPT = Array.from({ length: 40 }, (_, index) => `${PROBE_LINE} ${index + 1}`).join('\n');
// DeepSeek 收合長文字時的高度上限（live 實測與 test/fixtures/ds-snapshots/conv2-finished-visible-items-collapsible.html 皆為 192px）。
const COLLAPSED_MAX_PX = 192;
// 證明「沒有發生」的觀察窗長度；觀察窗本身就是斷言。
const NEVER_WINDOW_MS = 3_000;

/** 設定自動展開開關與總開關，一次寫一個鍵，總開關最後寫；臨時對話固定關閉，離開頁面時不會刪除 DeepSeek 預先建立的對話。 */
async function pinSettings(settings, { autoExpand, master = true }) {
    await settings.setInBothAreas({ dsAutoExpandMessages: autoExpand });
    await settings.set({ 'dss-temporary-chat-enabled': false });
    await settings.set({ isEnabled: master });
}

/** 載入首頁、送出長文字並讓替身回覆完成；回傳時使用者泡泡的可收合文字框已掛載。 */
async function sendLongPromptAndFinish(page) {
    const stub = await armReplyStub(page);
    await openHome(page);
    await expect(probeText(page), 'no probe bubble exists before sending (precondition)').toHaveCount(0);
    await sendStubbedPrompt(page, LONG_PROMPT);
    await expectReplyStreaming(page);
    await finishAndAwaitToolbar(page, stub);
    await expect(probeText(page), 'the long user bubble is rendered as collapsible text (precondition)').toHaveCount(1);
}

/** 長文字使用者泡泡的可收合文字框。 */
function probeText(page) {
    return page.locator('.ds-collapsible-text', { hasText: PROBE_LINE });
}

/**
 * 長文字泡泡目前的顯示狀態：'collapsed'（高度不超過收合上限）、'fully shown'（高度達到全文高度，沒有任何內容被裁掉），否則為展開動畫途中的 'clipped at <高度> of <全文高度>'。
 * DeepSeek 的展開動畫約 150 ms，動畫途中的切換點擊會被忽略（2026-11-12 實測），所以「已展開」以全文完整顯示為準，不以高度剛超過某個門檻為準。
 */
function probeState(page) {
    return probeText(page).evaluate((box, max) => {
        const height = Math.round(box.getBoundingClientRect().height);
        if (height <= max) return 'collapsed';
        if (height >= box.scrollHeight - 1) return 'fully shown';
        return `clipped at ${height} of ${box.scrollHeight}`;
    }, COLLAPSED_MAX_PX);
}

/** 頁面內判斷式：長文字泡泡顯示高度大於 `min`（開始展開即成立）。 */
function probeTallerThan({ text, min }) {
    const box = [...document.querySelectorAll('.ds-collapsible-text')].find((node) => node.textContent.includes(text));
    return Boolean(box) && box.getBoundingClientRect().height > min;
}

/** 頁面內判斷式：長文字泡泡顯示高度不超過收合上限。 */
function probeCollapsedTo({ text, max }) {
    const box = [...document.querySelectorAll('.ds-collapsible-text')].find((node) => node.textContent.includes(text));
    return Boolean(box) && box.getBoundingClientRect().height <= max;
}

async function expectExpanded(page, message) {
    await expect.poll(() => probeState(page), { message }).toBe('fully shown');
}

async function expectCollapsed(page, message) {
    await expect.poll(() => probeState(page), { message }).toBe('collapsed');
}

test.describe('auto expand messages', () => {
    test('with the setting off a collapsed message stays collapsed; switching it on expands it; switching it off collapses it again', async ({ page, settings }) => {
        await pinSettings(settings, { autoExpand: false });
        await sendLongPromptAndFinish(page);
        await expectCollapsed(page, 'DeepSeek shows the long bubble collapsed (precondition)');

        await expectNeverWithin(page, probeTallerThan, { text: PROBE_LINE, min: COLLAPSED_MAX_PX }, NEVER_WINDOW_MS, 'with dsAutoExpandMessages off the collapsed bubble may not expand');

        await settings.setInBothAreas({ dsAutoExpandMessages: true });
        await expectExpanded(page, 'switching dsAutoExpandMessages on expands the collapsed bubble already on the page');

        await settings.setInBothAreas({ dsAutoExpandMessages: false });
        await expectCollapsed(page, 'switching dsAutoExpandMessages off collapses the expanded bubble again');
    });

    test('with the setting on a collapsed message that mounts later is expanded once and stays expanded', async ({ page, settings }) => {
        await pinSettings(settings, { autoExpand: true });
        await sendLongPromptAndFinish(page);
        await expectExpanded(page, 'the long bubble mounted after the page loaded is expanded');

        await expectNeverWithin(page, probeCollapsedTo, { text: PROBE_LINE, max: COLLAPSED_MAX_PX }, NEVER_WINDOW_MS, 'the expanded bubble may not be clicked again and collapse');
    });

    test('with the master switch off an enabled auto expand leaves the message collapsed; switching the master on expands it', async ({ page, settings }) => {
        await pinSettings(settings, { autoExpand: true, master: false });
        await sendLongPromptAndFinish(page);
        await expectCollapsed(page, 'DeepSeek shows the long bubble collapsed (precondition)');

        await expectNeverWithin(page, probeTallerThan, { text: PROBE_LINE, min: COLLAPSED_MAX_PX }, NEVER_WINDOW_MS, 'with the master switch off the collapsed bubble may not expand');

        await settings.set({ isEnabled: true });
        await expectExpanded(page, 'switching the master on expands the collapsed bubble');
    });
});
