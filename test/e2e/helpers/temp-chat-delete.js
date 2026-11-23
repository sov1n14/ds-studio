// 臨時對話刪除的 E2E 共用工具：攔截每一次 `chat_session/delete` 的 fixture、刪除佇列與開啟中集合的讀取、首次送出，以及「沒有再刪除」的觀察窗。
// 安全規則：每一次 `chat_session/delete` 請求（頁面、content script、DeepSeek 自身的刪除，以及擴充功能 service worker 發出的）都在瀏覽器內攔截；只有本次測試擁有的對話（`chat_session/create` 回應的 id，或測試以 `own(id)` 登記的 id）回覆替身 200，其餘一律中止並讓測試失敗。

import { expect } from '@playwright/test';
import { DEEPSEEK_ORIGIN } from './conversations.js';
import { evaluateInWorker } from './extension.js';
import { armReplyStub, openHome, sendStubbedPrompt } from './reply-stub.js';
import { readBothAreas } from './settings.js';

export const ENABLED_KEY = 'dss-temporary-chat-enabled';
export const QUEUE_KEY = 'dss-pending-deletes-sync';
export const DEVICE_ID_KEY = 'dss-device-id';
export const OPEN_UUID_PREFIX = 'dss-open-temp-uuid:';
export const LAST_SEEN_PREFIX = 'dss-last-seen-change:';
export const AUTH_TOKEN_KEY = 'dss-last-auth-token';

const DELETE_PATH = '/api/v0/chat_session/delete';
const CREATE_PATH = '/api/v0/chat_session/create';
const COMPLETION_PATH = '/api/v0/chat/completion';
// 只用來證明 context.route 也攔得到擴充功能 service worker 發出的請求；這個路徑由測試自行回覆，從不離開瀏覽器。
const GUARD_PROBE_PATH = '/api/v0/dss-e2e-delete-guard-probe';
// 刪除成功的替身回應：沿用 DeepSeek API 的回應外殼（code 與 data.biz_code 為 0）。
const DELETE_OK_BODY = JSON.stringify({ code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data: null } });

export const PROBE_PROMPT = 'e2e temporary chat probe (answered by the in-browser stub, never sent)';
// 證明「沒有發生」的預設觀察窗長度；觀察窗本身就是斷言。
const NEVER_WINDOW_MS = 3_000;

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
 * 攔截整個 context 的 `chat_session/delete`（含擴充功能 service worker）：本次測試擁有的 id 回覆 200 並記錄時間，其餘中止並記錄。
 * 頁面上另裝了攔截全部 API 的替身時，須對該頁呼叫 `attach(page)`，讓刪除請求先經過這裡（後註冊的 page.route 優先）。
 */
async function armDeleteGuard(context, keptIds) {
    const owned = new Set();
    const parsing = new Set();
    const ownedDeletes = [];
    const refused = [];

    function onResponse(response) {
        if (new URL(response.url()).pathname !== CREATE_PATH) return;
        const job = response.json()
            .then((body) => {
                const id = body?.data?.biz_data?.chat_session?.id;
                if (typeof id === 'string' && !keptIds.has(id)) owned.add(id);
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
            const at = Date.now();
            ids.forEach((id) => ownedDeletes.push({ id, source, at }));
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
    // 探測失敗（狀態不符，或 evaluateInWorker 拋出例如 fetch 被拒）時，finally 拆除探測路由、刪除攔截與回應監聽，不殘留在共用的 context 上；錯誤照樣拋出，測試失敗。
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
        /** 登記測試自行放進佇列的 uuid（不在錄製中、也不是真實對話），讓它的刪除請求得到替身 200。 */
        own(id) {
            if (keptIds.has(id)) throw new Error(`Refusing to own recorded conversation ${id}: recorded conversations are never deleted`);
            owned.add(id);
        },
        ownedDeleteIds: () => ownedDeletes.map((entry) => entry.id),
        /** 每一次放行的刪除：`{ id, source, at }`，`at` 為攔截當下的 epoch 毫秒。 */
        ownedDeletes: () => ownedDeletes.map((entry) => ({ ...entry })),
        refused: () => [...refused],
        async dispose() {
            await context.unroute(isDelete, handleDelete);
            context.off('response', onResponse);
            if (refused.length > 0) throw new Error(`Delete requests for uuids this test did not create were aborted: ${JSON.stringify(refused)}`);
        },
    };
}

/** 在 `base` 上加入 `deleteGuard` fixture，並讓 `settings` 依賴它。 */
export function withDeleteGuard(base) {
    return base.extend({
        deleteGuard: async ({ context, deepseekReplay }, use) => {
            const guard = await armDeleteGuard(context, new Set(deepseekReplay.conversations.map(({ id }) => id)));
            await use(guard);
            await guard.dispose();
        },
        // `settings` 依賴 deleteGuard：攔截在儲存還原（會改寫 sync 佇列並觸發補救掃描）之後才拆除；`page` 依賴 `settings`，因此頁面也先於攔截關閉。
        settings: async ({ deleteGuard, settings }, use) => {
            await use(settings);
        },
    });
}

/** 一次寫一個鍵：先寫臨時對話開關，總開關最後寫；並記錄擴充功能在測試中會寫入的鍵，供測試後還原。 */
export async function pinTempChatSettings(settings, { tempChat }) {
    await settings.track([QUEUE_KEY, DEVICE_ID_KEY, AUTH_TOKEN_KEY]);
    await settings.trackNewKeys(OPEN_UUID_PREFIX);
    await settings.trackNewKeys(LAST_SEEN_PREFIX);
    await settings.set({ [ENABLED_KEY]: tempChat });
    await settings.set({ isEnabled: true });
}

/** 刪除佇列中 `id` 的項目（只取非敏感欄位）；不存在時為 null。 */
export async function queueEntry(context, id) {
    const { sync } = await readBothAreas(context, [QUEUE_KEY]);
    const queue = Array.isArray(sync[QUEUE_KEY]) ? sync[QUEUE_KEY] : [];
    const entry = queue.find((item) => item?.chatUuid === id);
    return entry ? { chatUuid: entry.chatUuid, lastActiveAt: entry.lastActiveAt, ownerDeviceId: entry.ownerDeviceId } : null;
}

export async function hasOpenUuidKey(context, id) {
    const key = OPEN_UUID_PREFIX + id;
    const { local } = await readBothAreas(context, [key]);
    return key in local;
}

/** 觀察窗（預設 `NEVER_WINDOW_MS`）內不得再出現任何刪除請求；觀察窗本身就是斷言。`page` 須在整個觀察窗內保持開啟。 */
export async function expectNoFurtherDeletes(page, deleteGuard, message, windowMs = NEVER_WINDOW_MS) {
    const before = deleteGuard.ownedDeleteIds().length + deleteGuard.refused().length;
    await page.waitForTimeout(windowMs);
    const after = deleteGuard.ownedDeleteIds().length + deleteGuard.refused().length;
    expect(after - before, `${message} (owned: ${JSON.stringify(deleteGuard.ownedDeleteIds())}, refused: ${JSON.stringify(deleteGuard.refused())})`).toBe(0);
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

/** 裝好替身回覆與刪除攔截，載入首頁並送出第一則訊息；回傳這個新對話的 uuid（本次測試建立的對話）。 */
export async function sendFirstMessageFromHome(page, deleteGuard) {
    await armReplyStub(page);
    await deleteGuard.attach(page);
    const completionSessions = recordCompletionSessions(page);
    await openHome(page);
    await sendStubbedPrompt(page, PROBE_PROMPT);
    await expect.poll(() => completionSessions().length, { message: 'the send went out as a completion request (precondition)' }).toBeGreaterThan(0);
    const id = completionSessions()[0];
    expect(deleteGuard.isOwned(id), 'the first send went into a session created by a create response in this page load (precondition)').toBe(true);
    await expect(page, 'DeepSeek moves to the new conversation (precondition)').toHaveURL(`${DEEPSEEK_ORIGIN}/a/chat/s/${id}`);
    return id;
}
