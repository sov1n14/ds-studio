import { test as base, expect } from './fixtures.js';
import { blockSendRequests, composer } from './helpers/composer.js';
import { CONVERSATIONS, DEEPSEEK_ORIGIN, openConversation } from './helpers/conversations.js';
import { evaluateInWorker } from './helpers/extension.js';
import { TEMP_CHAT_ROW_SELECTOR } from './helpers/extension-ui.js';
import { armReplyStub, openHome, sendStubbedPrompt } from './helpers/reply-stub.js';
import { readBothAreas } from './helpers/settings.js';

// 臨時對話的建立與刪除（docs/FEATURES.md 的 Temporary Conversation；docs/spec/04-features.md 第 21 節）。
// 首頁開關的列是否出現已由 temp-chat-toggle.e2e.js 涵蓋；這裡驗證開關本身的開／關狀態、首次送出時的標記、離開時的刪除，以及歷史對話與重新整理不會刪除。
// 安全規則：
// - 每一次 `chat_session/delete` 請求（頁面、content script、DeepSeek 自身的刪除，以及擴充功能 service worker 發出的）都在瀏覽器內攔截：只有本次測試自己建立的對話（本次測試中 `chat_session/create` 回應的 id）回覆替身 200，其餘一律中止並讓測試失敗；沒有任何真實的刪除抵達 DeepSeek。
// - 新對話中的送出由瀏覽器內替身回覆（helpers/reply-stub.js），歷史對話中的送出在瀏覽器內中止；沒有任何訊息抵達 DeepSeek。
// - 保留的對話（helpers/conversations.js）只開啟、從不刪除。
// - 測試中觸及的儲存鍵（開關、刪除佇列、權杖快取、裝置 id、開啟中對話與租約觀察鍵）在測試後還原；權杖值從不讀出或印出。

const ROW_LABEL = '臨時對話';
const ENABLED_KEY = 'dss-temporary-chat-enabled';
const TRACKED_UUID_SESSION_KEY = 'dss-temporary-chat-uuid';
const QUEUE_KEY = 'dss-pending-deletes-sync';
const DEVICE_ID_KEY = 'dss-device-id';
const OPEN_UUID_PREFIX = 'dss-open-temp-uuid:';
const LAST_SEEN_PREFIX = 'dss-last-seen-change:';
const AUTH_TOKEN_KEY = 'dss-last-auth-token';

const DELETE_PATH = '/api/v0/chat_session/delete';
const CREATE_PATH = '/api/v0/chat_session/create';
const COMPLETION_PATH = '/api/v0/chat/completion';
const HISTORY_PATH = '/api/v0/chat/history_messages';
// 重新整理測試借用其真實歷史回應的保留對話（只讀取，從不寫入）。
const HISTORY_SOURCE_UUID = CONVERSATIONS.thinkingWithSearch;
// 只用來證明 context.route 也攔得到擴充功能 service worker 發出的請求；這個路徑由測試自行回覆，從不離開瀏覽器。
const GUARD_PROBE_PATH = '/api/v0/dss-e2e-delete-guard-probe';
// 刪除成功的替身回應：沿用 DeepSeek API 的回應外殼（code 與 data.biz_code 為 0）。
const DELETE_OK_BODY = JSON.stringify({ code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data: null } });
const KEPT_UUIDS = new Set(Object.values(CONVERSATIONS));

const PROMPT = 'e2e temporary chat probe (answered by the in-browser stub, never sent)';
// 證明「沒有發生」的觀察窗長度；觀察窗本身就是斷言。
const NEVER_WINDOW_MS = 3_000;
// docs/spec/04-features.md:125 的開關顏色：文字關閉 #f9fafb、開啟 #679efe；開啟時軌道 #4d6bfe。
const LABEL_OFF_COLOR = 'rgb(249, 250, 251)';
const LABEL_ON_COLOR = 'rgb(103, 158, 254)';
const TRACK_ON_COLOR = 'rgb(77, 107, 254)';

/**
 * 刪除請求本文中的對話 id。擴充功能自己的 API 刪除帶 `{ chat_session_id }`（docs/spec/04-features.md:99）；經由 DeepSeek 自身刪除函式（Fiber 刪除）發出的請求帶 `{ chat_session_ids: [...] }`（2026-11-12 實測）。
 * 無法解析時回傳空陣列，視同不屬於本次測試。
 */
function deleteRequestIds(request) {
    let body = null;
    try {
        body = request.postDataJSON();
    } catch {
        return [];
    }
    if (typeof body?.chat_session_id === 'string') return [body.chat_session_id];
    if (Array.isArray(body?.chat_session_ids) && body.chat_session_ids.every((id) => typeof id === 'string')) return [...body.chat_session_ids];
    return [];
}

/**
 * 攔截整個 context 的 `chat_session/delete`（含擴充功能 service worker）：本次測試建立的 id 回覆 200，其餘中止並記錄。
 * 頁面上另裝了攔截全部 API 的替身時，須對該頁呼叫 `attach(page)`，讓刪除請求先經過這裡（後註冊的 page.route 優先）。
 */
async function armDeleteGuard(context) {
    const owned = new Set();
    const parsing = new Set();
    const ownedDeletes = [];
    const refused = [];

    function onResponse(response) {
        if (new URL(response.url()).pathname !== CREATE_PATH) return;
        const job = response.json()
            .then((body) => {
                const id = body?.data?.biz_data?.chat_session?.id;
                if (typeof id === 'string' && !KEPT_UUIDS.has(id)) owned.add(id);
            })
            .catch(() => {})
            .finally(() => parsing.delete(job));
        parsing.add(job);
    }

    async function handleDelete(route) {
        const request = route.request();
        const ids = deleteRequestIds(request);
        await Promise.allSettled([...parsing]);
        const source = request.serviceWorker() ? 'service worker' : 'page';
        if (ids.length > 0 && ids.every((id) => owned.has(id))) {
            ids.forEach((id) => ownedDeletes.push({ id, source }));
            return route.fulfill({ status: 200, contentType: 'application/json', body: DELETE_OK_BODY });
        }
        refused.push({ ids, source });
        return route.abort();
    }

    const isDelete = (url) => url.pathname === DELETE_PATH;
    const isProbe = (url) => url.pathname === GUARD_PROBE_PATH;
    context.on('response', onResponse);
    await context.route(isDelete, handleDelete);

    // 安全前提：service worker 的請求也必須經過 context.route，否則補救刪除可能繞過攔截。
    // 探測失敗（狀態不符，或 evaluateInWorker 拋出例如 fetch 被拒）時，finally 拆除探測路由、刪除攔截與回應監聽，不殘留在共用的持久 context 上；錯誤照樣拋出，測試失敗。
    let armed = false;
    try {
        await context.route(isProbe, (route) => route.fulfill({ status: 204 }));
        const probeStatus = await evaluateInWorker(context, (url) => fetch(url, { method: 'POST' }).then((response) => response.status), DEEPSEEK_ORIGIN + GUARD_PROBE_PATH);
        if (probeStatus !== 204) throw new Error(`Delete guard precondition failed: a service-worker request was not intercepted by context.route (status ${probeStatus})`);
        armed = true;
    } finally {
        await context.unroute(isProbe);
        if (!armed) {
            await context.unroute(isDelete, handleDelete);
            context.off('response', onResponse);
        }
    }

    return {
        attach: (page) => page.route(isDelete, handleDelete),
        isOwned: (id) => owned.has(id),
        ownedDeleteIds: () => ownedDeletes.map((entry) => entry.id),
        refused: () => [...refused],
        async dispose() {
            await context.unroute(isDelete, handleDelete);
            context.off('response', onResponse);
            if (refused.length > 0) throw new Error(`Delete requests for uuids this test did not create were aborted: ${JSON.stringify(refused)}`);
        },
    };
}

const test = base.extend({
    deleteGuard: async ({ context }, use) => {
        const guard = await armDeleteGuard(context);
        await use(guard);
        await guard.dispose();
    },
    // `settings` 依賴 deleteGuard：攔截在儲存還原（會改寫 sync 佇列並觸發補救掃描）之後才拆除；`page` 依賴 `settings`，因此頁面也先於攔截關閉。
    settings: async ({ deleteGuard, settings }, use) => {
        await use(settings);
    },
});

/** 一次寫一個鍵：先寫臨時對話開關，總開關最後寫；並記錄擴充功能在測試中會寫入的鍵，供測試後還原。 */
async function pinSettings(settings, { tempChat }) {
    await settings.track([QUEUE_KEY, DEVICE_ID_KEY, AUTH_TOKEN_KEY]);
    await settings.trackNewKeys(OPEN_UUID_PREFIX);
    await settings.trackNewKeys(LAST_SEEN_PREFIX);
    await settings.set({ [ENABLED_KEY]: tempChat });
    await settings.set({ isEnabled: true });
}

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

/** 刪除佇列中 `id` 的項目（只取非敏感欄位）；不存在時為 null。 */
async function queueEntry(context, id) {
    const { sync } = await readBothAreas(context, [QUEUE_KEY]);
    const queue = Array.isArray(sync[QUEUE_KEY]) ? sync[QUEUE_KEY] : [];
    const entry = queue.find((item) => item?.chatUuid === id);
    return entry ? { chatUuid: entry.chatUuid, lastActiveAt: entry.lastActiveAt, ownerDeviceId: entry.ownerDeviceId } : null;
}

async function hasOpenUuidKey(context, id) {
    const key = OPEN_UUID_PREFIX + id;
    const { local } = await readBothAreas(context, [key]);
    return key in local;
}

/** 記錄 `page` 每一次 completion 請求本文中的 `chat_session_id`（請求由替身回覆，從不離開瀏覽器）。 */
function recordCompletionSessions(page) {
    const ids = [];
    page.on('request', (request) => {
        if (new URL(request.url()).pathname !== COMPLETION_PATH) return;
        try {
            ids.push(request.postDataJSON()?.chat_session_id ?? null);
        } catch {
            ids.push(null);
        }
    });
    return () => [...ids];
}

/** 等待第一次送出的 completion 請求，回傳其 `chat_session_id`。 */
async function firstSentSession(completionSessions) {
    await expect.poll(() => completionSessions().length, { message: 'the send went out as a completion request (precondition)' }).toBeGreaterThan(0);
    return completionSessions()[0];
}

/** 裝好替身回覆與刪除攔截，載入首頁並送出第一則訊息；回傳這個新對話的 uuid（本次測試建立的對話）。 */
async function sendFirstMessageFromHome(page, deleteGuard) {
    await armReplyStub(page);
    await deleteGuard.attach(page);
    const completionSessions = recordCompletionSessions(page);
    await openHome(page);
    await sendStubbedPrompt(page, PROMPT);
    const id = await firstSentSession(completionSessions);
    expect(deleteGuard.isOwned(id), 'the first send went into a session created by a create response in this page load (precondition)').toBe(true);
    await expect(page, 'DeepSeek moves to the new conversation (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/a/chat/s/${id}`);
    return id;
}

/**
 * 重新整理後讓對話 `id` 以「已有訊息」的狀態載入。
 * 替身回覆沒有寫入伺服器，DeepSeek 重新載入沒有訊息的對話時會導回首頁（2026-11-12 實測：history_messages 回傳 `is_empty: true` 後頁面轉到 `/`），那是一次離開；真實送出後的對話不會如此。
 * 因此 `id` 的 history_messages 改以一個保留對話的真實回應（只讀 GET）回覆，並把其中的對話 id 換成 `id`。
 */
async function serveHistoryWithMessages(page, id) {
    await page.route((url) => url.pathname === HISTORY_PATH && url.searchParams.get('chat_session_id') === id, async (route) => {
        const source = new URL(route.request().url());
        source.searchParams.set('chat_session_id', HISTORY_SOURCE_UUID);
        const response = await route.fetch({ url: source.toString() });
        const body = await response.json();
        body.data.biz_data.chat_session.id = id;
        await route.fulfill({ response, json: body });
    });
}

/** 以 `reload()` 重新整理已標記的對話 `id`，斷言重新整理不送出刪除請求，對話仍被追蹤且仍在待刪佇列中。 */
async function expectRefreshKeepsConversation(page, context, deleteGuard, id, reload) {
    await expect.poll(() => trackedUuid(page), { message: 'the new conversation is tracked before the refresh (precondition)' }).toBe(id);
    await serveHistoryWithMessages(page, id);

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
    await page.locator(`a[href="/a/chat/s/${uuid}"]`).first().click();
    await expect(page, 'the sidebar link opens the kept conversation (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/a/chat/s/${uuid}`);
}

/** 觀察窗內不得再出現任何刪除請求；觀察窗本身就是斷言。 */
async function expectNoFurtherDeletes(page, deleteGuard, message) {
    const before = deleteGuard.ownedDeleteIds().length + deleteGuard.refused().length;
    await page.waitForTimeout(NEVER_WINDOW_MS);
    const after = deleteGuard.ownedDeleteIds().length + deleteGuard.refused().length;
    expect(after - before, `${message} (owned: ${JSON.stringify(deleteGuard.ownedDeleteIds())}, refused: ${JSON.stringify(deleteGuard.refused())})`).toBe(0);
}

test.describe('temporary conversation', () => {
    test('the switch shows its off and on state, follows a change made in another tab, and keeps its state while leaving and returning to the home page', async ({ page, context, settings, deleteGuard }) => {
        await pinSettings(settings, { tempChat: false });
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
        await openKeptFromSidebar(page, CONVERSATIONS.thinkingWithSearch);
        await expect(row(page), 'leaving the home page removes the switch row').toHaveCount(0);
        await page.goBack();
        await expect(page, 'back on the home page (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/`);
        await expect(rowSwitch(page), 'returning to the home page shows the switch still on').toBeChecked();
        expect(deleteGuard.ownedDeleteIds(), 'no conversation was sent and nothing is deleted').toEqual([]);
        expect(deleteGuard.refused(), 'no delete request for any conversation the test did not create').toEqual([]);
    });

    test('with the switch on, the first send in a new conversation marks it as temporary', async ({ page, context, settings, deleteGuard }) => {
        await pinSettings(settings, { tempChat: true });
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
        await pinSettings(settings, { tempChat: true });
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

    test('leaving a temporary conversation for another conversation deletes exactly that conversation and never the one opened', async ({ page, settings, deleteGuard }) => {
        await pinSettings(settings, { tempChat: true });
        const id = await sendFirstMessageFromHome(page, deleteGuard);
        await expect.poll(() => trackedUuid(page), { message: 'the new conversation is tracked before leaving (precondition)' }).toBe(id);

        // docs/FEATURES.md:110：切換到另一個對話會觸發刪除；docs/FEATURES.md:117：進入非臨時的歷史對話不會刪除它。
        await openKeptFromSidebar(page, CONVERSATIONS.fiveThinkingReplies);
        await expect.poll(() => deleteGuard.ownedDeleteIds(), { message: 'switching conversations sends one delete request for the temporary conversation' }).toEqual([id]);
        await expectNoFurtherDeletes(page, deleteGuard, 'no further delete request follows');
        expect(deleteGuard.refused(), 'the conversation switched to is never sent for deletion').toEqual([]);
    });

    test('with the switch on, a history conversation opened and sent to right after loading is never marked and leaving it deletes nothing', async ({ page, context, settings, deleteGuard }) => {
        const kept = CONVERSATIONS.thinkingWithSearch;
        await pinSettings(settings, { tempChat: true });
        // 替身回覆的訊息 id 會與既有對話的訊息樹衝突，使頁面停止回應（2026-11-12 實測）；歷史對話中的送出改為在瀏覽器內中止，請求本文照樣可讀。
        const blocked = await blockSendRequests(page);

        // docs/FEATURES.md:100：歷史對話即使開關開啟、開啟後立刻送出訊息，也不會被標記或刪除。
        await openConversation(page, kept);
        await composer(page).fill(PROMPT);
        await composer(page).press('Enter');
        await expect.poll(() => blocked.requests().length, { message: 'the send went out as a completion request and was aborted (precondition)' }).toBeGreaterThan(0);
        expect(blocked.requests()[0].body?.chat_session_id, 'the send went into the history conversation (precondition)').toBe(kept);
        await openKeptFromSidebar(page, CONVERSATIONS.fiveThinkingReplies);
        await expectNoFurtherDeletes(page, deleteGuard, 'leaving the history conversation sends no delete request');

        expect(deleteGuard.refused(), 'no delete request for the history conversation or any other kept conversation').toEqual([]);
        expect(deleteGuard.ownedDeleteIds(), 'no delete request at all').toEqual([]);
        expect(await queueEntry(context, kept), 'the history conversation is never queued for deletion').toBe(null);
        expect(await hasOpenUuidKey(context, kept), 'the history conversation is never added to the open set').toBe(false);
        expect(await trackedUuid(page), 'no conversation is tracked as temporary in this tab').toBe(null);
    });

    test('refreshing a temporary conversation with F5 deletes nothing and keeps it tracked', async ({ page, context, settings, deleteGuard }) => {
        await pinSettings(settings, { tempChat: true });
        const id = await sendFirstMessageFromHome(page, deleteGuard);

        // docs/FEATURES.md:113：按 F5 重新整理不觸發刪除；docs/FEATURES.md:108：追蹤在重新整理後仍有效。
        // 頁面先收到 F5 按鍵，再由瀏覽器重新載入（以 CDP 合成的按鍵不會觸發瀏覽器的重新整理快捷鍵，因此重新載入由 page.reload() 代為執行）。
        await expectRefreshKeepsConversation(page, context, deleteGuard, id, async () => {
            await page.keyboard.press('F5');
            await page.reload();
        });
    });

    test('refreshing a temporary conversation with the browser refresh button deletes nothing and keeps it tracked', async ({ page, context, settings, deleteGuard }) => {
        await pinSettings(settings, { tempChat: true });
        const id = await sendFirstMessageFromHome(page, deleteGuard);

        // docs/FEATURES.md:113：按瀏覽器的重新整理按鈕不觸發刪除；docs/FEATURES.md:108：追蹤在重新整理後仍有效。
        // page.reload() 與重新整理按鈕同為瀏覽器發起的重新載入：頁面收不到按鍵，也不觸發 Navigation API 的 navigate 事件（2026-11-12 實測）。
        await expectRefreshKeepsConversation(page, context, deleteGuard, id, () => page.reload());
    });
});
