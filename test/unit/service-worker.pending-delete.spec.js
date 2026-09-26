/**
 * background/service-worker.js — pending-delete remediation, asserted on end state.
 *
 * Real background/pending-store.js and real background/service-worker.js share the in-memory chrome.storage fixture (deep-copy get/set, like real chrome.storage). Mocked trust boundaries only: chrome.storage.onChanged registration (the SW listener is captured instead of wired to the fixture, so seeding the queue never starts a sweep and each test drives exactly one sweep), chrome.tabs, chrome.alarms (backed by a Map so the scheduled alarm set is observable), fetch. StorageManager and the three route installers are stubbed because they are off the sweep path.
 *
 * Expired lease = lastActiveAt 0 (released, deletable at once). Fresh lease = lastActiveAt NOW with no prior local observation (the first observation starts the TTL clock).
 */
import { RETRY_ALARM_NAME, SCHEDULE_DELETE_RETRY, TOKEN_KEY, store, alarms, syncQueueWrites, expired, fresh, settle, seedQueue, readQueue, fetchedUuids, fireSyncChange, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect } from 'vitest';

installServiceWorkerHarness();

describe('onStartup — remediation', () => {
    it('[CAP-02] expired entry + token + fetch ok: delete sent with the stored token, queue emptied, open set cleared, retry alarm gone', async () => {
        await seedQueue([expired('u1')]);
        await store.addOpenUuid('other-open');

        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://chat.deepseek.com/api/v0/chat_session/delete',
            expect.objectContaining({
                headers: expect.objectContaining({ authorization: 'Bearer tok' }),
                body: JSON.stringify({ chat_session_id: 'u1' }),
            })
        );
        expect(await readQueue()).toEqual([]);
        expect(await store.getOpenUuids(), 'fresh session starts with no open uuids').toEqual([]);
        expect(alarms.has(RETRY_ALARM_NAME), 'empty queue leaves no retry alarm').toBe(false);
    });

    it('[known limitation] no local token: nothing is deleted and the queue is left exactly as it was', async () => {
        await chrome.storage.local.remove(TOKEN_KEY);
        await seedQueue([expired('u1')]);

        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(await readQueue()).toEqual([expired('u1')]);
    });

    it('[invariant] failed delete keeps the entry with attemptCount 1 and schedules the retry alarm at the attempt-1 backoff (1 min)', async () => {
        await seedQueue([expired('u1')]);
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(await readQueue()).toEqual([{ chatUuid: 'u1', attemptCount: 1, lastActiveAt: 0 }]);
        expect(alarms.get(RETRY_ALARM_NAME)).toEqual({ periodInMinutes: 1 });
    });

    it('never-drop: failed delete of an entry at attemptCount 2 leaves it queued at attemptCount 3', async () => {
        await seedQueue([expired('u1', 2)]);
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(await readQueue()).toEqual([{ chatUuid: 'u1', attemptCount: 3, lastActiveAt: 0 }]);
    });

    it('[idempotency] fetch ok for an entry already retried once removes it from the queue', async () => {
        await seedQueue([expired('u1', 1)]);

        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(await readQueue()).toEqual([]);
    });
});

describe('onMessage — DSS_SCHEDULE_DELETE_RETRY', () => {
    it('schedules the periodic retry alarm from the queue backoff without deleting anything', async () => {
        await seedQueue([expired('u1')]);

        chrome.runtime.onMessage.callListeners({ type: SCHEDULE_DELETE_RETRY, chatUuid: 'u1' }, {}, () => {});
        await settle();

        expect(alarms.get(RETRY_ALARM_NAME)).toEqual({ periodInMinutes: 0.5 });
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(await readQueue()).toEqual([expired('u1')]);
    });

    it('an unrelated message type schedules no alarm', async () => {
        await seedQueue([expired('u1')]);

        chrome.runtime.onMessage.callListeners({ type: 'SOME_OTHER_TYPE' }, {}, () => {});
        await settle();

        expect(alarms.size).toBe(0);
    });
});

describe('onAlarm — dss-delete-retry', () => {
    it('deletes by lease expiry even when the expired uuid is in the local open set; the fresh entry stays queued untouched', async () => {
        await seedQueue([expired('uExpired'), fresh('uFresh')]);
        await store.addOpenUuid('uExpired');

        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await settle();

        expect(fetchedUuids()).toEqual(['uExpired']);
        expect(await readQueue()).toEqual([fresh('uFresh')]);
    });

    it('an unrelated alarm deletes nothing and leaves the queue as it was', async () => {
        await seedQueue([expired('u1')]);

        chrome.alarms.onAlarm.callListeners({ name: 'some-other-alarm' });
        await settle();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(await readQueue()).toEqual([expired('u1')]);
    });
});

describe('onChanged (sync, pending-deletes key) — lease gating, loop guard, area filter', () => {
    it('[safeguard] fresh lease retains, expired lease deletes: only uExpired is fetched and removed', async () => {
        await seedQueue([fresh('uFresh'), expired('uExpired')]);

        fireSyncChange();
        await settle();

        expect(fetchedUuids()).toEqual(['uExpired']);
        expect(await readQueue()).toEqual([fresh('uFresh')]);
    });

    it('loop guard: when every entry has a fresh lease the sweep writes nothing back to the sync queue', async () => {
        await seedQueue([fresh('uFresh')]);
        syncQueueWrites.length = 0;

        fireSyncChange();
        await settle();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(syncQueueWrites, 'a no-op sweep must not re-fire sync onChanged').toEqual([]);
        expect(await readQueue()).toEqual([fresh('uFresh')]);
    });

    it('area filter: a change reported for area "local" deletes nothing', async () => {
        await seedQueue([expired('u1')]);

        fireSyncChange('local');
        await settle();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(await readQueue()).toEqual([expired('u1')]);
    });
});
