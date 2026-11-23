import { test as base, expect } from './fixtures.js';
import { blockSendRequests, composer } from './helpers/composer.js';
import { conversationOtherThan, DEEPSEEK_ORIGIN, openConversation } from './helpers/conversations.js';
import { runUnpaced } from './helpers/human.js';
import { TEMP_CHAT_ROW_SELECTOR } from './helpers/extension-ui.js';
import { openHome } from './helpers/reply-stub.js';
import { readBothAreas } from './helpers/settings.js';
import { setNativeSidebar } from './helpers/sidebar.js';
import { DEVICE_ID_KEY, ENABLED_KEY, expectNoFurtherDeletes, hasOpenUuidKey, pinTempChatSettings, PROBE_PROMPT, queueEntry, sendFirstMessageFromHome, withDeleteGuard } from './helpers/temp-chat-delete.js';

// 臨時對話的建立與刪除（docs/FEATURES.md 的 Temporary Conversation；docs/spec/04-features.md 第 21 節）。
// 首頁開關的列是否出現已由 temp-chat-toggle.e2e.js 涵蓋；這裡驗證開關本身的開／關狀態、首次送出時的標記、離開與關閉分頁時的刪除（docs/FEATURES.md 的 Privacy Guarantee），以及歷史對話與重新整理不會刪除。
// 安全規則：
// - 每一次 `chat_session/delete` 請求都經過 helpers/temp-chat-delete.js 的刪除攔截；沒有任何真實的刪除抵達 DeepSeek。
// - 新對話中的送出由瀏覽器內替身回覆（helpers/reply-stub.js），歷史對話中的送出在瀏覽器內中止；沒有任何訊息抵達 DeepSeek。
// - 錄製中的對話（helpers/har-replay.js 的 `deepseekReplay.conversations`）只開啟、從不刪除。
// - 測試中觸及的儲存鍵（開關、刪除佇列、權杖快取、裝置 id、開啟中對話與租約觀察鍵）在測試後還原；權杖值從不讀出或印出。

const ROW_LABEL = '臨時對話';
const TRACKED_UUID_SESSION_KEY = 'dss-temporary-chat-uuid';

// docs/spec/04-features.md:125 的開關顏色：文字關閉 #f9fafb、開啟 #679efe；開啟時軌道 #4d6bfe。
const LABEL_OFF_COLOR = 'rgb(249, 250, 251)';
const LABEL_ON_COLOR = 'rgb(103, 158, 254)';
const TRACK_ON_COLOR = 'rgb(77, 107, 254)';

const test = withDeleteGuard(base);

function row(page) {
    return page.locator(TEMP_CHAT_ROW_SELECTOR);
}

function rowSwitch(page) {
    return row(page).getByRole('checkbox', { name: ROW_LABEL });
}

/** 使用者點按開關（可見的軌道外框；核取方塊本身沒有尺寸）。 */
async function clickSwitch(page) {
    await row(page).locator('label').click();
}

/** 這個分頁 sessionStorage 中記錄的臨時對話 uuid。 */
function trackedUuid(page) {
    return page.evaluate((key) => sessionStorage.getItem(key), TRACKED_UUID_SESSION_KEY);
}

/**
 * 重新整理後讓對話 `id` 以「已有訊息」的狀態載入。
 * 替身回覆沒有寫入伺服器，DeepSeek 重新載入沒有訊息的對話時會導回首頁（2026-11-12 實測：history_messages 回傳 `is_empty: true` 後頁面轉到 `/`），那是一次離開；真實送出後的對話不會如此。
 * 錄製裡也沒有 `id` 這個對話，因此它的頁面與 history_messages 改以錄製中一個對話的訊息提供（`deepseekReplay.serveConversationAs`，helpers/har-replay.js），並把其中的對話 id 換成 `id`。
 */
function serveHistoryWithMessages(page, replay, id) {
    return replay.serveConversationAs(page, id, 'withSearch');
}

/** 以 `reload()` 重新整理已標記的對話 `id`，斷言重新整理不送出刪除請求，對話仍被追蹤且仍在待刪佇列中。 */
async function expectRefreshKeepsConversation(page, context, deleteGuard, replay, id, reload) {
    await expect.poll(() => trackedUuid(page), { message: 'the new conversation is tracked before the refresh (precondition)' }).toBe(id);
    await serveHistoryWithMessages(page, replay, id);

    await reload();
    await expect(page, 'the refresh stays on the temporary conversation (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/a/chat/s/${id}`);
    await expectNoFurtherDeletes(page, deleteGuard, 'no delete request follows the refresh');
    expect(deleteGuard.ownedDeleteIds(), 'the refresh sends no delete request for the temporary conversation').toEqual([]);
    expect(await trackedUuid(page), 'the conversation is still tracked after the refresh').toBe(id);
    expect(await queueEntry(context, id).then((entry) => entry?.chatUuid ?? null), 'the conversation stays queued after the refresh').toBe(id);
    expect(deleteGuard.refused(), 'no delete request for any conversation the test did not create').toEqual([]);
}

/** 點按 DeepSeek 側欄中保留對話的連結（站內 SPA 導覽）。 */
async function openKeptFromSidebar(page, uuid) {
    // 前提：側欄展開、連結可見。同一個 worker 先前的測試可能讓 DeepSeek 在設定檔中記住收合狀態（例如手機視窗寬度下載入頁面），因此點按前先展開側欄。
    await setNativeSidebar(page, false);
    await page.locator(`a[href="/a/chat/s/${uuid}"]`).first().click();
    await expect(page, 'the sidebar link opens the kept conversation (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/a/chat/s/${uuid}`);
}

// 回放的 history 與 chat_session/create 答覆各延遲 400 毫秒（真實伺服器的延遲）：即時的 create 答覆早於擴充功能頁面世界掛鉤的安裝，掛鉤便看不到該次 create，第一次送出也就不會配對到任何對話。
test.use({ replayLatency: { history: 400, create: 400 } });

test.describe('temporary conversation', { tag: '@offline' }, () => {
    test('the switch shows its off and on state, follows a change made in another tab, and keeps its state while leaving and returning to the home page', async ({ page, context, settings, deleteGuard, deepseekReplay }) => {
        await pinTempChatSettings(settings, { tempChat: false });
        await openHome(page);
        const label = row(page).getByText(ROW_LABEL, { exact: true });

        // docs/spec/04-features.md:125：關閉時文字為 #f9fafb。
        await expect(rowSwitch(page), 'the switch is off while the stored state is off').not.toBeChecked();
        await expect(label, 'the off label uses the documented off color').toHaveCSS('color', LABEL_OFF_COLOR);

        await clickSwitch(page);
        // docs/spec/04-features.md:125：開啟時文字 #679efe、軌道 #4d6bfe；docs/FEATURES.md:107：狀態存於 chrome.storage.local 的 dss-temporary-chat-enabled。
        await expect(rowSwitch(page), 'clicking the switch turns it on').toBeChecked();
        await expect(label, 'the on label uses the documented on color').toHaveCSS('color', LABEL_ON_COLOR);
        await expect(row(page).locator('label > span'), 'the on track uses the documented on color').toHaveCSS('background-color', TRACK_ON_COLOR);
        await expect.poll(async () => (await readBothAreas(context, [ENABLED_KEY])).local[ENABLED_KEY], { message: 'turning the switch on stores true under dss-temporary-chat-enabled' }).toBe(true);

        // docs/FEATURES.md:107：狀態跨分頁保存，同時開啟的分頁即時同步。
        const other = await context.newPage();
        try {
            await openHome(other);
            await expect(rowSwitch(other), 'a tab opened afterwards shows the switch on').toBeChecked();
            await clickSwitch(other);
            await expect(rowSwitch(other), 'clicking the switch in the other tab turns it off there').not.toBeChecked();
            await expect(rowSwitch(page), 'the first tab follows the other tab and shows the switch off').not.toBeChecked();
            await clickSwitch(other);
            await expect(rowSwitch(page), 'the first tab follows the other tab and shows the switch on again').toBeChecked();
        } finally {
            await other.close();
        }

        // docs/FEATURES.md:105：離開首頁時開關被移除，回到首頁再出現，且移除不改變開關狀態。
        await openKeptFromSidebar(page, deepseekReplay.requireConversation('withSearch').id);
        await expect(row(page), 'leaving the home page removes the switch row').toHaveCount(0);
        await page.goBack();
        await expect(page, 'back on the home page (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/`);
        await expect(rowSwitch(page), 'returning to the home page shows the switch still on').toBeChecked();
        expect(deleteGuard.ownedDeleteIds(), 'no conversation was sent and nothing is deleted').toEqual([]);
        expect(deleteGuard.refused(), 'no delete request for any conversation the test did not create').toEqual([]);
    });

    test('with the switch on, the first send in a new conversation marks it as temporary', async ({ page, context, settings, deleteGuard }) => {
        await pinTempChatSettings(settings, { tempChat: true });
        const sendStartedAt = Date.now();
        const id = await sendFirstMessageFromHome(page, deleteGuard);

        // docs/FEATURES.md:108：目前追蹤的臨時對話存於分頁 sessionStorage 的 dss-temporary-chat-uuid。
        await expect.poll(() => trackedUuid(page), { message: 'the new conversation is tracked as temporary in this tab' }).toBe(id);
        // docs/spec/04-features.md:114、:147、:156：標記時登記到 sync 的待刪佇列，項目帶租約時間戳與本裝置 id。
        await expect.poll(() => queueEntry(context, id).then((entry) => entry?.chatUuid ?? null), { message: 'the new conversation is queued for deletion in dss-pending-deletes-sync' }).toBe(id);
        const entry = await queueEntry(context, id);
        const readAt = Date.now();
        const { local } = await readBothAreas(context, [DEVICE_ID_KEY]);
        // docs/spec/04-features.md:156：lastActiveAt 是 epoch 毫秒的租約時間戳；標記與心跳續租都發生在這次送出之後、讀取佇列之前（同一台機器的時鐘）。
        expect(entry.lastActiveAt, `the lease timestamp is epoch milliseconds no earlier than the send (send started at ${sendStartedAt})`).toBeGreaterThanOrEqual(sendStartedAt);
        expect(entry.lastActiveAt, `the lease timestamp is epoch milliseconds no later than reading the queue (read at ${readAt})`).toBeLessThanOrEqual(readAt);
        expect(entry.ownerDeviceId, 'the queued entry is owned by this device (dss-device-id)').toBe(local[DEVICE_ID_KEY]);
        // docs/spec/04-features.md:114、:149：同時加入本機開啟中對話集合（dss-open-temp-uuid:<uuid>）。
        await expect.poll(() => hasOpenUuidKey(context, id), { message: 'the new conversation is in the local open set' }).toBe(true);

        expect(deleteGuard.ownedDeleteIds(), 'staying in the conversation deletes nothing').toEqual([]);
        expect(deleteGuard.refused(), 'no delete request for any conversation the test did not create').toEqual([]);
    });

    test('leaving a temporary conversation for the home page deletes exactly that conversation and dequeues it', async ({ page, context, settings, deleteGuard }) => {
        await pinTempChatSettings(settings, { tempChat: true });
        const id = await sendFirstMessageFromHome(page, deleteGuard);
        await expect.poll(() => trackedUuid(page), { message: 'the new conversation is tracked before leaving (precondition)' }).toBe(id);

        // docs/FEATURES.md:110：返回首頁（上一頁）會觸發刪除；docs/spec/04-features.md:99：刪除請求的本文為 { chat_session_id: <uuid> }。
        await page.goBack();
        await expect(page, 'back on the home page (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/`);
        await expect.poll(() => deleteGuard.ownedDeleteIds(), { message: 'leaving sends one delete request for the temporary conversation' }).toEqual([id]);
        await expectNoFurtherDeletes(page, deleteGuard, 'no second delete request follows');

        // docs/spec/04-features.md:136、:145、:153：刪除成功後清除追蹤並從待刪佇列與開啟中集合移除。
        await expect.poll(() => trackedUuid(page), { message: 'the deleted conversation is no longer tracked in this tab' }).toBe(null);
        await expect.poll(() => queueEntry(context, id), { message: 'the deleted conversation is removed from dss-pending-deletes-sync' }).toBe(null);
        await expect.poll(() => hasOpenUuidKey(context, id), { message: 'the deleted conversation is removed from the local open set' }).toBe(false);
        expect(deleteGuard.refused(), 'no delete request for any conversation the test did not create').toEqual([]);
    });

    test('leaving a temporary conversation for another conversation deletes exactly that conversation and never the one opened', async ({ page, settings, deleteGuard, deepseekReplay }) => {
        await pinTempChatSettings(settings, { tempChat: true });
        const id = await sendFirstMessageFromHome(page, deleteGuard);
        await expect.poll(() => trackedUuid(page), { message: 'the new conversation is tracked before leaving (precondition)' }).toBe(id);

        // docs/FEATURES.md:110：切換到另一個對話會觸發刪除；docs/FEATURES.md:117：進入非臨時的歷史對話不會刪除它。
        await openKeptFromSidebar(page, deepseekReplay.requireConversation('mostMessages').id);
        await expect.poll(() => deleteGuard.ownedDeleteIds(), { message: 'switching conversations sends one delete request for the temporary conversation' }).toEqual([id]);
        await expectNoFurtherDeletes(page, deleteGuard, 'no further delete request follows');
        expect(deleteGuard.refused(), 'the conversation switched to is never sent for deletion').toEqual([]);
    });

    test('with the switch on, a history conversation opened and sent to right after loading is never marked and leaving it deletes nothing', async ({ page, context, settings, deleteGuard, deepseekReplay }) => {
        const kept = deepseekReplay.requireConversation('withSearch').id;
        const other = conversationOtherThan(deepseekReplay, kept).id;
        await pinTempChatSettings(settings, { tempChat: true });
        // 替身回覆的訊息 id 會與既有對話的訊息樹衝突，使頁面停止回應（2026-11-12 實測）；歷史對話中的送出改為在瀏覽器內中止，請求本文照樣可讀。
        const blocked = await blockSendRequests(page);

        // docs/FEATURES.md:100：歷史對話即使開關開啟、開啟後立刻送出訊息，也不會被標記或刪除。
        await openConversation(page, kept);
        // The send must follow the load at once (that race is under test), so it is neither typed key by key nor paused.
        await runUnpaced(async () => {
            await composer(page).fill(PROBE_PROMPT);
            await composer(page).press('Enter');
        });
        await expect.poll(() => blocked.requests().length, { message: 'the send went out as a completion request and was aborted (precondition)' }).toBeGreaterThan(0);
        expect(blocked.requests()[0].body?.chat_session_id, 'the send went into the history conversation (precondition)').toBe(kept);
        await openKeptFromSidebar(page, other);
        await expectNoFurtherDeletes(page, deleteGuard, 'leaving the history conversation sends no delete request');

        expect(deleteGuard.refused(), 'no delete request for the history conversation or any other kept conversation').toEqual([]);
        expect(deleteGuard.ownedDeleteIds(), 'no delete request at all').toEqual([]);
        expect(await queueEntry(context, kept), 'the history conversation is never queued for deletion').toBe(null);
        expect(await hasOpenUuidKey(context, kept), 'the history conversation is never added to the open set').toBe(false);
        expect(await trackedUuid(page), 'no conversation is tracked as temporary in this tab').toBe(null);
    });

    test('refreshing a temporary conversation with F5 deletes nothing and keeps it tracked', async ({ page, context, settings, deleteGuard, deepseekReplay }) => {
        await pinTempChatSettings(settings, { tempChat: true });
        const id = await sendFirstMessageFromHome(page, deleteGuard);

        // docs/FEATURES.md:113：按 F5 重新整理不觸發刪除；docs/FEATURES.md:108：追蹤在重新整理後仍有效。
        // 頁面先收到 F5 按鍵，再由瀏覽器重新載入（以 CDP 合成的按鍵不會觸發瀏覽器的重新整理快捷鍵，因此重新載入由 page.reload() 代為執行）。
        await expectRefreshKeepsConversation(page, context, deleteGuard, deepseekReplay, id, async () => {
            await page.keyboard.press('F5');
            await page.reload();
        });
    });

    test('refreshing a temporary conversation with the browser refresh button deletes nothing and keeps it tracked', async ({ page, context, settings, deleteGuard, deepseekReplay }) => {
        await pinTempChatSettings(settings, { tempChat: true });
        const id = await sendFirstMessageFromHome(page, deleteGuard);

        // docs/FEATURES.md:113：按瀏覽器的重新整理按鈕不觸發刪除；docs/FEATURES.md:108：追蹤在重新整理後仍有效。
        // page.reload() 與重新整理按鈕同為瀏覽器發起的重新載入：頁面收不到按鍵，也不觸發 Navigation API 的 navigate 事件（2026-11-12 實測）。
        await expectRefreshKeepsConversation(page, context, deleteGuard, deepseekReplay, id, () => page.reload());
    });
});

/** 開啟分頁並等待新對話被追蹤與排入待刪佇列；回傳分頁與 uuid。 */
async function openTrackedTemporaryTab(context, deleteGuard) {
    const tab = await context.newPage();
    const id = await sendFirstMessageFromHome(tab, deleteGuard);
    await expect.poll(() => trackedUuid(tab), { message: 'the new conversation is tracked before the close (precondition)' }).toBe(id);
    await expect.poll(() => queueEntry(context, id).then((entry) => entry?.chatUuid ?? null), { message: 'the new conversation is queued before the close (precondition)' }).toBe(id);
    return { tab, id };
}

/** 使用者關閉分頁：瀏覽器執行 beforeunload 後關閉（頁面若跳出離開確認則接受）；回傳關閉完成的時間。 */
async function closeTabLikeUser(tab) {
    tab.on('dialog', (dialog) => dialog.accept());
    const closed = tab.waitForEvent('close');
    await tab.close({ runBeforeUnload: true });
    await closed;
    return Date.now();
}

// docs/FEATURES.md 的 Privacy Guarantee：瀏覽器仍開著時關閉分頁，對話約在 10 秒後刪除；在那之前不刪，以免把重新整理誤當成離開。
// 每個案例另留著 fixture 的首頁分頁，代表瀏覽器仍開著；觀察窗在這個分頁上計時。
test.describe('temporary conversation: closing the tab', { tag: '@offline' }, () => {
    test('closing the tab of a temporary conversation deletes exactly that conversation about 10 seconds later and dequeues it', async ({ page, context, settings, deleteGuard }) => {
        await pinTempChatSettings(settings, { tempChat: true });
        const { tab, id } = await openTrackedTemporaryTab(context, deleteGuard);
        expect(await hasOpenUuidKey(context, id), 'the conversation is in the local open set before the close (precondition)').toBe(true);

        const closedAt = await closeTabLikeUser(tab);
        await expect.poll(() => deleteGuard.ownedDeleteIds(), { message: 'one delete request for the closed conversation follows the close', timeout: 20_000 }).toEqual([id]);
        const waitedMs = deleteGuard.ownedDeletes()[0].at - closedAt;
        expect(waitedMs, 'the delete waits for the grace period after the close instead of firing at once').toBeGreaterThanOrEqual(8_000);
        expect(waitedMs, 'the delete follows within about 10 seconds of the close').toBeLessThanOrEqual(15_000);
        await expectNoFurtherDeletes(page, deleteGuard, 'no second delete request follows');

        await expect.poll(() => queueEntry(context, id), { message: 'the deleted conversation is removed from dss-pending-deletes-sync' }).toBe(null);
        await expect.poll(() => hasOpenUuidKey(context, id), { message: 'the deleted conversation is removed from the local open set' }).toBe(false);
        expect(deleteGuard.refused(), 'no delete request for any conversation the test did not create').toEqual([]);
    });

    test('closing one tab of a temporary conversation that another tab still shows deletes nothing and keeps it queued', async ({ page, context, settings, deleteGuard, deepseekReplay }) => {
        await pinTempChatSettings(settings, { tempChat: true });
        const { tab, id } = await openTrackedTemporaryTab(context, deleteGuard);
        const second = await context.newPage();
        try {
            // docs/FEATURES.md 的 Cross-Device Protection（Tab guard）：還有分頁顯示這個對話時保留它。
            await serveHistoryWithMessages(second, deepseekReplay, id);
            await openConversation(second, id);
            await closeTabLikeUser(tab);
            await expectNoFurtherDeletes(page, deleteGuard, 'no delete request while another tab still shows the conversation', 12_000);
            expect(await queueEntry(context, id).then((entry) => entry?.chatUuid ?? null), 'the conversation stays queued while another tab shows it').toBe(id);
        } finally {
            await second.close();
        }
    });

    test('closing the tab of a history conversation deletes nothing', async ({ page, context, settings, deleteGuard, deepseekReplay }) => {
        const kept = deepseekReplay.requireConversation('withSearch').id;
        await pinTempChatSettings(settings, { tempChat: true });
        const tab = await context.newPage();
        await openConversation(tab, kept);

        // docs/FEATURES.md：進入或離開非臨時的歷史對話不觸發刪除。
        await closeTabLikeUser(tab);
        await expectNoFurtherDeletes(page, deleteGuard, 'closing the history conversation tab sends no delete request', 12_000);
        expect(deleteGuard.refused(), 'no delete request for the history conversation').toEqual([]);
        expect(await queueEntry(context, kept), 'the history conversation is never queued for deletion').toBe(null);
    });
});
