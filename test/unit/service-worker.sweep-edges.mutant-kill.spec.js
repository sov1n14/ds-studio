/**
 * background/service-worker.js - edge inputs of the remediation sweep and of the closing pending-queue broadcast.
 *
 * Requirements (docs/spec/04-features.md §21 "Cross-Device Leases and Heartbeats", docs/FEATURES.md "Tab guard"; docs/ARCHITECTURE.md Layer 2):
 *   A. Tab guard: the sweep keeps an expired conversation and renews its lease only when a chat.deepseek.com tab shows it (path /a/chat/s/<uuid>). A tab on another site with the same path does not protect it, and another DeepSeek tab that shows no conversation (the home page) does not stop the guard from seeing the tab that does.
 *   B. Observation records: a confirmed delete removes the conversation's dss-last-seen-change:<uuid> key even when the closing orphan sweep cannot read chrome.storage.local; that failure is logged with console.error under a [DSS] prefix naming the sweep, with the error, and escapes nowhere.
 *   C. Closing broadcast (docs/spec/04-features.md "Single In-Flight Sweep"): every queued job ends by sending the queue snapshot to every tab. A failed tab query is logged with console.error under a [DSS] broadcastPendingUuids prefix, with the error; a query that yields no tab list (no tabs API) counts as no tab and logs nothing; a tab without a numeric id is skipped, and the broadcast still reaches the tabs after it (Chrome rejects tabs.sendMessage with a non-integer tab id synchronously).
 *
 * Harness: test/helpers/unload-grace-harness.js boots the REAL service worker in a fresh vm context inside each test body; only trust boundaries are faked (chrome.*, fetch, console, worker timers). chrome.tabs.query filters the tab table as Chrome does.
 */
import { describe, it, expect, vi } from 'vitest';
import { createWorld, relayToken, settle, setTabs, tab, ORIGIN, chatUrl, temp, queueEntry, deleteRequestsFor, queueFromAnotherDevice, pendingBroadcasts, fireRetryAlarm } from '../helpers/unload-grace-harness.js';

const TOKEN = 'Bearer sweep-edges-token';
const U = '9d4b2f6e-1a3c-4e5d-8b7f-6c5d4e3f2a1b'; // 另一台裝置寫入、lease 已釋放（立即到期）的臨時對話
const NO_SIGNATURE = 'Error in invocation of tabs.sendMessage(integer tabId, any message, optional object options, optional function callback): No matching signature.';

/** 開著 tabs 的設定檔：token 已存；另一台裝置把 lease 已釋放的 U 寫進待刪佇列，觸發同步變更掃描並跑完。 */
async function sweepReleasedU(tabs, beforeQueue = () => {}) {
    const world = createWorld();
    setTabs(world, tabs);
    await relayToken(world, TOKEN);
    await settle(world);
    beforeQueue(world);
    await queueFromAnotherDevice(world, U);
    await settle(world, 60);
    return world;
}

/** token 已存、佇列為空的設定檔；mutate 改寫信任邊界後觸發重試 alarm 掃描（含結尾廣播）並跑完。 */
async function retrySweepAfter(mutate) {
    const world = createWorld();
    setTabs(world, [tab(1, ORIGIN + '/')]);
    await relayToken(world, TOKEN);
    await settle(world);
    mutate(world);
    fireRetryAlarm(world);
    await settle(world, 60);
    return world;
}

const errorCallsWith = (world, err) => world.console.error.mock.calls.filter((args) => args.includes(err));

describe('A - tab guard counts only chat.deepseek.com tabs that show the conversation', () => {
    it('a tab on another site whose path is /a/chat/s/<uuid> does not protect it: the sweep deletes the expired conversation', async () => {
        const world = await sweepReleasedU([tab(1, 'https://mirror.example.net/a/chat/s/' + U)]);
        expect(deleteRequestsFor(world, U), 'delete requests for the expired conversation').toHaveLength(1);
        expect(await queueEntry(world, U), 'the deleted conversation leaves the queue').toBeUndefined();
    });

    it('a DeepSeek home tab listed before the tab showing the conversation: the guard still keeps it and renews its lease', async () => {
        const world = await sweepReleasedU([tab(1, ORIGIN + '/'), tab(2, chatUrl(U))]);
        expect(deleteRequestsFor(world, U), 'a conversation shown in a DeepSeek tab is never deleted').toEqual([]);
        expect((await queueEntry(world, U))?.lastActiveAt, 'the guard renews the released lease (lastActiveAt above 0)').toBeGreaterThan(0);
    });
});

describe('B - a confirmed delete clears its observation record even when the orphan sweep fails', () => {
    it('chrome.storage.local.get(null) rejects: dss-last-seen-change:<uuid> is gone after the delete and the failure is logged under [DSS]', async () => {
        const failure = new Error('local read of all keys failed');
        const recordedKeys = [];
        let fullReads = 0;
        const world = await sweepReleasedU([], (w) => {
            const prefix = temp(w).DSS_LAST_SEEN_CHANGE_KEY_PREFIX;
            w.chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local') Object.keys(changes).filter((k) => k.startsWith(prefix) && changes[k].newValue !== undefined).forEach((k) => recordedKeys.push(k));
            });
            const local = w.chrome.storage.local;
            const realGet = local.get.bind(local);
            local.get = (keys, ...rest) => {
                if (keys !== null) return realGet(keys, ...rest);
                fullReads += 1;
                return Promise.reject(failure);
            };
        });
        const seenKey = temp(world).DSS_LAST_SEEN_CHANGE_KEY_PREFIX + U;

        expect(recordedKeys, 'precondition: the sweep recorded an observation for U').toContain(seenKey);
        expect(deleteRequestsFor(world, U), 'precondition: the sweep deleted U').toHaveLength(1);
        expect(fullReads, 'precondition: the orphan sweep read all local keys and that read failed').toBeGreaterThan(0);
        expect(await world.chrome.storage.local.get(seenKey), 'the observation record of the deleted conversation').toEqual({});
        const logged = errorCallsWith(world, failure);
        expect(logged, 'console.error calls carrying the read failure').toHaveLength(1);
        expect(logged[0][0], 'the log line names the sweep under the [DSS] prefix').toMatch(/^\[DSS\] .*sweep/);
    });
});

describe('C - the closing broadcast tolerates a failed or empty tab query and tabs without an id', () => {
    it('chrome.tabs.query({}) rejects: the failure is logged under the [DSS] broadcastPendingUuids prefix with the error', async () => {
        const failure = new Error('tabs query failed');
        let unfilteredQueries = 0;
        const world = await retrySweepAfter((w) => {
            const realQuery = w.chrome.tabs.query.getMockImplementation();
            w.chrome.tabs.query = vi.fn(async (info) => {
                if (info && Object.keys(info).length === 0) { unfilteredQueries += 1; throw failure; }
                return realQuery(info);
            });
        });
        expect(unfilteredQueries, 'precondition: the closing broadcast queried all tabs').toBeGreaterThan(0);
        const logged = errorCallsWith(world, failure);
        expect(logged, 'console.error calls carrying the query failure').toHaveLength(1);
        expect(logged[0][0]).toMatch(/^\[DSS\] broadcastPendingUuids/);
    });

    it('chrome.tabs.query({}) resolves undefined: the broadcast counts no tab and nothing is logged', async () => {
        let unfilteredQueries = 0;
        const world = await retrySweepAfter((w) => {
            const realQuery = w.chrome.tabs.query.getMockImplementation();
            w.chrome.tabs.query = vi.fn(async (info) => {
                if (info && Object.keys(info).length === 0) { unfilteredQueries += 1; return undefined; }
                return realQuery(info);
            });
        });
        expect(unfilteredQueries, 'precondition: the closing broadcast queried all tabs').toBeGreaterThan(0);
        expect(world.console.error.mock.calls, 'console.error calls').toEqual([]);
    });

    it('a tab without a numeric id listed first: the broadcast skips it and still reaches the DeepSeek tab after it', async () => {
        const world = await retrySweepAfter((w) => {
            setTabs(w, [{ windowId: 1, active: false, url: ORIGIN + '/' }, tab(5, ORIGIN + '/')]);
            w.chrome.tabs.sendMessage = vi.fn((tabId) => {
                if (!Number.isInteger(tabId)) throw new TypeError(NO_SIGNATURE);
                return Promise.resolve(undefined);
            });
        });
        expect(pendingBroadcasts(world).map((b) => b.tabId), 'tabs that received the closing broadcast').toEqual([5]);
    });
});
