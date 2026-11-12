/**
 * 情境：分頁卸載（beforeunload）後由 service worker 等待寬限期，再決定是否刪除臨時對話。
 *
 * 使用者裁示（原文）："The browser's refresh button deletes temporary conversations." This is inherently unexpected behavior; refreshing should not clear temporary conversations. 寬限期：10 秒。直接關掉整個瀏覽器時，背景服務可能還沒等完就被結束，臨時對話會留到下次開瀏覽器才刪掉 —— 使用者接受。
 *
 * 需求：content script 在 beforeunload 不再自行刪除，只送 { type: DSS_TEMP_CHAT.DSS_MSG_TAB_UNLOADING, uuid: S }。service worker 收到後等 10 000 ms：
 *   - S 不在待刪佇列 → 什麼都不做；
 *   - 寬限期內收到 S 的 DSS_HEARTBEAT（重新整理後的新頁面認領了 S）→ 什麼都不做；
 *   - 仍有 *://chat.deepseek.com/* 分頁的網址停在 S → 保留並續約 lease；
 *   - 否則以 {"chat_session_id":"S"} 與本機 token 刪除 S，並把 S 移出佇列與本機開啟集合；
 *   - 刪除失敗（ok:false、reject、同步 throw）或沒有 token → S 留在佇列、lease 釋放（lastActiveAt 0）、排定重試 alarm；
 *   - 同一 S 的重複卸載訊息只刪一次；worker 在寬限期內被終止（計時器遺失）→ S 留在佇列，下次瀏覽器啟動的 onStartup 補刪。
 *
 * 執行方式：test/helpers/unload-grace-harness.js 以 vm context 載入真的 background/service-worker.js 與它 importScripts 的每個模組（真的 pending-store、真的 routes、新增的 background/unload-grace.js）。只替換信任邊界：chrome.storage（記憶體實作）、chrome.tabs.query（依 url 條件過濾的分頁表）、chrome.alarms（Map）、fetch、runtime 訊息派送、worker 計時器與 Date.now。測試只經由 runtime 訊息驅動 worker，不直接呼叫新模組。
 *
 * 否定情境（不刪除）都附帶一個同時卸載、應被刪除的對照 uuid C，證明寬限機制在該測試中確實運作，避免「什麼都沒發生」也能通過。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    createWorld, bootWorker, advanceTo, tabUnloading, trackForDeletion, heartbeat, relayToken, fireStartup,
    setTabs, tab, chatUrl, ORIGIN, readQueue, queueEntry, readOpenUuids, deleteRequestsFor, retryAlarm, readWorkerBinding, sendToWorker, unloadType,
} from '../helpers/unload-grace-harness.js';

const GRACE_MS = 10000; // 使用者裁示的寬限期
const TOKEN = 'Bearer unload-grace-token';
const DELETE_URL = ORIGIN + '/api/v0/chat_session/delete';
const S = '26c81320-1ce0-4172-bd5e-cb5b7a55f332'; // 卸載的臨時對話
const C = 'a596cafc-7297-48fb-bf19-f20747ce7d98'; // 對照：同時卸載、無人認領，應被刪除
const X = 'da794fe0-243a-4ba5-817a-b88ff327e634'; // 從未登記待刪的對話
const O = 'efe1f51f-b924-4170-bfdd-db050e0db38f'; // 另一個分頁上的其他對話

let world;
let unhandled;
const onUnhandled = (reason) => { unhandled.push(reason); };

const now = () => world.clock.now();
const expectedDelete = (uuid) => ({ url: DELETE_URL, rawBody: JSON.stringify({ chat_session_id: uuid }), body: { chat_session_id: uuid }, authorization: TOKEN });

/** 一個瀏覽器設定檔：可選擇是否已有本機 token；S 與 C 皆已登記待刪（lease 由本機持有）。 */
async function setup({ hasToken = true } = {}) {
    world = createWorld();
    if (hasToken) await relayToken(world, TOKEN);
    await trackForDeletion(world, S);
    await trackForDeletion(world, C);
    expect((await readQueue(world)).map((e) => e.chatUuid).sort(), 'precondition: S and C are in the pending-delete queue').toEqual([S, C].sort());
}

/** 對照 C 必須在寬限期後被刪除：證明這個 worker 確實執行卸載寬限機制。 */
async function expectControlDeleted() {
    expect(deleteRequestsFor(world, C), 'control C (unloaded, unclaimed, no tab) must be deleted once after the grace period, proving the unload grace mechanism ran in this test').toEqual([expectedDelete(C)]);
    expect(await queueEntry(world, C), 'control C must leave the pending-delete queue after its delete succeeded').toBeUndefined();
}

/** 卸載處理不得留下未處理的 rejection 或監聽器例外。 */
function expectNoEscapedErrors() {
    expect(unhandled, 'no unhandled promise rejection may escape the unload grace handling').toEqual([]);
    expect(world.listenerErrors, 'no runtime message listener may throw').toEqual([]);
}

beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
});

describe('unloaded, unclaimed temporary conversation: deleted after the 10 s grace period', () => {
    it('sends no delete before 10 000 ms, then exactly one delete with {"chat_session_id":"S"} and removes S from the queue and the open set', async () => {
        await setup();
        const unloadAt = now();

        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS - 1);

        expect(deleteRequestsFor(world, S), 'no delete may be sent for S before the 10 000 ms grace period ends').toEqual([]);
        expect((await queueEntry(world, S))?.chatUuid, 'S must still be queued during the grace period').toBe(S);

        await advanceTo(world, unloadAt + GRACE_MS);

        expect(deleteRequestsFor(world, S), 'exactly one delete for S, with the extension delete body and the stored token, once the grace period ends').toEqual([expectedDelete(S)]);
        expect(await queueEntry(world, S), 'a deleted S must leave the pending-delete queue').toBeUndefined();
        expect(await readOpenUuids(world), 'a deleted S must leave the local open set').not.toContain(S);
        expectNoEscapedErrors();
    });

    it('deletes S when the only DeepSeek tabs show the homepage or another conversation, and a non-DeepSeek tab URL containing S does not keep it', async () => {
        await setup();
        setTabs(world, [tab(1, ORIGIN + '/'), tab(2, chatUrl(O)), tab(3, 'https://example.com/a/chat/s/' + S)]);
        const unloadAt = now();

        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, S), 'no tab of chat.deepseek.com shows S, so S must be deleted exactly once').toEqual([expectedDelete(S)]);
        expect(await queueEntry(world, S), 'a deleted S must leave the pending-delete queue').toBeUndefined();
        expectNoEscapedErrors();
    });

    it('sends one delete for S when the unload message for S arrives twice', async () => {
        await setup();
        const unloadAt = now();

        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + 4000);
        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + 4000 + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, S), 'duplicate unload messages for S must lead to exactly one delete').toEqual([expectedDelete(S)]);
        expect(await queueEntry(world, S), 'a deleted S must leave the pending-delete queue').toBeUndefined();
        expectNoEscapedErrors();
    });
});

describe('unloaded temporary conversation claimed by a reload or still open: kept', () => {
    it('keeps S when a DSS_HEARTBEAT for S arrives during the grace period (the reloaded page claimed it)', async () => {
        await setup();
        const unloadAt = now();

        await tabUnloading(world, S);
        await tabUnloading(world, C);
        await advanceTo(world, unloadAt + 3000);
        await heartbeat(world, S);
        await advanceTo(world, unloadAt + GRACE_MS + 5000);

        expect(deleteRequestsFor(world, S), 'a heartbeat for S during the grace period means a reloaded page holds S: no delete').toEqual([]);
        expect((await queueEntry(world, S))?.chatUuid, 'S must stay in the pending-delete queue').toBe(S);
        await expectControlDeleted();
        expectNoEscapedErrors();
    });

    it('keeps S and refreshes its lease when a chat.deepseek.com tab URL still shows S at the end of the grace period', async () => {
        await setup();
        await advanceTo(world, now() + 60000); // 讓 lease 時間戳落後，續約才可觀察
        setTabs(world, [tab(1, chatUrl(S)), tab(2, ORIGIN + '/')]);
        const unloadAt = now();
        expect((await queueEntry(world, S)).lastActiveAt, 'precondition: S lease timestamp predates the unload').toBeLessThan(unloadAt);

        await tabUnloading(world, S);
        await tabUnloading(world, C);
        await advanceTo(world, unloadAt + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, S), 'a DeepSeek tab still shows S: no delete').toEqual([]);
        const entry = await queueEntry(world, S);
        expect(entry?.chatUuid, 'S must stay in the pending-delete queue').toBe(S);
        expect(entry.lastActiveAt, 'the lease of a kept S must be refreshed at the end of the grace period').toBeGreaterThanOrEqual(unloadAt + GRACE_MS);
        await expectControlDeleted();
        expectNoEscapedErrors();
    });

    it('sends no delete for X, which was never queued for deletion', async () => {
        await setup();
        const unloadAt = now();

        await tabUnloading(world, X);
        await tabUnloading(world, C);
        await advanceTo(world, unloadAt + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, X), 'an uuid absent from the pending-delete queue must never be deleted').toEqual([]);
        await expectControlDeleted();
        expectNoEscapedErrors();
    });
});

describe('delete failure after the grace period: S never dropped, lease released, retry scheduled', () => {
    const FAILURES = [
        ['the delete response is ok:false', true, () => async () => ({ ok: false, status: 500 })],
        ['the delete fetch rejects', true, () => async () => { throw new TypeError('Failed to fetch'); }],
        ['the delete fetch throws synchronously', true, () => () => { throw new TypeError('fetch threw synchronously'); }],
        ['no auth token is stored', false, null],
    ];

    it.each(FAILURES)('when %s, S stays queued with its lease released and a retry alarm is scheduled', async (_label, hasToken, makeFetch) => {
        await setup({ hasToken });
        if (makeFetch) world.fetch.mockImplementation(makeFetch());
        // 前置：登記待刪時排定的重試 alarm 先清掉，讓「失敗後排定重試」可觀察
        await world.chrome.alarms.clear(readWorkerBinding(world, 'RETRY_ALARM_NAME'));
        expect(retryAlarm(world), 'precondition: no retry alarm is pending before the unload').toBeUndefined();
        const unloadAt = now();

        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS + 1000);

        if (hasToken) expect(deleteRequestsFor(world, S), 'with a stored token the worker must attempt exactly one delete for S after the grace period').toEqual([expectedDelete(S)]);
        else expect(deleteRequestsFor(world, S), 'without a token no delete request can be sent').toEqual([]);
        const entry = await queueEntry(world, S);
        expect(entry?.chatUuid, 'a failed delete must never drop S from the pending-delete queue').toBe(S);
        expect(entry.lastActiveAt, 'a failed delete must release the lease of S (lastActiveAt 0) so any device can retry at once').toBe(0);
        expect(retryAlarm(world), 'a failed delete must schedule the delete retry alarm').toBeDefined();
        expectNoEscapedErrors();
    });
});

describe('service worker terminated during the grace period', () => {
    it('keeps S queued when the restart loses the grace timer, and the next browser startup deletes it', async () => {
        await setup();
        const unloadAt = now();

        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + 4000);
        bootWorker(world); // worker 終止後重新載入：計時器全部遺失，storage 保留
        await advanceTo(world, unloadAt + GRACE_MS + 5000);

        expect(deleteRequestsFor(world, S), 'the grace timer died with the worker: nothing deletes S before the next startup').toEqual([]);
        expect((await queueEntry(world, S))?.chatUuid, 'S must stay in the pending-delete queue after the restart').toBe(S);

        // 對照：重新載入的 worker 仍會處理新的卸載訊息，S 保留只因它的計時器遺失
        const controlAt = now();
        await tabUnloading(world, C);
        await advanceTo(world, controlAt + GRACE_MS + 1000);
        await expectControlDeleted();
        expect(deleteRequestsFor(world, S), 'handling another unload must not delete S early').toEqual([]);

        await fireStartup(world);

        const deletesForS = deleteRequestsFor(world, S);
        expect(deletesForS.length, 'the browser startup remediation must delete the leftover S').toBeGreaterThan(0);
        deletesForS.forEach((request) => expect(request, 'every startup delete for S uses the extension delete body and the stored token').toEqual(expectedDelete(S)));
        expect(await queueEntry(world, S), 'S must leave the pending-delete queue after the startup delete').toBeUndefined();
        expectNoEscapedErrors();
    });
});

describe('grace expiry and the sync-change scan share one in-flight queue guard', () => {
    // 規則來源：docs/spec/04-features.md Unload Grace「At expiry: the job runs under the worker's in-flight queue guard (runGuardedQueueJob, the guard the sync-change scan uses, so the two never delete the same item at once)」，以及同步變更安全網：其他裝置寫入待刪佇列時本機補救過期項目。
    const A = '0b1f6d0e-55aa-4c1e-9d3f-7a2b3c4d5e6f'; // 其他裝置寫入、lease 已釋放的對話
    const N = '9c8b7a65-4321-4fed-8cba-0123456789ab'; // 另一個分頁新登記的臨時對話

    /** 其他裝置經 chrome.storage.sync 把 lease 已釋放（lastActiveAt 0）的 uuid 加進待刪佇列。 */
    async function anotherDeviceQueues(uuid) {
        const key = readWorkerBinding(world, 'DSS_TEMP_CHAT').DSS_PENDING_DELETES_SYNC_KEY;
        const queue = await readQueue(world);
        await world.chrome.storage.sync.set({ [key]: [...queue, { chatUuid: uuid, attemptCount: 0, lastActiveAt: 0 }] });
    }

    it('after an unload grace delete has finished, a later queue change from another device is still swept and its released entry deleted once', async () => {
        await setup();
        const unloadAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS + 1000);
        expect(deleteRequestsFor(world, S), 'precondition: the unload grace deleted S').toEqual([expectedDelete(S)]);

        await anotherDeviceQueues(A);
        await advanceTo(world, now() + 1000);

        expect(deleteRequestsFor(world, A), 'the sync-change scan must still run after a grace job and delete the released entry A exactly once').toEqual([expectedDelete(A)]);
        expect(await queueEntry(world, A), 'A must leave the pending-delete queue after its delete succeeded').toBeUndefined();
        expectNoEscapedErrors();
    });

    it('a grace delete that finishes while a sync-change scan is still deleting A does not let a second scan delete A again', async () => {
        await setup();
        let releaseA;
        const fetchA = new Promise((resolve) => { releaseA = resolve; });
        world.fetch.mockImplementation(async (_url, init) => (JSON.parse(init.body).chat_session_id === A ? fetchA : { ok: true }));

        await anotherDeviceQueues(A); // 掃描開始，A 的刪除請求尚未回應
        await advanceTo(world, now() + 1000);
        expect(deleteRequestsFor(world, A), 'precondition: the sync-change scan is deleting A').toEqual([expectedDelete(A)]);

        const unloadAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS + 1000);
        expect(deleteRequestsFor(world, S), 'precondition: the unload grace deleted S while the scan was still running').toEqual([expectedDelete(S)]);

        await trackForDeletion(world, N); // 另一個分頁登記新的臨時對話：佇列再次變更
        await advanceTo(world, now() + 1000);
        releaseA({ ok: true });
        await advanceTo(world, now() + 1000);

        expect(deleteRequestsFor(world, A), 'A was already being deleted by the running scan: no second scan may delete it again').toEqual([expectedDelete(A)]);
        expect(await queueEntry(world, A), 'A must leave the pending-delete queue once its delete succeeded').toBeUndefined();
        expect((await queueEntry(world, N))?.chatUuid, 'the newly tracked N must stay queued').toBe(N);
        expectNoEscapedErrors();
    });
});

describe('unload message reply and failures at the trust boundaries', () => {
    // 規則來源：docs/spec/04-features.md Unload Grace（Timer：replies { ok: true }；At expiry：a chrome.tabs.query failure counts as no tab）；chrome-extension-coding-guidelines：timer callback 內的失敗以 console.error('[DSS] <context>:', err) 記錄。
    it('replies { ok: true } to the sender of the unload message', async () => {
        await setup();

        const responses = await tabUnloading(world, S);

        expect(responses, 'the unload message must be answered with exactly { ok: true }').toEqual([{ ok: true }]);
        expectNoEscapedErrors();
    });

    it('treats a chrome.tabs.query failure as no tab: S is deleted although a tab shows it', async () => {
        await setup();
        setTabs(world, [tab(1, chatUrl(S))]);
        const unloadAt = now();

        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS - 1);
        world.chrome.tabs.query.mockImplementation(async () => { throw new Error('tabs.query failed'); });
        await advanceTo(world, unloadAt + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, S), 'a failed tab query counts as no tab, so S must be deleted exactly once').toEqual([expectedDelete(S)]);
        expect(await queueEntry(world, S), 'a deleted S must leave the pending-delete queue').toBeUndefined();
        expectNoEscapedErrors();
    });

    it('logs a [DSS] console.error with the error when the retry alarm cannot be scheduled after a failed delete, keeps S queued, and lets no rejection escape', async () => {
        await setup();
        world.fetch.mockImplementation(async () => ({ ok: false, status: 500 }));
        const unloadAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS - 1);
        const alarmFailure = new Error('alarms.clear failed');
        world.chrome.alarms.clear.mockImplementation(async () => { throw alarmFailure; });

        await advanceTo(world, unloadAt + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, S), 'precondition: the worker attempted the delete of S once').toEqual([expectedDelete(S)]);
        expect(world.console.error, 'the failed expiry job must be reported as console.error("[DSS] <context>:", err)').toHaveBeenCalledWith(expect.stringMatching(/^\[DSS\] \S.*:$/), alarmFailure);
        expect((await queueEntry(world, S))?.chatUuid, 'a failed delete must never drop S from the queue').toBe(S);
        expectNoEscapedErrors();
    });
});

describe('one grace period per uuid at a time: claims, repeats and later unloads', () => {
    // 規則來源：docs/spec/04-features.md Unload Grace（Timer：每個 uuid 一個計時器、重複訊息不加計時器、DSS_HEARTBEAT 取消；At expiry：chat.deepseek.com 分頁停在該對話即保留）。
    it('keeps S when the unload message for S arrives twice and the reloaded page then claims S with one heartbeat', async () => {
        await setup();
        const unloadAt = now();

        await tabUnloading(world, S);
        await tabUnloading(world, C);
        await advanceTo(world, unloadAt + 1000);
        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + 3000);
        await heartbeat(world, S);
        await advanceTo(world, unloadAt + 1000 + GRACE_MS + 5000);

        expect(deleteRequestsFor(world, S), 'one heartbeat must cancel the single grace period of S, however many unload messages started it').toEqual([]);
        expect((await queueEntry(world, S))?.chatUuid, 'S must stay in the pending-delete queue').toBe(S);
        await expectControlDeleted();
        expectNoEscapedErrors();
    });

    it('deletes S when its tab is closed later, after an earlier unload had been claimed by a reload heartbeat', async () => {
        await setup();
        const reloadAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, reloadAt + 3000);
        await heartbeat(world, S);
        await advanceTo(world, reloadAt + GRACE_MS + 5000);
        expect(deleteRequestsFor(world, S), 'precondition: the reload kept S').toEqual([]);

        const closeAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, closeAt + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, S), 'the later tab close must start a new grace period and delete S once').toEqual([expectedDelete(S)]);
        expect(await queueEntry(world, S), 'a deleted S must leave the pending-delete queue').toBeUndefined();
        expectNoEscapedErrors();
    });

    it('deletes S when the last tab showing it closes later, after an earlier grace period kept S for that open tab', async () => {
        await setup();
        setTabs(world, [tab(2, chatUrl(S))]);
        const firstUnloadAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, firstUnloadAt + GRACE_MS + 1000);
        expect(deleteRequestsFor(world, S), 'precondition: the open tab kept S').toEqual([]);

        setTabs(world, []);
        const closeAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, closeAt + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, S), 'closing the last tab of S must start a new grace period and delete S once').toEqual([expectedDelete(S)]);
        expect(await queueEntry(world, S), 'a deleted S must leave the pending-delete queue').toBeUndefined();
        expectNoEscapedErrors();
    });

    it('keeps S when a DeepSeek tab shows S, even if a DeepSeek homepage tab is listed before it', async () => {
        await setup();
        setTabs(world, [tab(1, ORIGIN + '/'), tab(2, chatUrl(S))]);
        const unloadAt = now();

        await tabUnloading(world, S);
        await tabUnloading(world, C);
        await advanceTo(world, unloadAt + GRACE_MS + 1000);

        expect(deleteRequestsFor(world, S), 'a chat.deepseek.com tab still shows S: no delete, whatever tab precedes it').toEqual([]);
        expect((await queueEntry(world, S))?.chatUuid, 'S must stay in the pending-delete queue').toBe(S);
        await expectControlDeleted();
        expectNoEscapedErrors();
    });
});

describe('an unload message without a usable uuid is not acknowledged', () => {
    // 規則來源：docs/spec/04-features.md Unload Grace：回覆 { ok: true } 表示已為該 uuid 啟動寬限期；沒有可用 uuid 時沒有寬限期可啟動，不得回報成功，也不得讓監聽器拋錯。
    it.each([
        ['no uuid', (type) => ({ type })],
        ['an empty uuid', (type) => ({ type, uuid: '' })],
        ['a numeric uuid', (type) => ({ type, uuid: 42 })],
        ['an object uuid', (type) => ({ type, uuid: { id: S } })],
        ['a null message (no type either)', () => null],
    ])('%s: no { ok: true } reply, no listener error', async (_label, makeMessage) => {
        await setup();

        const responses = await sendToWorker(world, makeMessage(unloadType(world)), chatUrl(S));

        expect(responses, 'a message that starts no grace period must not be acknowledged with { ok: true }').not.toContainEqual({ ok: true });
        expectNoEscapedErrors();
    });
});
