/**
 * 情境：每個直接啟動補救掃描的事件（瀏覽器啟動 chrome.runtime.onStartup、安裝或更新 chrome.runtime.onInstalled、刪除重試 alarm）對佇列中的臨時對話 U 只送出一次刪除請求，即使掃描期間的同步佇列寫入觸發了 onChanged 安全網掃描；另一掃描進行中時觸發的掃描等前一輪結束才開始；掃描在信任邊界失敗時以 [DSS] 前綴記錄錯誤，不產生未處理的 promise rejection。
 *
 * 規則來源：docs/spec/04-features.md「Fast Restart Recovery」：onStartup 先釋放本機開啟集合中仍在佇列的 lease，清空開啟集合，再執行補救掃描，讓上次關閉前開啟的對話在重啟後立即刪除；Unload Grace 一節「the job runs under the worker's in-flight queue guard ... so the two never delete the same item at once」所述的同一佇列項目不得同時被兩個掃描刪除；以及「Single In-Flight Sweep」：直接觸發的掃描等到沒有佇列工作進行中才執行，同時最多一個掃描，工作錯誤以 console.error 加 [DSS] 前綴記錄，絕不成為未處理的 rejection。
 *
 * 需求（行為）：onStartup 時佇列中有一筆 U（本機開啟集合也有 U，lease 由本機持有），U 的刪除請求到達網路邊界（fetch 刪除端點）恰好一次，且 U 離開佇列。onInstalled 與重試 alarm 時佇列依序有 V 與 U（兩者 lease 皆已釋放），V 的對話正開在本機分頁，掃描依分頁防護替 V 續約而寫入同步佇列；U 的刪除請求同樣恰好一次，且 U 離開佇列。重試 alarm 掃描等候 U 的刪除回應期間 onStartup 觸發：回應到達前不得出現第二個刪除請求，回應到達後 onStartup 掃描才釋放 W 的 lease 並刪除 W，U 與 W 各恰好一次。重試 alarm 掃描（佇列為空）結束前的待刪佇列廣播仍懸置、onStartup 已排在它之後時，另一台裝置寫入 lease 已釋放的 Z：廣播送達後 Z 的刪除請求恰好一次，且 Z 離開佇列。啟動、安裝更新、重試 alarm 與另一台裝置寫入佇列觸發的同步變更掃描中，chrome.alarms.clear 拒絕（promise rejection）或同步拋出時，該錯誤以 console.error('[DSS] <觸發來源> remediation:', error) 記錄恰好一次，且無未處理的 rejection。
 *
 * 前置條件守門：每個 onInstalled 與 alarm 測試都先確認觸發事件之後，worker 收到一筆仍列出 U 的待刪佇列 onChanged 事件（安全網掃描因此能讀到 U）；沒有這筆事件時不存在並行掃描，單一刪除的斷言就不可能失敗。排隊測試先確認第一輪掃描確實停在 U 的刪除回應上；廣播期間測試先確認第一輪掃描廣播的分頁查詢 chrome.tabs.query({}) 確實懸置、尚未送出任何廣播且 onStartup 掃描尚未送出刪除請求，並確認 worker 在查詢懸置期間收到列出 Z 的待刪佇列 onChanged 事件；邊界失敗測試先確認失敗的替身確實被呼叫。
 *
 * 執行方式：test/helpers/unload-grace-harness.js 以 vm context 載入真的 background/service-worker.js 與它 importScripts 的每個模組（真的 pending-store），彼此共用同一份 storage。只替換信任邊界：chrome.storage、chrome.tabs、chrome.alarms、fetch、worker 計時器與 Date.now。
 *
 * storage 替身切換成真實 Chrome 的 onChanged 語意（Chrome 156 驗證，見 testing-pitfalls boundary-doubles-must-copy）：寫入完成後才非同步派送事件，事件只列出值確實改變的 key，完全沒改變的寫入不派送事件。此模式只會減少或延後事件，不會多出事件。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createWorld, bootWorker, relayToken, trackForDeletion, fireStartup, settle, queueEntry, readQueue, readOpenUuids, deleteRequests, deleteRequestsFor, setTabs, temp, tab, chatUrl, ORIGIN,
    useRealChromeChangeEvents, pendingBroadcasts, holdDeleteResponses, holdFirstBroadcastTabsQuery, queueFromAnotherDevice, fireRetryAlarm,
} from '../helpers/unload-grace-harness.js';

const TOKEN = 'Bearer startup-single-delete-token';
const DELETE_URL = ORIGIN + '/api/v0/chat_session/delete';
const U = '5d2f8a10-7c3e-4b9a-a1d4-0e6f2b7c9a35'; // 上次關閉瀏覽器前開啟、已登記待刪的臨時對話
const V = 'a7c4e2b9-3f18-4d6a-8e05-b1c2d3e4f5a6'; // 排在 U 之前、lease 已釋放但正開在本機分頁的臨時對話（掃描會替它續約）
const W = 'c3e8f1a2-6b4d-4e7f-9a0b-2d5c8e1f4a7b'; // 上次關閉瀏覽器前開在本機、lease 仍由本機持有的待刪臨時對話（只有 onStartup 的釋放能讓它立即可刪）

let world;
let unhandled;
const onUnhandled = (reason) => { unhandled.push(reason); };

/** 以 lease 已釋放（lastActiveAt 0）的 uuids 依序建立待刪佇列，存入 token，再以全新 worker 實例開始（模擬更新後重新載入或 worker 被喚醒）；tabs 為本機分頁。 */
async function seedReleasedQueue(uuids, tabs) {
    world = createWorld();
    useRealChromeChangeEvents(world);
    const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
    // 先寫佇列再存 token：寫佇列觸發的安全網掃描因無 token 而不送刪除
    await world.chrome.storage.sync.set({ [key]: uuids.map((chatUuid) => ({ chatUuid, attemptCount: 0, lastActiveAt: 0 })) });
    await settle(world);
    await relayToken(world, TOKEN);
    await settle(world);
    setTabs(world, tabs);
    bootWorker(world);
    await settle(world);
    for (const uuid of uuids) {
        expect((await queueEntry(world, uuid))?.lastActiveAt, `precondition: ${uuid} is queued with a released lease, so a sweep may delete it at once`).toBe(0);
    }
    expect(deleteRequests(world), 'precondition: nothing was deleted during setup (no token while the queue was written)').toEqual([]);
}

/** V、U 皆 lease 已釋放，V 開在本機分頁。 */
const seedReleasedQueueWithOpenV = () => seedReleasedQueue([V, U], [tab(1, chatUrl(V), { active: true })]);

/** 記錄 worker 收到的待刪佇列 onChanged 事件中，新值仍列出 U 的筆數（安全網掃描能讀到 U 的機會）。須在 bootWorker 之後呼叫，監聽器排在 worker 的監聽器之後。 */
function recordQueueChangesListingU(targetWorld) {
    const key = temp(targetWorld).DSS_PENDING_DELETES_SYNC_KEY;
    const seen = [];
    targetWorld.chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !(key in changes)) return;
        const isUListed = (changes[key].newValue || []).some((e) => e.chatUuid === U);
        if (isUListed) seen.push({ deletesForUSoFar: deleteRequestsFor(targetWorld, U).length });
    });
    return seen;
}

async function expectSingleDeleteOfU(path) {
    const deletes = deleteRequestsFor(world, U);
    expect(deletes.length, `the ${path} must send exactly one delete request for U; observed ${deletes.length}`).toBe(1);
    expect(deletes[0], 'the delete uses the extension delete body and the stored token').toEqual({ url: DELETE_URL, rawBody: JSON.stringify({ chat_session_id: U }), body: { chat_session_id: U }, authorization: TOKEN });
    expect(await queueEntry(world, U), 'U must leave the pending-delete queue after its delete succeeded').toBeUndefined();
    expect(deleteRequestsFor(world, V), 'V is open in a local tab, so no sweep may delete it').toEqual([]);
    expect(unhandled, 'no unhandled promise rejection may escape the remediation').toEqual([]);
}

/** 依序列出送往刪除端點的對話 uuid。 */
const deletedIds = () => deleteRequests(world).map((r) => r.body.chat_session_id);

/** 讓 heldUuid 的刪除請求懸置到呼叫回傳的 release 為止（網路回應未到），其餘刪除請求立即成功。 */
function holdDeleteResponseOf(targetWorld, heldUuid) {
    let resolveHeld;
    const held = new Promise((resolve) => { resolveHeld = resolve; });
    targetWorld.fetch = vi.fn(async (url, init) => (JSON.parse(init.body).chat_session_id === heldUuid ? held : { ok: true }));
    return () => resolveHeld({ ok: true });
}

/** 斷言 error 以 console.error('[DSS] <context> remediation:', error) 記錄恰好一次（完整文字含觸發來源），且無未處理的 rejection。 */
function expectLoggedOnce(error, context) {
    const calls = world.console.error.mock.calls.filter((args) => args.includes(error));
    expect(calls.length, `the ${context} sweep error must be logged with console.error exactly once; observed ${calls.length}`).toBe(1);
    expect(calls[0], `the ${context} sweep error log must name its trigger`).toEqual([`[DSS] ${context} remediation:`, error]);
    expect(unhandled, `the ${context} sweep error must not escape as an unhandled promise rejection`).toEqual([]);
}

beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
});

describe('browser startup with one queued, locally open temporary conversation', () => {
    it('sends exactly one delete request for U and removes U from the queue', async () => {
        world = createWorld();
        useRealChromeChangeEvents(world);
        await relayToken(world, TOKEN);
        await trackForDeletion(world, U);
        await settle(world);

        const before = await queueEntry(world, U);
        expect(before?.chatUuid, 'precondition: U is in the pending-delete queue').toBe(U);
        expect(before.lastActiveAt, 'precondition: U holds a live lease (non-zero lastActiveAt), so the startup release is a real change of the stored queue').toBeGreaterThan(0);
        expect(await readOpenUuids(world), 'precondition: U is in the local open set').toEqual([U]);
        expect(deleteRequestsFor(world, U), 'precondition: nothing deleted U before startup (its lease is live)').toEqual([]);

        bootWorker(world); // 瀏覽器重啟：全新 worker 實例，storage 保留
        await fireStartup(world);
        await settle(world, 60);

        const deletes = deleteRequestsFor(world, U);
        expect(deletes.length, `the startup must send exactly one delete request for U; observed ${deletes.length}`).toBe(1);
        expect(deletes[0], 'the delete uses the extension delete body and the stored token').toEqual({ url: DELETE_URL, rawBody: JSON.stringify({ chat_session_id: U }), body: { chat_session_id: U }, authorization: TOKEN });
        expect(await queueEntry(world, U), 'U must leave the pending-delete queue after its delete succeeded').toBeUndefined();
        expect(unhandled, 'no unhandled promise rejection may escape the startup remediation').toEqual([]);
    });
});

describe('extension install or update with a queued released U behind a tab-guarded V', () => {
    it('sends exactly one delete request for U although the V lease refresh fires a sync-change sweep', async () => {
        await seedReleasedQueueWithOpenV();
        const changesListingU = recordQueueChangesListingU(world);

        world.events.onInstalled.listeners.forEach((fn) => fn({ reason: 'update' }));
        await settle(world, 60);

        expect(changesListingU.length, 'precondition: during the install sweep the worker receives a pending-delete onChanged event that still lists U, so a sync-change sweep can race the install sweep').toBeGreaterThan(0);
        await expectSingleDeleteOfU('install or update remediation');
    });
});

describe('delete retry alarm with a queued released U behind a tab-guarded V', () => {
    it('sends exactly one delete request for U although the V lease refresh fires a sync-change sweep', async () => {
        await seedReleasedQueueWithOpenV();
        const changesListingU = recordQueueChangesListingU(world);

        fireRetryAlarm(world);
        await settle(world, 60);

        expect(changesListingU.length, 'precondition: during the alarm sweep the worker receives a pending-delete onChanged event that still lists U, so a sync-change sweep can race the alarm sweep').toBeGreaterThan(0);
        await expectSingleDeleteOfU('retry alarm remediation');
    });
});

/** 上次工作階段留下 U（lease 已釋放）與 W（lease 由本機持有、在本機開啟集合）的待刪佇列，token 已存，以全新 worker 實例開始。 */
async function seedReleasedUAndLiveW() {
    world = createWorld();
    useRealChromeChangeEvents(world);
    await trackForDeletion(world, W); // 上次工作階段開著 W：佇列中 lease 由本機持有，且在本機開啟集合
    await settle(world);
    const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
    await world.chrome.storage.sync.set({ [key]: [{ chatUuid: U, attemptCount: 0, lastActiveAt: 0 }, ...(await readQueue(world))] });
    await settle(world);
    await relayToken(world, TOKEN); // token 最後才存：設定期間的安全網掃描不送刪除
    await settle(world);
    bootWorker(world); // 瀏覽器重新啟動：全新 worker 實例，storage 保留
    await settle(world);
    expect((await queueEntry(world, U))?.lastActiveAt, 'precondition: U is queued with a released lease').toBe(0);
    expect((await queueEntry(world, W))?.lastActiveAt, 'precondition: W is queued with a live lease, so only the startup release makes it deletable').toBeGreaterThan(0);
    expect(await readOpenUuids(world), 'precondition: W is in the local open set').toEqual([W]);
    expect(deletedIds(), 'precondition: nothing was deleted during setup').toEqual([]);
}

describe('browser startup while the retry alarm sweep still waits for a delete response', () => {
    it('starts the startup sweep only after the alarm sweep settles, and each queued uuid gets exactly one delete request', async () => {
        await seedReleasedUAndLiveW();

        const releaseU = holdDeleteResponseOf(world, U);
        fireRetryAlarm(world); // 逾期的重試 alarm 先觸發
        await settle(world, 60);
        expect(deletedIds(), 'precondition: the alarm sweep sent the delete for U, skipped W (live lease) and now waits for the U response').toEqual([U]);

        await fireStartup(world); // 同一次啟動中 onStartup 在 alarm 掃描進行時觸發
        await settle(world, 60);
        expect(deletedIds(), 'while the alarm sweep waits for the U response, the startup sweep must not start: no second delete for U and no delete for W').toEqual([U]);

        releaseU();
        await settle(world, 60);
        expect(deletedIds(), 'after the alarm sweep settles, the waiting startup sweep releases W and deletes it; U and W each get exactly one delete request').toEqual([U, W]);
        expect(await readQueue(world), 'both deletes succeeded, so the pending-delete queue is empty').toEqual([]);
        expect(await readOpenUuids(world), 'the startup sweep cleared the local open set').toEqual([]);
        expect(unhandled, 'no unhandled promise rejection may escape either sweep').toEqual([]);
    }, 20000); // 本測試串接多輪 settle（Windows 計時器解析度下每輪 setTimeout(0) 約 15 毫秒），實測 4 至 6 秒，會超過預設的 5 秒上限
});

describe('two sweeps waiting behind the retry alarm sweep', () => {
    it('runs the startup sweep and then the install sweep one at a time, so W gets exactly one delete request', async () => {
        await seedReleasedUAndLiveW();
        const release = holdDeleteResponses(world, [U, W]);

        fireRetryAlarm(world);
        await settle(world, 60);
        expect(deletedIds(), 'precondition: the alarm sweep sent the delete for U and waits for its response').toEqual([U]);
        await fireStartup(world); // 啟動與安裝更新先後在 alarm 掃描進行時觸發，兩者都得等
        world.events.onInstalled.listeners.forEach((fn) => fn({ reason: 'update' }));
        await settle(world, 60);
        expect(deletedIds(), 'while the alarm sweep waits, neither waiting sweep may start').toEqual([U]);

        release(U);
        await settle(world, 60);
        expect(deletedIds(), 'the startup sweep releases W and sends its delete; the install sweep must still wait for that delete response').toEqual([U, W]);

        release(W);
        await settle(world, 60);
        expect(deletedIds(), 'the install sweep finds an empty queue: U and W each got exactly one delete request').toEqual([U, W]);
        expect(await readQueue(world), 'the pending-delete queue is empty').toEqual([]);
        expect(unhandled, 'no unhandled promise rejection may escape any sweep').toEqual([]);
    }, 30000); // 串接多輪 settle，Windows 計時器解析度下實測數秒，會超過預設的 5 秒上限
});

describe('the in-flight guard after sweeps', () => {
    it('ends every sweep with a broadcast and lets a later sync-change from another device start its own sweep', async () => {
        await seedReleasedQueue([U], [tab(1, ORIGIN + '/', { active: true })]);

        fireRetryAlarm(world);
        await settle(world, 60);
        expect(deletedIds(), 'precondition: the first alarm sweep deleted U').toEqual([U]);
        expect(pendingBroadcasts(world), 'the first sweep ends with one broadcast of the emptied queue to the open tab').toEqual([{ tabId: 1, uuids: [] }]);

        const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
        await world.chrome.storage.sync.set({ [key]: [{ chatUuid: V, attemptCount: 0, lastActiveAt: 0 }] }); // 另一台裝置寫入佇列
        await settle(world, 60);
        expect(deletedIds(), 'a queue write from another device after the sweep ended must start the sync-change scan, which deletes V').toEqual([U, V]);

        fireRetryAlarm(world);
        await settle(world, 60);
        expect(pendingBroadcasts(world), 'the sync-change scan and the second alarm sweep each end with one more broadcast').toEqual([{ tabId: 1, uuids: [] }, { tabId: 1, uuids: [] }, { tabId: 1, uuids: [] }]);
        expect(deletedIds(), 'the second alarm sweep finds an empty queue').toEqual([U, V]);
        expect(unhandled, 'no unhandled promise rejection may escape').toEqual([]);
    }, 20000);
});

const Z = 'e9b1d4c7-2a5f-4c8e-b3d6-7f0a1c2e5b94'; // 第一輪掃描的廣播懸置期間，另一台裝置寫入佇列、lease 已釋放的臨時對話

describe('a queue write from another device while a finished sweep is still broadcasting and a startup sweep waits behind it', () => {
    it('sends exactly one delete request for Z and removes Z from the queue', async () => {
        await seedReleasedQueue([], [tab(1, ORIGIN + '/', { active: true })]);
        const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
        const broadcastQuery = holdFirstBroadcastTabsQuery(world);
        const releaseZ = holdDeleteResponseOf(world, Z); // Z 的網路回應晚到：重疊的掃描都看得到仍在佇列的 Z
        const changesListingZ = [];
        world.chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && key in changes && (changes[key].newValue || []).some((e) => e.chatUuid === Z)) changesListingZ.push({ isBroadcastQueryHeld: broadcastQuery.state.isHeldPending });
        });

        fireRetryAlarm(world); // 掃描 A：佇列為空，結束前廣播給開啟的分頁
        await settle(world, 60);
        await fireStartup(world); // onStartup 排在掃描 A 之後
        expect(broadcastQuery.state, 'precondition: sweep A reached its closing broadcast and its tabs.query({}) is held pending (exactly one unfiltered query so far)').toEqual({ unfilteredCalls: 1, isHeldPending: true });
        expect(pendingBroadcasts(world), 'precondition: the held query keeps sweep A from sending any broadcast message yet').toEqual([]);
        expect(deletedIds(), 'precondition: the startup sweep waits behind sweep A and has sent no delete request').toEqual([]);

        await world.chrome.storage.sync.set({ [key]: [{ chatUuid: Z, attemptCount: 0, lastActiveAt: 0 }] }); // 另一台裝置寫入 Z
        await settle(world, 60);
        expect(changesListingZ, 'precondition: the worker received a pending-delete onChanged event listing Z while sweep A\'s broadcast query was held').toContainEqual({ isBroadcastQueryHeld: true });
        expect(broadcastQuery.state.isHeldPending, 'precondition: sweep A\'s broadcast query is still held after the Z write settled').toBe(true);

        broadcastQuery.release();
        await settle(world, 60);
        releaseZ();
        await settle(world, 60);

        const deletesForZ = deleteRequestsFor(world, Z);
        expect(deletesForZ.length, `Z must receive exactly one delete request; observed delete request ids ${JSON.stringify(deletedIds())}`).toBe(1);
        expect(deletesForZ[0], 'the delete uses the extension delete body and the stored token').toEqual({ url: DELETE_URL, rawBody: JSON.stringify({ chat_session_id: Z }), body: { chat_session_id: Z }, authorization: TOKEN });
        expect(await queueEntry(world, Z), 'Z must leave the pending-delete queue after its delete succeeded').toBeUndefined();
        expect(unhandled, 'no unhandled promise rejection may escape any sweep').toEqual([]);
    }, 30000); // 串接多輪 settle，Windows 計時器解析度下實測數秒，會超過預設的 5 秒上限
});

describe('a sweep whose trust-boundary call fails', () => {
    it('logs a rejected chrome.alarms.clear during the startup sweep with its trigger and lets nothing escape', async () => {
        await seedReleasedQueue([U], []);
        const failure = new Error('alarms.clear rejected (startup sweep)');
        world.chrome.alarms.clear = vi.fn(async () => { throw failure; });

        await fireStartup(world);
        await settle(world, 60);

        expect(world.chrome.alarms.clear.mock.calls.length, 'precondition: the startup sweep reached the failing chrome.alarms.clear').toBeGreaterThan(0);
        expectLoggedOnce(failure, 'startup');
    });

    it('logs a rejected chrome.alarms.clear during the install sweep with its trigger and lets nothing escape', async () => {
        await seedReleasedQueue([U], []);
        const failure = new Error('alarms.clear rejected (install sweep)');
        world.chrome.alarms.clear = vi.fn(async () => { throw failure; });

        world.events.onInstalled.listeners.forEach((fn) => fn({ reason: 'update' }));
        await settle(world, 60);

        expect(world.chrome.alarms.clear.mock.calls.length, 'precondition: the install sweep reached the failing chrome.alarms.clear').toBeGreaterThan(0);
        expectLoggedOnce(failure, 'install');
    });

    it('logs a synchronously thrown chrome.alarms.clear during the retry alarm sweep with its trigger and lets nothing escape', async () => {
        await seedReleasedQueue([U], []);
        const failure = new Error('alarms.clear threw synchronously (retry alarm sweep)');
        world.chrome.alarms.clear = vi.fn(() => { throw failure; });

        fireRetryAlarm(world);
        await settle(world, 60);

        expect(world.chrome.alarms.clear.mock.calls.length, 'precondition: the retry alarm sweep reached the failing chrome.alarms.clear').toBeGreaterThan(0);
        expectLoggedOnce(failure, 'retry alarm');
    });

    it('logs a rejected chrome.alarms.clear during the sync-change sweep started by another device with its trigger and lets nothing escape', async () => {
        await seedReleasedQueue([], []);
        const failure = new Error('alarms.clear rejected (sync change sweep)');
        world.chrome.alarms.clear = vi.fn(async () => { throw failure; });

        await queueFromAnotherDevice(world, U); // 另一台裝置寫入 lease 已釋放的 U：同步變更安全網啟動掃描
        await settle(world, 60);

        expect(world.chrome.alarms.clear.mock.calls.length, 'precondition: the sync-change sweep reached the failing chrome.alarms.clear').toBeGreaterThan(0);
        expectLoggedOnce(failure, 'sync change');
    });
});
