/**
 * background/service-worker.js — retry never drops, exponential backoff from the incremented attempt count, periodic alarm, lastActiveAt preserved on failure.
 *
 * Real background/pending-store.js and real background/service-worker.js share the in-memory chrome.storage fixture (deep-copy get/set). Mocked trust boundaries only: chrome.storage.onChanged registration (SW listener captured, so seeding never starts a sweep), chrome.tabs, chrome.alarms (Map-backed, so the scheduled alarm is observable end state), fetch. StorageManager and the route installers are stubbed because they are off the sweep path.
 *
 * Expired lease = lastActiveAt 0 unless a test ages a nonzero lease past the TTL with two sweeps.
 */
import { RETRY_ALARM_NAME, NOW, alarms, setClock, expired, settle, seedQueue, readQueue, fetchedUuids, readLocalDeviceId, store, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect } from 'vitest';

installServiceWorkerHarness();

const LEASE_TTL_MS = globalThis.DSS_TEMP_CHAT.LEASE_TTL_MS;

async function failedSweepOn(entries) {
    await seedQueue(entries);
    globalThis.fetch.mockResolvedValue({ ok: false });
    chrome.runtime.onStartup.callListeners();
    await settle();
}

describe('never-drop: a failed delete keeps the entry regardless of attempt count', () => {
    it.each([[2, 3], [10, 11], [99, 100]])('attemptCount %i + fetch fail -> still queued with attemptCount %i', async (before, after) => {
        await failedSweepOn([expired('u1', before)]);

        expect(await readQueue()).toEqual([{ chatUuid: 'u1', attemptCount: after, lastActiveAt: 0 }]);
    });
});

describe('exponential backoff: retry alarm period follows the incremented attempt count', () => {
    it.each([
        ['attemptCount 1 -> 2 after failure -> 0.5 * 2^2 = 2 min', [1], 2],
        ['attemptCount 3 -> 4 after failure -> 0.5 * 2^4 = 8 min', [3], 8],
        ['attemptCount 6 -> 7 after failure -> capped at 30 min', [6], 30],
        ['multiple entries [5, 1] -> shortest backoff wins (2 min)', [5, 1], 2],
    ])('%s', async (_label, counts, minutes) => {
        await failedSweepOn(counts.map((n, i) => expired('u' + i, n)));

        expect(alarms.get(RETRY_ALARM_NAME)).toEqual({ periodInMinutes: minutes });
    });
});

describe('periodic alarm', () => {
    it('the retry alarm is periodic (periodInMinutes), never a one-shot delayInMinutes', async () => {
        await failedSweepOn([expired('u1')]);

        const info = alarms.get(RETRY_ALARM_NAME);
        expect(info).toHaveProperty('periodInMinutes');
        expect(info).not.toHaveProperty('delayInMinutes');
    });

    it('a sweep that empties the queue leaves no retry alarm behind', async () => {
        alarms.set(RETRY_ALARM_NAME, { periodInMinutes: 0.5 });
        await seedQueue([expired('u1')]);

        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await settle();

        expect(await readQueue()).toEqual([]);
        expect(alarms.has(RETRY_ALARM_NAME)).toBe(false);
    });
});

describe('lastActiveAt preserved on failure', () => {
    it('a failed delete of a TTL-expired entry keeps its original nonzero lastActiveAt (not bumped to now)', async () => {
        // Created by this device, so the own-device LEASE_TTL_MS applies.
        const original = NOW - 5000;
        setClock(original);
        await store.addPendingDelete('u1');
        setClock(NOW);
        const ownerDeviceId = await readLocalDeviceId();
        expect(ownerDeviceId, 'precondition: local device ID exists').toEqual(expect.any(String));
        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME }); // first local observation at NOW
        await settle();
        expect(globalThis.fetch, 'precondition: not expired on first observation').not.toHaveBeenCalled();

        setClock(NOW + LEASE_TTL_MS + 1);
        globalThis.fetch.mockResolvedValue({ ok: false });
        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await settle();

        expect(fetchedUuids(), 'precondition: expired entry was attempted').toEqual(['u1']);
        expect(await readQueue()).toEqual([{ chatUuid: 'u1', attemptCount: 1, lastActiveAt: original, ownerDeviceId }]);
    });
});
