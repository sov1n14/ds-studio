/**
 * 情境：卸載寬限到期的刪除在另一個佇列工作進行中執行（巢狀工作），外層工作的結尾廣播與補救重入防護（in-flight 旗標）必須涵蓋它；結尾廣播失敗時記錄錯誤，工作照樣結束。
 *
 * 規則來源：docs/spec/04-features.md Unload Grace「At expiry」：工作進行中時寬限到期的刪除立即在其內執行，外層工作等巢狀的寬限刪除結束後才做結尾廣播、才清除 in-flight 旗標；以及「Single In-Flight Sweep」：旗標設定期間同步變更掃描一律略過；每個佇列工作以廣播佇列快照給所有分頁結束，讓各分頁的隱藏集合與儲存的佇列一致；廣播期間有巢狀工作加入時再廣播一次後才清除旗標；廣播失敗以 console.error("[DSS] broadcastPendingUuids:", error) 記錄。
 *
 * 需求（行為）：
 *   - 同步變更掃描等候 A 的刪除回應時，S 的寬限到期而送出刪除請求（回應懸置）。A 的回應到達、A 離開佇列後，S 的回應到達前不得出現任何待刪佇列廣播；此期間另一台裝置寫入 lease 已釋放的 Z，不得啟動第二輪掃描（Z 沒有刪除請求）。S 的回應到達後恰好一次廣播，列出當下佇列 [Z]。
 *   - 重試 alarm 掃描的結尾廣播懸置期間（分頁查詢未回應），S 的寬限到期而在其內執行，S 的刪除回應在廣播結束後仍懸置：回應到達前另一台裝置寫入的 Z 不得啟動第二輪掃描，回應到達後最後一次廣播列出 [Z]（S 已移出佇列）。
 *   - 結尾廣播本身失敗（chrome.tabs.sendMessage 同步拋出）時，該錯誤以 console.error('[DSS] broadcastPendingUuids:', error) 記錄恰好一次，不以掃描的觸發來源記錄、不成為未處理的 rejection；工作照樣結束，之後另一台裝置寫入的 Z 由同步變更掃描刪除恰好一次。
 *
 * 前置條件守門：每個「不得啟動第二輪掃描」斷言前，先確認 worker 確實收到列出 Z 的待刪佇列 onChanged 事件；每個巢狀情境先確認 S 的刪除請求是在外層工作進行中送出；廣播懸置情境先確認外層的分頁查詢 chrome.tabs.query({}) 懸置且尚未送出廣播。
 *
 * 執行方式：test/helpers/unload-grace-harness.js 以 vm context 載入真的 background/service-worker.js 與它 importScripts 的每個模組，只替換信任邊界（chrome.storage、chrome.tabs、chrome.alarms、fetch、worker 計時器與 Date.now）；storage 替身切換成真實 Chrome 的 onChanged 語意（useRealChromeChangeEvents）。懸置一律以 deferred promise 控制，斷言不依賴等待輪數的餘裕。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createWorld, relayToken, trackForDeletion, tabUnloading, settle, advanceTo, setTabs, tab, ORIGIN, temp, queueEntry, deleteRequests, deleteRequestsFor,
    useRealChromeChangeEvents, queueFromAnotherDevice, pendingBroadcasts, holdDeleteResponses, holdFirstBroadcastTabsQuery, fireRetryAlarm,
} from '../helpers/unload-grace-harness.js';

const GRACE_MS = 10000; // Unload Grace 寬限期
const TOKEN = 'Bearer nested-grace-job-token';
const DELETE_URL = ORIGIN + '/api/v0/chat_session/delete';
const S = '3f6a2c1e-8b4d-4e9f-a0c7-5d1b2e3f4a6c'; // 已登記待刪、分頁卸載後寬限到期的臨時對話
const A = '7e2d9b4a-1c6f-4a8e-b5d3-0f9e8d7c6b5a'; // 另一台裝置寫入、lease 已釋放的對話（外層同步變更掃描刪除它）
const Z = 'b8c1f3e5-4a2d-4f6b-9e0c-1d2a3b4c5d6e'; // 巢狀刪除進行中，另一台裝置寫入、lease 已釋放的對話

let world;
let unhandled;
const onUnhandled = (reason) => { unhandled.push(reason); };

const now = () => world.clock.now();
const expectedDelete = (uuid) => ({ url: DELETE_URL, rawBody: JSON.stringify({ chat_session_id: uuid }), body: { chat_session_id: uuid }, authorization: TOKEN });
const deletedIds = () => deleteRequests(world).map((r) => r.body.chat_session_id);

/** 一個開著 DeepSeek 首頁分頁（分頁 1，可收廣播、不顯示 S）的設定檔：token 已存，S 已登記待刪（lease 由本機持有）。 */
async function setupTrackedS() {
    world = createWorld();
    useRealChromeChangeEvents(world);
    setTabs(world, [tab(1, ORIGIN + '/', { active: true })]);
    await relayToken(world, TOKEN);
    await trackForDeletion(world, S);
    await settle(world);
    expect((await queueEntry(world, S))?.lastActiveAt, 'precondition: S is queued with a live lease, so no sweep deletes it before its grace period ends').toBeGreaterThan(0);
    expect(deletedIds(), 'precondition: nothing was deleted during setup').toEqual([]);
}

/** 記錄 worker 收到、新值列出 uuid 的待刪佇列 onChanged 事件筆數。監聽器排在 worker 的監聽器之後。 */
function recordQueueChangesListing(uuid) {
    const key = temp(world).DSS_PENDING_DELETES_SYNC_KEY;
    const seen = [];
    world.chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && key in changes && (changes[key].newValue || []).some((e) => e.chatUuid === uuid)) seen.push(uuid);
    });
    return seen;
}

/** 另一台裝置寫入 Z，斷言 worker 收到列出 Z 的事件，且沒有任何掃描送出 Z 的刪除請求。 */
async function expectNoSecondScanForZ(reason) {
    const changesListingZ = recordQueueChangesListing(Z);
    await queueFromAnotherDevice(world, Z);
    await settle(world, 60);
    expect(changesListingZ.length, 'precondition: the worker received a pending-delete onChanged event listing Z').toBeGreaterThan(0);
    expect(deleteRequestsFor(world, Z), reason).toEqual([]);
}

beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
});

describe('an unload-grace delete that expires while a sync-change sweep waits for a delete response', () => {
    it('makes the sweep hold its broadcast and its in-flight guard until the nested delete of S settles', async () => {
        await setupTrackedS();
        const release = holdDeleteResponses(world, [A, S]);
        await queueFromAnotherDevice(world, A);
        await settle(world, 30);
        expect(deletedIds(), 'precondition: the sync-change sweep sent the delete for A and waits for its response').toEqual([A]);

        const unloadAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS + 1000);
        expect(deletedIds(), 'precondition: the grace period of S ended while the A sweep was in flight, and its nested delete for S waits for its response').toEqual([A, S]);

        const broadcastsBefore = pendingBroadcasts(world).length;
        release(A);
        await settle(world, 60);
        expect(await queueEntry(world, A), 'precondition: the outer sweep finished its own work (A left the queue)').toBeUndefined();
        expect(pendingBroadcasts(world).slice(broadcastsBefore), 'the outer sweep must not broadcast while the nested delete of S is still waiting for its response').toEqual([]);

        await expectNoSecondScanForZ('while the nested delete of S is pending, the outer sweep keeps its in-flight guard, so a sync change from another device must not start a second scan');

        release(S);
        await settle(world, 60);
        expect(pendingBroadcasts(world).slice(broadcastsBefore), 'once the nested delete of S settles, the outer sweep broadcasts exactly once, listing the stored queue (S removed, Z added)').toEqual([{ tabId: 1, uuids: [Z] }]);
        expect(deleteRequestsFor(world, A), 'A gets exactly one delete request').toEqual([expectedDelete(A)]);
        expect(deleteRequestsFor(world, S), 'S gets exactly one delete request').toEqual([expectedDelete(S)]);
        expect(await queueEntry(world, S), 'S leaves the pending-delete queue after its delete succeeded').toBeUndefined();
        expect(unhandled, 'no unhandled promise rejection may escape').toEqual([]);
    }, 30000); // 串接多輪 settle，Windows 計時器解析度下實測數秒，會超過預設的 5 秒上限
});

describe('an unload-grace delete that expires while the retry alarm sweep is broadcasting', () => {
    /** 讓 S 的寬限期在重試 alarm 掃描的結尾廣播懸置期間結束；回傳該廣播的查詢控制。 */
    async function expireGraceDuringHeldBroadcast() {
        const unloadAt = now();
        await tabUnloading(world, S);
        await advanceTo(world, unloadAt + GRACE_MS - 1000);
        expect(deletedIds(), 'precondition: no delete before the grace period of S ends').toEqual([]);

        const broadcastsBefore = pendingBroadcasts(world).length;
        const broadcastQuery = holdFirstBroadcastTabsQuery(world);
        fireRetryAlarm(world);
        await settle(world, 30);
        expect(broadcastQuery.state, 'precondition: the alarm sweep reached its closing broadcast and its tabs.query({}) is held').toEqual({ unfilteredCalls: 1, isHeldPending: true });
        expect(pendingBroadcasts(world).length, 'precondition: the held query keeps the alarm sweep from sending its broadcast yet').toBe(broadcastsBefore);

        await advanceTo(world, unloadAt + GRACE_MS + 1000);
        expect(deletedIds(), 'precondition: the grace period of S ended during the held broadcast and the nested job sent the delete for S').toEqual([S]);
        expect(broadcastQuery.state.isHeldPending, 'precondition: the closing broadcast query is still held').toBe(true);
        return broadcastQuery;
    }

    it('re-broadcasts after a nested delete still pending at the end of the broadcast, and a sync change meanwhile starts no second scan', async () => {
        await setupTrackedS();
        const release = holdDeleteResponses(world, [S]);
        const broadcastQuery = await expireGraceDuringHeldBroadcast();

        broadcastQuery.release();
        await settle(world, 60);
        await expectNoSecondScanForZ('the nested delete of S joined during the closing broadcast and is still pending, so the in-flight guard stays set and a sync change must not start a second scan');

        release(S);
        await settle(world, 60);
        expect(pendingBroadcasts(world).at(-1), 'after the nested delete of S settles, the last broadcast lists the stored queue: S removed, Z added').toEqual({ tabId: 1, uuids: [Z] });
        expect(deleteRequestsFor(world, S), 'S gets exactly one delete request').toEqual([expectedDelete(S)]);
        expect(await queueEntry(world, S), 'S leaves the pending-delete queue after its delete succeeded').toBeUndefined();
        expect(unhandled, 'no unhandled promise rejection may escape').toEqual([]);
    }, 30000);

    it('re-broadcasts after a nested delete that finished while the broadcast was held, so the hide set drops the deleted S', async () => {
        await setupTrackedS();
        const broadcastQuery = await expireGraceDuringHeldBroadcast();
        expect(await queueEntry(world, S), 'precondition: the nested delete of S succeeded and S left the queue while the broadcast was held').toBeUndefined();

        broadcastQuery.release();
        await settle(world, 60);
        expect(pendingBroadcasts(world).at(-1), 'the last broadcast must match the stored queue, which no longer lists the deleted S').toEqual({ tabId: 1, uuids: [] });
        expect(deleteRequestsFor(world, S), 'S gets exactly one delete request').toEqual([expectedDelete(S)]);
        expect(unhandled, 'no unhandled promise rejection may escape').toEqual([]);
    }, 30000);
});

describe('a closing broadcast that fails', () => {
    it('logs the failure as [DSS] broadcastPendingUuids:, and the sweep still ends so a later sync change is swept', async () => {
        world = createWorld();
        useRealChromeChangeEvents(world);
        setTabs(world, [tab(1, ORIGIN + '/', { active: true })]);
        await relayToken(world, TOKEN);
        await settle(world);
        const failure = new Error('tabs.sendMessage threw synchronously');
        world.chrome.tabs.sendMessage = vi.fn(() => { throw failure; });

        fireRetryAlarm(world);
        await settle(world, 60);

        expect(world.chrome.tabs.sendMessage.mock.calls.length, 'precondition: the alarm sweep reached its closing broadcast and called the failing chrome.tabs.sendMessage').toBeGreaterThan(0);
        const logged = world.console.error.mock.calls.filter((args) => args.includes(failure));
        expect(logged, 'the broadcast failure must be logged exactly once with the broadcastPendingUuids prefix, not as a sweep failure').toEqual([['[DSS] broadcastPendingUuids:', failure]]);

        await queueFromAnotherDevice(world, Z);
        await settle(world, 60);
        expect(deleteRequestsFor(world, Z), 'the sweep ended despite its failed broadcast, so a later sync change from another device starts a scan that deletes Z exactly once').toEqual([expectedDelete(Z)]);
        expect(await queueEntry(world, Z), 'Z leaves the pending-delete queue after its delete succeeded').toBeUndefined();
        expect(unhandled, 'the broadcast failure must not escape as an unhandled promise rejection').toEqual([]);
    }, 30000);
});
