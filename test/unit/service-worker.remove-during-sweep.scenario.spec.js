/**
 * Scenario: REMOVE_PENDING_DELETE for chat X lands while a remediation sweep is in flight.
 *
 * Real modules sharing one in-memory chrome.storage (deep-copy get/set): background/service-worker.js (sweep driven by its retry alarm), background/pending-store.js, and background/pending-store-routes.js (the removal arrives through its real chrome.runtime.onMessage listener). Mocked trust boundaries only: chrome.storage, chrome.alarms, chrome.tabs, chrome.runtime.onMessage registration, fetch. Bootstrap: test/helpers/service-worker-harness.js.
 *
 * Requirement (user rule: a conversation that should not be deleted must not be deleted): once REMOVE_PENDING_DELETE for X has completed (the route answered), no delete request for X is issued afterwards, including by a sweep that read the queue before the removal.
 *
 * Window: the queue holds Y ahead of X, both lease-expired with no open tab and a token available, so the sweep would delete both. R1 keeps X's lease unreleased (expired by TTL); R2 first releases X's lease through the RELEASE_LEASE route (lastActiveAt 0, the state a closed tab leaves). The delete fetch for Y is held open; while it is held, X is removed through the route; then Y's fetch is released and the sweep finishes. Observations: the delete requests captured at the fetch boundary, each tagged by whether the route had already answered, and the stored queue.
 */
import { RETRY_ALARM_NAME, NOW, store, setClock, settle, readQueue, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect, beforeAll, vi } from 'vitest';

installServiceWorkerHarness();

const LEASE_TTL_MS = globalThis.DSS_TEMP_CHAT.LEASE_TTL_MS;
const REMOVE_PENDING_DELETE = globalThis.DSS_TEMP_CHAT.DSS_MSG_REMOVE_PENDING_DELETE;
const RELEASE_LEASE = globalThis.DSS_TEMP_CHAT.DSS_MSG_RELEASE_LEASE;

const T0 = NOW;
const T1 = T0 + LEASE_TTL_MS + 1; // every entry first observed at T0 is expired at T1

const Y = 'aaaa-0001'; // ahead of X in the queue; its delete fetch is the gate
const X = 'bbbb-0002'; // removed from the queue while the sweep is in flight

let routeListener;

// Registered after the harness hooks, so the service worker is already loaded (with its stubbed route installers); this installs the REAL pending-store routes and captures their listener.
beforeAll(async () => {
    const captured = [];
    const addSpy = vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((fn) => { captured.push(fn); });
    try {
        await import('../../background/pending-store-routes.js');
        globalThis.DSSPendingStoreRoutes.install();
    } finally {
        addSpy.mockRestore();
    }
    routeListener = captured[0];
});

/** Sends one message through the real route listener; resolves with the route's response. */
function sendToRoute(message) {
    return new Promise((resolve) => {
        const isAsync = routeListener(message, { id: 'test-extension-id' }, resolve);
        if (isAsync !== true) resolve({ notHandled: true });
    });
}

function uuidOf(init) {
    return JSON.parse(init.body).chat_session_id;
}

async function ageQueueToExpiry() {
    setClock(T0);
    chrome.tabs.query.mockResolvedValue([]);
    chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
    await settle();
    setClock(T1);
}

async function seedYThenXExpired() {
    await store.addPendingDelete(Y);
    await store.addPendingDelete(X);
    await ageQueueToExpiry();
    const order = (await readQueue()).map((e) => e.chatUuid);
    expect(order, 'precondition: Y is queued ahead of X').toEqual([Y, X]);
    expect(globalThis.fetch, 'precondition: the aging sweep deleted nothing').not.toHaveBeenCalled();
}

// Holds the sweep on Y's delete fetch, removes X through the real route while it is held, releases Y, then checks the fetch boundary and the stored queue.
async function expectNoDeleteOfXAfterMidSweepRemoval() {
    // Delete requests observed at the fetch boundary, tagged with whether the removal route had already answered.
    const requests = [];
    let hasRemovalAnswered = false;
    let releaseY;
    let markYReached;
    const yReached = new Promise((r) => { markYReached = r; });
    globalThis.fetch.mockImplementation((_url, init) => {
        const uuid = uuidOf(init);
        requests.push({ uuid, isAfterRemoval: hasRemovalAnswered });
        if (uuid === Y) {
            markYReached();
            return new Promise((r) => { releaseY = () => r({ ok: true }); });
        }
        return Promise.resolve({ ok: true });
    });

    chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
    await yReached; // the sweep has read the queue (Y and X) and is waiting on Y's delete

    let removeResponse;
    sendToRoute({ type: REMOVE_PENDING_DELETE, uuid: X }).then((res) => {
        hasRemovalAnswered = true;
        removeResponse = res;
    });
    await settle(20);
    expect(removeResponse, 'precondition: the removal route answers while the sweep still waits on Y').toEqual({ ok: true });
    expect((await readQueue()).map((e) => e.chatUuid), 'precondition: X is no longer queued after the removal').not.toContain(X);

    releaseY();
    await settle();

    expect(requests.map((r) => r.uuid), 'precondition: the sweep deleted Y').toContain(Y);
    const xAfterRemoval = requests.filter((r) => r.uuid === X && r.isAfterRemoval);
    expect(xAfterRemoval, 'X was removed from the pending-delete queue (route answered ok) before the sweep reached it, so no delete request for X may be issued afterwards').toEqual([]);
    expect((await readQueue()).map((e) => e.chatUuid), 'X stays out of the queue after the sweep').not.toContain(X);
}

describe('removal while a sweep is in flight', () => {
    it('control: without a removal, the same sweep deletes both Y and X', async () => {
        await seedYThenXExpired();

        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await settle();

        const fetched = globalThis.fetch.mock.calls.map((c) => uuidOf(c[1]));
        expect(fetched, 'both expired entries with no open tab are deleted').toEqual(expect.arrayContaining([Y, X]));
    });

    it('R1: X with an unreleased lease expired by TTL: once REMOVE_PENDING_DELETE for X has answered, the in-flight sweep issues no delete request for X', async () => {
        await seedYThenXExpired();
        await expectNoDeleteOfXAfterMidSweepRemoval();
    });

    it('R2: X whose lease was released (tab closed): once REMOVE_PENDING_DELETE for X has answered, the in-flight sweep issues no delete request for X', async () => {
        await seedYThenXExpired();
        expect(await sendToRoute({ type: RELEASE_LEASE, uuid: X }), 'precondition: the release route answers ok').toEqual({ ok: true });
        expect((await readQueue()).find((e) => e.chatUuid === X).lastActiveAt, 'precondition: X lease released').toBe(0);
        await expectNoDeleteOfXAfterMidSweepRemoval();
    });
});
