/**
 * background/service-worker.js — owner-device gating of the cross-device pending-delete queue, asserted on end state (sync queue contents, delete fetches sent).
 *
 * Incident: device A had a temporary chat open but its tab was frozen, so heartbeats stopped; after LEASE_TTL_MS device B (same account, no local tab) deleted it while the user was still on A. Decision: each entry records the device that created it. The owner keeps the LEASE_TTL_MS + local tab guard rule; any other device deletes only an explicitly released entry (lastActiveAt === 0) or one stale for FOREIGN_LEASE_TTL_MS (24 h). Entries without an owner (pre-change) are foreign on every device.
 *
 * Two devices are simulated by giving each its own chrome.storage.local area (the device ID lives there, never in sync) while both share the one chrome.storage.sync area. Real background/pending-store.js and real background/service-worker.js via test/helpers/service-worker-harness.js; only chrome.* and fetch are mocked. Contract this relies on: the local device ID is read from chrome.storage.local when an entry is added and when a sweep runs.
 */
import { RETRY_ALARM_NAME, SYNC_KEY, TOKEN_KEY, NOW, store, clock, setClock, settle, seedQueue, readQueue, fetchedUuids, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import InMemoryStorageMock from '../fixtures/chrome-storage-mock.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

installServiceWorkerHarness();

const LEASE_TTL_MS = globalThis.DSS_TEMP_CHAT.LEASE_TTL_MS;
const FOREIGN_LEASE_TTL_MS = 24 * 60 * 60 * 1000;
const DEVICE_ID_KEY = globalThis.DSS_TEMP_CHAT.DSS_DEVICE_ID_KEY;
const MINUTE = 60 * 1000;
const tabFor = (uuid) => ({ id: 1, url: 'https://chat.deepseek.com/a/chat/s/' + uuid });

const sharedLocal = chrome.storage.local;
let deviceLocal;

async function makeDevice(deviceId) {
    const area = new InMemoryStorageMock('local');
    const seed = { [TOKEN_KEY]: 'Bearer tok' };
    if (deviceId) seed[DEVICE_ID_KEY] = deviceId;
    await area.set(seed);
    return area;
}
function onDevice(name) {
    chrome.storage.local = deviceLocal[name];
}
async function sweep() {
    chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
    await settle();
}

beforeEach(async () => {
    deviceLocal = { A: await makeDevice('device-A'), B: await makeDevice('device-B') };
});
afterEach(() => {
    chrome.storage.local = sharedLocal;
});

describe('entries record the device that created them', () => {
    it('OD-0: an entry added on device A carries ownerDeviceId "device-A"', async () => {
        onDevice('A');
        await store.addPendingDelete('aaa-111');

        expect(await readQueue()).toEqual([{ chatUuid: 'aaa-111', attemptCount: 0, lastActiveAt: NOW, ownerDeviceId: 'device-A' }]);
    });
});

describe('foreign device (B) sweeping an entry owned by A', () => {
    it('OD-1: stale past LEASE_TTL_MS but under 24 h, no local tab on B -> not deleted, entry unchanged', async () => {
        onDevice('A');
        await store.addPendingDelete('aaa-111');
        const before = await readQueue();
        onDevice('B');
        await sweep();

        setClock(NOW + LEASE_TTL_MS + 1);
        await sweep();
        expect(fetchedUuids(), 'B must not delete a chat owned by A 10 min after its last heartbeat').toEqual([]);
        expect(await readQueue()).toEqual(before);

        setClock(NOW + FOREIGN_LEASE_TTL_MS - MINUTE);
        await sweep();
        expect(fetchedUuids(), 'still inside the 24 h foreign TTL').toEqual([]);
        expect(await readQueue()).toEqual(before);
    });

    it('OD-2: stale past 24 h, no local tab on B -> deleted', async () => {
        onDevice('A');
        await store.addPendingDelete('aaa-111');
        onDevice('B');
        await sweep();

        setClock(NOW + FOREIGN_LEASE_TTL_MS + 1);
        await sweep();

        expect(fetchedUuids()).toEqual(['aaa-111']);
        expect(await readQueue()).toEqual([]);
    });

    it('OD-3: lease explicitly released on A (lastActiveAt 0) -> B deletes on its first sweep', async () => {
        onDevice('A');
        await store.addPendingDelete('aaa-111');
        await store.releaseLease('aaa-111');
        onDevice('B');

        await sweep();

        expect(fetchedUuids()).toEqual(['aaa-111']);
        expect(await readQueue()).toEqual([]);
    });
});

describe('owner device (A) sweeping its own entry keeps the 10-minute rule', () => {
    it('OD-4a: stale past LEASE_TTL_MS, no local tab -> deleted', async () => {
        onDevice('A');
        await store.addPendingDelete('aaa-111');
        await sweep();

        setClock(NOW + LEASE_TTL_MS + 1);
        await sweep();

        expect(fetchedUuids()).toEqual(['aaa-111']);
        expect(await readQueue()).toEqual([]);
    });

    it('OD-4b: stale past LEASE_TTL_MS with a local tab on the chat -> kept and lease refreshed', async () => {
        onDevice('A');
        await store.addPendingDelete('aaa-111');
        await sweep();
        chrome.tabs.query.mockResolvedValue([tabFor('aaa-111')]);

        setClock(NOW + LEASE_TTL_MS + 1);
        await sweep();

        expect(fetchedUuids()).toEqual([]);
        const queue = await readQueue();
        expect(queue).toHaveLength(1);
        expect(queue[0]).toMatchObject({ chatUuid: 'aaa-111', attemptCount: 0, lastActiveAt: clock });
    });
});

describe('legacy entries without an owner are foreign on every device', () => {
    describe.each(['A', 'B'])('sweep on device %s', (device) => {
        it('OD-6a: stale past LEASE_TTL_MS but under 24 h -> not deleted, entry unchanged', async () => {
            const legacy = { chatUuid: 'legacy-1', attemptCount: 0, lastActiveAt: NOW };
            await seedQueue([legacy]);
            onDevice(device);
            await sweep();

            setClock(NOW + LEASE_TTL_MS + 1);
            await sweep();

            expect(fetchedUuids()).toEqual([]);
            expect(await readQueue()).toEqual([legacy]);
        });

        it('OD-6b: stale past 24 h -> deleted', async () => {
            await seedQueue([{ chatUuid: 'legacy-1', attemptCount: 0, lastActiveAt: NOW }]);
            onDevice(device);
            await sweep();

            setClock(NOW + FOREIGN_LEASE_TTL_MS + 1);
            await sweep();

            expect(fetchedUuids()).toEqual(['legacy-1']);
            expect(await readQueue()).toEqual([]);
        });

        it('OD-6c: explicitly released (lastActiveAt 0) -> deleted on the first sweep', async () => {
            await seedQueue([{ chatUuid: 'legacy-1', attemptCount: 0, lastActiveAt: 0 }]);
            onDevice(device);

            await sweep();

            expect(fetchedUuids()).toEqual(['legacy-1']);
            expect(await readQueue()).toEqual([]);
        });
    });
});

// Must stay last: each restart loads another service-worker instance whose listeners stay registered for the rest of this file.
describe('device ID lifecycle', () => {
    let restarts = 0;
    async function restartServiceWorker() {
        restarts += 1;
        const previous = globalThis.TemporaryChatPendingStore;
        const addListener = chrome.storage.onChanged.addListener;
        chrome.storage.onChanged.addListener = vi.fn();
        try {
            await import('../../background/pending-store.js?restart=' + restarts);
            await import('../../background/service-worker.js?restart=' + restarts);
        } finally {
            chrome.storage.onChanged.addListener = addListener;
        }
        await settle();
        expect(globalThis.TemporaryChatPendingStore, 'precondition: restart loaded a fresh pending-store instance').not.toBe(previous);
        return globalThis.TemporaryChatPendingStore;
    }

    it('OD-5: created once in storage.local, stable across service-worker restarts, never written to storage.sync', async () => {
        deviceLocal.fresh = await makeDevice(null);
        onDevice('fresh');

        const firstStore = await restartServiceWorker();
        expect(DEVICE_ID_KEY, 'DSS_TEMP_CHAT.DSS_DEVICE_ID_KEY constant').toEqual(expect.any(String));
        await firstStore.addPendingDelete('aaa-111');
        const firstId = (await chrome.storage.local.get(DEVICE_ID_KEY))[DEVICE_ID_KEY];
        expect(firstId, 'device ID generated into storage.local').toEqual(expect.any(String));
        expect(firstId.length).toBeGreaterThan(0);

        const secondStore = await restartServiceWorker();
        await secondStore.addPendingDelete('bbb-222');
        const secondId = (await chrome.storage.local.get(DEVICE_ID_KEY))[DEVICE_ID_KEY];

        expect(secondId, 'same device ID after restart').toBe(firstId);
        expect((await readQueue()).map((e) => e.ownerDeviceId)).toEqual([firstId, firstId]);
        expect(Object.keys(await chrome.storage.sync.get(null))).toEqual([SYNC_KEY]);
    });
});
