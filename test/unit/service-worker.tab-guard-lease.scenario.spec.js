/**
 * Scenario: service-worker remediation sweep + real TemporaryChatPendingStore sharing one real (in-memory) chrome.storage.
 *
 * Bootstrap: test/helpers/service-worker-harness.js (real pending store, real service worker, in-memory chrome.storage fixture that structured-clones on get and set, so stale-snapshot writes are observable). The harness captures the service worker's chrome.storage.onChanged listener instead of wiring it, so each test drives exactly one sweep (via the retry alarm) and the end state is not a product of follow-up sweeps triggered by writes made during the sweep.
 *
 * Requirements under test:
 *  1. A tab-guarded expired entry ends the sweep with a refreshed lastActiveAt.
 *  2. An entry added through the store while a sweep is in flight survives it.
 *  3. A heartbeat refreshLease landing mid-sweep is not overwritten.
 *  4. Guards: expired + no tab -> deleted; non-expired -> untouched.
 */
import { RETRY_ALARM_NAME, DEVICE_ID_KEY, NOW, store, setClock, settle, readQueue, fetchedUuids, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect } from 'vitest';

installServiceWorkerHarness();

const LEASE_TTL_MS = globalThis.DSS_TEMP_CHAT.LEASE_TTL_MS;
const HEARTBEAT_INTERVAL_MS = globalThis.DSS_TEMP_CHAT.HEARTBEAT_INTERVAL_MS;

const T0 = NOW;
const T1 = T0 + LEASE_TTL_MS + 1; // every entry first observed at T0 is expired at T1

const U = 'aaaa-0001'; // expired, open in a tab
const X = 'bbbb-0002'; // expired, no tab -> deleted
const V = 'cccc-0003'; // added mid-sweep
const W = 'dddd-0004'; // heartbeat-refreshed mid-sweep
const N = 'eeee-0005'; // non-expired

async function entry(uuid) {
    return (await readQueue()).find((e) => e.chatUuid === uuid);
}

function tabFor(uuid) {
    return { id: 1, url: 'https://chat.deepseek.com/a/chat/s/' + uuid };
}

async function runSweep() {
    chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
    await settle();
}

// Sweep at T0 so the SW records a first observation of every queued entry, then move the clock to T1 where those entries are past the lease TTL.
async function ageQueueToExpiry() {
    setClock(T0);
    chrome.tabs.query.mockResolvedValue([]);
    await runSweep();
    setClock(T1);
}

// Makes the next tabs.query hang until release() is called; "reached" resolves once the sweep is blocked on it (i.e. after the sweep has read the queue).
function deferTabsQuery(tabs) {
    let release;
    let markReached;
    const reached = new Promise((r) => { markReached = r; });
    chrome.tabs.query.mockImplementationOnce(() => {
        markReached();
        return new Promise((r) => { release = () => r(tabs); });
    });
    return { reached, release: () => release() };
}

describe('tab-guard lease refresh persists through the sweep', () => {
    it('S1: expired entry open in a tab ends the sweep with lastActiveAt = now and is not deleted', async () => {
        await store.addPendingDelete(U);
        await ageQueueToExpiry();
        expect((await entry(U)).lastActiveAt, 'precondition: stale lastActiveAt').toBe(T0);

        chrome.tabs.query.mockResolvedValue([tabFor(U)]);
        await runSweep();

        expect(fetchedUuids(), 'tab-guarded entry must not be deleted').not.toContain(U);
        const persisted = await entry(U);
        expect(persisted, 'tab-guarded entry must stay queued').toBeDefined();
        expect(persisted.lastActiveAt, 'lease refresh must survive the sweep save').toBe(T1);
    });
});

describe('sweep save does not clobber concurrent store writes', () => {
    it('S2: entry added via addPendingDelete while the sweep is in flight is still queued afterwards', async () => {
        await store.addPendingDelete(X);
        await ageQueueToExpiry();

        const gate = deferTabsQuery([]);
        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await gate.reached;
        const addDone = store.addPendingDelete(V);
        await settle(20);
        gate.release();
        await settle();
        await addDone;

        expect(fetchedUuids(), 'expired X is deleted by the sweep').toContain(X);
        const uuids = (await readQueue()).map((e) => e.chatUuid);
        expect(uuids, 'V added mid-sweep must survive the sweep').toContain(V);
        expect(uuids).not.toContain(X);
    });

    it('S3: heartbeat refreshLease for W landing mid-sweep is not overwritten by the sweep save', async () => {
        await store.addPendingDelete(X);
        await ageQueueToExpiry();
        // W enters the queue old enough for a heartbeat to write, but is first observed by the next sweep, so it is not lease-expired there.
        setClock(T1 - HEARTBEAT_INTERVAL_MS - 1);
        await store.addPendingDelete(W);
        setClock(T1);

        const gate = deferTabsQuery([]);
        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await gate.reached;
        const refreshDone = store.refreshLease(W);
        await settle(20);
        gate.release();
        await settle();
        await refreshDone;

        expect(fetchedUuids(), 'non-expired W must not be deleted').not.toContain(W);
        const persisted = await entry(W);
        expect(persisted, 'W stays queued').toBeDefined();
        expect(persisted.lastActiveAt, 'heartbeat refresh must survive the sweep save').toBe(T1);
    });
});

describe('guards', () => {
    it('G1: expired entry with no open tab is deleted and removed from the queue', async () => {
        await store.addPendingDelete(X);
        await ageQueueToExpiry();

        chrome.tabs.query.mockResolvedValue([]);
        await runSweep();

        expect(fetchedUuids()).toContain(X);
        expect(await entry(X)).toBeUndefined();
    });

    it('G2: non-expired entry is not deleted and keeps its lastActiveAt', async () => {
        await store.addPendingDelete(X);
        await ageQueueToExpiry();
        await store.addPendingDelete(N); // added at T1, first observed at T1

        chrome.tabs.query.mockResolvedValue([]);
        await runSweep();

        expect(fetchedUuids()).not.toContain(N);
        const ownerDeviceId = (await chrome.storage.local.get(DEVICE_ID_KEY))[DEVICE_ID_KEY];
        expect(ownerDeviceId, 'precondition: local device ID exists').toEqual(expect.any(String));
        expect(await entry(N)).toEqual({ chatUuid: N, attemptCount: 0, lastActiveAt: T1, ownerDeviceId });
    });
});
