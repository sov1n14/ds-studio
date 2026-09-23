/**
 * background/service-worker.js — lease-gated deletion on every scan path (onStartup, retry alarm, sync storage.onChanged), asserted on end state.
 *
 * Real background/pending-store.js and real background/service-worker.js share the in-memory chrome.storage fixture (deep-copy get/set). Mocked trust boundaries only: chrome.storage.onChanged registration (SW listener captured, so seeding never starts a sweep), chrome.tabs, chrome.alarms (Map-backed), fetch. StorageManager and the route installers are stubbed because they are off the sweep path.
 *
 * TTL expiry is produced the way it happens in production: a first sweep records the local observation of an entry's lastActiveAt, then the clock moves past LEASE_TTL_MS with lastActiveAt unchanged.
 */
import { RETRY_ALARM_NAME, NOW, store, alarms, syncQueueWrites, clock, setClock, expired, fresh, settle, seedQueue, readQueue, fetchedUuids, fireSyncChange, readLocalDeviceId, FOREIGN_LEASE_TTL_MS, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect } from 'vitest';

installServiceWorkerHarness();

const LEASE_TTL_MS = globalThis.DSS_TEMP_CHAT.LEASE_TTL_MS;

const TRIGGERS = {
    onStartup: () => chrome.runtime.onStartup.callListeners(),
    'retry alarm': () => chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME }),
    'sync storage.onChanged': () => fireSyncChange(),
};

async function observeSweep() {
    chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
    await settle();
}

describe('lease gating replaces the open-UUID exclude list on every scan path', () => {
    describe.each(Object.entries(TRIGGERS))('%s', (_name, trigger) => {
        it('deletes only the TTL-expired entry and retains the fresh-lease entry unchanged', async () => {
            await store.addPendingDelete('expired-uuid');
            await observeSweep();
            setClock(NOW + LEASE_TTL_MS + 1);
            await store.addPendingDelete('fresh-uuid');

            trigger();
            await settle();

            expect(fetchedUuids()).toEqual(['expired-uuid']);
            const ownerDeviceId = await readLocalDeviceId();
            expect(ownerDeviceId, 'precondition: local device ID exists').toEqual(expect.any(String));
            expect(await readQueue()).toEqual([{ chatUuid: 'fresh-uuid', attemptCount: 0, lastActiveAt: clock, ownerDeviceId }]);
        });
    });
});

describe('lease boundary conditions', () => {
    it('an entry observed exactly LEASE_TTL_MS ago is NOT deleted; one observed 1 ms earlier is', async () => {
        setClock(NOW - 1);
        await store.addPendingDelete('expired-uuid');
        await observeSweep();
        setClock(NOW);
        await store.addPendingDelete('boundary-uuid');
        await observeSweep();
        setClock(NOW + LEASE_TTL_MS);

        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(fetchedUuids()).toEqual(['expired-uuid']);
        const ownerDeviceId = await readLocalDeviceId();
        expect(ownerDeviceId, 'precondition: local device ID exists').toEqual(expect.any(String));
        expect(await readQueue()).toEqual([{ chatUuid: 'boundary-uuid', attemptCount: 0, lastActiveAt: NOW, ownerDeviceId }]);
    });

    it('a legacy entry with no lastActiveAt and no ownerDeviceId is not protected forever: kept past LEASE_TTL_MS, deleted once FOREIGN_LEASE_TTL_MS has passed', async () => {
        await seedQueue([{ chatUuid: 'no-lease-uuid', attemptCount: 0 }]);
        await observeSweep();

        setClock(NOW + LEASE_TTL_MS + 1);
        chrome.runtime.onStartup.callListeners();
        await settle();
        expect(fetchedUuids(), 'ownerless entry is foreign: the 10 min own-device TTL does not apply').toEqual([]);
        expect((await readQueue()).map((e) => e.chatUuid)).toEqual(['no-lease-uuid']);

        setClock(NOW + FOREIGN_LEASE_TTL_MS + 1);
        await store.addPendingDelete('fresh-uuid');
        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(fetchedUuids()).toEqual(['no-lease-uuid']);
        expect((await readQueue()).map((e) => e.chatUuid)).toEqual(['fresh-uuid']);
    });
});

describe('onStartup fast-restart recovery', () => {
    it('a fresh-lease entry left open locally by the previous session is deleted; a fresh entry not open locally is kept', async () => {
        await seedQueue([fresh('A'), fresh('B')]);
        await store.addOpenUuid('A');

        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(fetchedUuids()).toEqual(['A']);
        expect(await readQueue()).toEqual([fresh('B')]);
    });
});

describe('device-local open set no longer gates the alarm and sync paths', () => {
    describe.each(Object.entries({ 'retry alarm': TRIGGERS['retry alarm'], 'sync storage.onChanged': TRIGGERS['sync storage.onChanged'] }))('%s', (_name, trigger) => {
        it('never deletes a fresh-lease entry absent from the local open set, and writes nothing back', async () => {
            await seedQueue([fresh('fresh-uuid')]);
            syncQueueWrites.length = 0;

            trigger();
            await settle();

            expect(fetchedUuids()).toEqual([]);
            expect(syncQueueWrites).toEqual([]);
            expect(await readQueue()).toEqual([fresh('fresh-uuid')]);
        });
    });
});

describe('preserved remediation behaviour under lease gating', () => {
    it('consecutive failed deletes increment the persisted attemptCount (0 -> 1 -> 2) and never drop the entry', async () => {
        await seedQueue([expired('retry-uuid')]);
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await settle();
        expect(await readQueue()).toEqual([{ chatUuid: 'retry-uuid', attemptCount: 1, lastActiveAt: 0 }]);

        chrome.runtime.onStartup.callListeners();
        await settle();
        expect(await readQueue()).toEqual([{ chatUuid: 'retry-uuid', attemptCount: 2, lastActiveAt: 0 }]);
    });
});
