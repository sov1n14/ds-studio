import { test as base, expect } from './fixtures.js';
import { openConversation } from './helpers/conversations.js';
import { evaluateInWorker } from './helpers/extension.js';
import { readBothAreas, setLocal, setSync } from './helpers/settings.js';
import { AUTH_TOKEN_KEY, DEVICE_ID_KEY, expectNoFurtherDeletes, LAST_SEEN_PREFIX, pinTempChatSettings, QUEUE_KEY, queueEntry, sendFirstMessageFromHome, withDeleteGuard } from './helpers/temp-chat-delete.js';

// 臨時對話的跨裝置保護（docs/FEATURES.md 的 Cross-Device Protection）：擁有者裝置 id、租約逾時（本機建立 10 分鐘、其他裝置或無擁有者 24 小時、明確釋放立即過期）與分頁保護。
// 清除流程的觸發：測試把項目寫進 chrome.storage.sync 的待刪佇列，這次 sync 變更本身就啟動清除流程，與另一台裝置寫入佇列時走同一條產品路徑（docs/ARCHITECTURE.md 的 Layer 2 remediation）；測試不呼叫任何內部函式。
// 斷言只看可觀察的結果：攔截到的刪除請求，以及佇列與 chrome.storage.local 的內容。
// 每一個放進佇列的 uuid 都是測試自行產生、不存在於 DeepSeek 的 id，並登記為刪除攔截所擁有（helpers/temp-chat-delete.js）；佇列、裝置 id、權杖與租約觀察鍵在測試後還原，權杖值從不讀出或印出。

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const test = withDeleteGuard(base);

// 首次送出需要回放的 chat_session/create 延遲 400 毫秒，頁面世界的掛鉤才看得到它（同 temp-chat.e2e.js）。
test.use({ replayLatency: { history: 400, create: 400 } });

/**
 * 釘住清除流程的前提：臨時對話開啟、本裝置 id 為新產生的 uuid，並等待本裝置持有權杖（開關開啟時首頁分頁交給 service worker 的權杖；清除流程沒有權杖不刪除）。
 * 回傳本裝置 id。
 */
async function prepareThisDevice(context, settings) {
    await pinTempChatSettings(settings, { tempChat: true });
    const ownDeviceId = crypto.randomUUID();
    await settings.set({ [DEVICE_ID_KEY]: ownDeviceId });
    await expect.poll(async () => AUTH_TOKEN_KEY in (await readBothAreas(context, [AUTH_TOKEN_KEY])).local, { message: 'this device holds an auth token, which the cleanup run needs (precondition)' }).toBe(true);
    return ownDeviceId;
}

/**
 * 把 `entries`（`{ chatUuid, lastActiveAt, ownerDeviceId?, observedAt? }`）放進待刪佇列。
 * 有 `observedAt` 的項目先在本機寫下租約觀察（本裝置在 `observedAt` 看到這個 `lastActiveAt`），再一次寫入 sync 佇列；這次 sync 寫入啟動清除流程。
 * 回傳寫入佇列的項目。
 */
async function seedQueue(context, deleteGuard, entries) {
    entries.forEach(({ chatUuid }) => deleteGuard.own(chatUuid));
    const observations = Object.fromEntries(entries.filter((entry) => 'observedAt' in entry).map(({ chatUuid, lastActiveAt, observedAt }) => [LAST_SEEN_PREFIX + chatUuid, { lastActiveAt, observedAt }]));
    if (Object.keys(observations).length > 0) await setLocal(context, observations);
    const queue = entries.map(({ chatUuid, lastActiveAt, ownerDeviceId }) => ({ chatUuid, attemptCount: 0, lastActiveAt, ...(ownerDeviceId === undefined ? {} : { ownerDeviceId }) }));
    await setSync(context, { [QUEUE_KEY]: queue });
    return queue;
}

/** 一個已明確釋放（`lastActiveAt` 為 0）的本裝置項目：清除流程必定刪除它，它從佇列消失就代表同一次清除流程已處理完整個佇列。 */
function releasedMarker(ownDeviceId) {
    return { chatUuid: crypto.randomUUID(), lastActiveAt: 0, ownerDeviceId: ownDeviceId };
}

/** 等待清除流程刪除並移除 `marker`，即同一次清除流程已對佇列中每個項目作出決定。 */
async function awaitCleanupRun(context, deleteGuard, marker) {
    await expect.poll(() => deleteGuard.ownedDeleteIds().includes(marker.chatUuid), { message: 'the cleanup run deletes the released marker entry (precondition: the run happened)' }).toBe(true);
    await expect.poll(() => queueEntry(context, marker.chatUuid), { message: 'the cleanup run removed the released marker entry (precondition: the run finished)' }).toBe(null);
}

/** 佇列項目中可比較的欄位。 */
function comparable({ chatUuid, lastActiveAt, ownerDeviceId }) {
    return { chatUuid, lastActiveAt, ownerDeviceId };
}

/** 等待 `ids` 各被刪除一次並移出佇列，之後觀察窗內不再有刪除請求。 */
async function expectDeletedOnceAndDequeued(page, context, deleteGuard, ids) {
    await expect.poll(() => [...deleteGuard.ownedDeleteIds()].sort(), { message: 'the cleanup run sends one delete request for each expired entry' }).toEqual([...ids].sort());
    await expectNoFurtherDeletes(page, deleteGuard, 'no second delete request follows');
    for (const id of ids) {
        await expect.poll(() => queueEntry(context, id), { message: `the deleted entry ${id} is removed from dss-pending-deletes-sync` }).toBe(null);
    }
    expect(deleteGuard.refused(), 'no delete request for any conversation the test did not create').toEqual([]);
}

/** 等待清除流程處理完 `marker`，斷言 `kept` 沒有收到刪除請求且仍在佇列中；回傳 `kept` 目前的佇列項目。 */
async function expectKeptAfterCleanupRun(page, context, deleteGuard, marker, kept, reason) {
    await awaitCleanupRun(context, deleteGuard, marker);
    await expectNoFurtherDeletes(page, deleteGuard, `${reason}: no delete request follows the cleanup run`);
    expect(deleteGuard.ownedDeleteIds(), `${reason}: the cleanup run deletes only the released marker`).toEqual([marker.chatUuid]);
    expect(deleteGuard.refused(), 'no delete request for any conversation the test did not create').toEqual([]);
    const entry = await queueEntry(context, kept.chatUuid);
    expect(entry?.chatUuid ?? null, `${reason}: the entry stays in dss-pending-deletes-sync`).toBe(kept.chatUuid);
    return entry;
}

test.describe('temporary conversation: cross-device protection', { tag: '@offline' }, () => {
    test('the first temporary conversation on a device without a device id generates a random device id, kept in local storage only, and records it as the owner', async ({ page, context, settings, deleteGuard }) => {
        await pinTempChatSettings(settings, { tempChat: true });
        await evaluateInWorker(context, (key) => chrome.storage.local.remove(key), DEVICE_ID_KEY);
        expect(DEVICE_ID_KEY in (await readBothAreas(context, [DEVICE_ID_KEY])).local, 'this device has no device id yet (precondition)').toBe(false);

        const id = await sendFirstMessageFromHome(page, deleteGuard);
        await expect.poll(() => queueEntry(context, id).then((entry) => entry?.chatUuid ?? null), { message: 'the new conversation is queued for deletion' }).toBe(id);
        const { local, sync } = await readBothAreas(context, [DEVICE_ID_KEY]);
        expect(local[DEVICE_ID_KEY], 'the device id generated on first registration is a random uuid').toMatch(UUID_PATTERN);
        expect(DEVICE_ID_KEY in sync, 'the device id is never synced').toBe(false);
        expect((await queueEntry(context, id)).ownerDeviceId, 'the queued entry records this device as its owner').toBe(local[DEVICE_ID_KEY]);
    });

    test('an entry created on this device whose lease went unrenewed for more than 10 minutes is deleted once and dequeued', async ({ page, context, settings, deleteGuard }) => {
        const ownDeviceId = await prepareThisDevice(context, settings);
        const at = Date.now() - 11 * MINUTE_MS;
        const [stale] = await seedQueue(context, deleteGuard, [{ chatUuid: crypto.randomUUID(), lastActiveAt: at, observedAt: at, ownerDeviceId: ownDeviceId }]);

        await expectDeletedOnceAndDequeued(page, context, deleteGuard, [stale.chatUuid]);
    });

    test('an entry created on this device whose lease was renewed 9 minutes ago is kept unchanged', async ({ page, context, settings, deleteGuard }) => {
        const ownDeviceId = await prepareThisDevice(context, settings);
        const at = Date.now() - 9 * MINUTE_MS;
        const marker = releasedMarker(ownDeviceId);
        const [fresh] = await seedQueue(context, deleteGuard, [{ chatUuid: crypto.randomUUID(), lastActiveAt: at, observedAt: at, ownerDeviceId: ownDeviceId }, marker]);

        const entry = await expectKeptAfterCleanupRun(page, context, deleteGuard, marker, fresh, 'a lease renewed within 10 minutes');
        expect(entry, 'the kept entry is unchanged').toEqual(comparable(fresh));
    });

    test('an entry owned by another device whose lease went unrenewed for 11 minutes is kept', async ({ page, context, settings, deleteGuard }) => {
        const ownDeviceId = await prepareThisDevice(context, settings);
        const at = Date.now() - 11 * MINUTE_MS;
        const marker = releasedMarker(ownDeviceId);
        const [foreign] = await seedQueue(context, deleteGuard, [{ chatUuid: crypto.randomUUID(), lastActiveAt: at, observedAt: at, ownerDeviceId: crypto.randomUUID() }, marker]);

        const entry = await expectKeptAfterCleanupRun(page, context, deleteGuard, marker, foreign, 'another device may still use the conversation');
        expect(entry, 'the kept entry is unchanged').toEqual(comparable(foreign));
    });

    test('entries owned by another device or by no device are deleted once their lease went unrenewed for more than 24 hours', async ({ page, context, settings, deleteGuard }) => {
        await prepareThisDevice(context, settings);
        const at = Date.now() - 24 * HOUR_MS - MINUTE_MS;
        const queue = await seedQueue(context, deleteGuard, [
            { chatUuid: crypto.randomUUID(), lastActiveAt: at, observedAt: at, ownerDeviceId: crypto.randomUUID() },
            { chatUuid: crypto.randomUUID(), lastActiveAt: at, observedAt: at },
        ]);

        await expectDeletedOnceAndDequeued(page, context, deleteGuard, queue.map(({ chatUuid }) => chatUuid));
    });

    test('an entry owned by another device whose lease was explicitly released is deleted at once', async ({ page, context, settings, deleteGuard }) => {
        await prepareThisDevice(context, settings);
        const [released] = await seedQueue(context, deleteGuard, [{ chatUuid: crypto.randomUUID(), lastActiveAt: 0, ownerDeviceId: crypto.randomUUID() }]);

        await expectDeletedOnceAndDequeued(page, context, deleteGuard, [released.chatUuid]);
    });

    test('an expired entry created on this device is kept and its lease renewed while a tab on this device shows the conversation', async ({ page, context, settings, deleteGuard, deepseekReplay }) => {
        const ownDeviceId = await prepareThisDevice(context, settings);
        const shown = crypto.randomUUID();
        // 這個分頁顯示 `shown`（以錄製中一個對話的訊息提供頁面與 history_messages）；清除流程開始前它已在分頁上。
        await deepseekReplay.serveConversationAs(page, shown, 'withSearch');
        await openConversation(page, shown);

        const at = Date.now() - 11 * MINUTE_MS;
        const marker = releasedMarker(ownDeviceId);
        const [open] = await seedQueue(context, deleteGuard, [{ chatUuid: shown, lastActiveAt: at, observedAt: at, ownerDeviceId: ownDeviceId }, marker]);

        const entry = await expectKeptAfterCleanupRun(page, context, deleteGuard, marker, open, 'a tab still shows the conversation');
        expect(entry.lastActiveAt, `the lease is renewed past the seeded ${at}`).toBeGreaterThan(at);
    });
});
