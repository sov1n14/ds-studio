/**
 * background/service-worker.js — dss-delete-retry alarm re-arm coverage.
 *
 * The retry alarm must exist whenever the pending-delete queue is non-empty after a sweep:
 *   R1: chrome.runtime.onInstalled (extension reload/update) with a non-empty queue schedules it.
 *   R2: a sweep on a device with no captured auth token attempts no delete, leaves the queue untouched, and still re-arms it.
 *   R3 (control): onInstalled with an empty queue schedules only dss-sync-retry.
 *
 * Harness: test/helpers/service-worker-harness.js — REAL pending-store and service worker on the in-memory storage fixture; alarms observed through the harness `alarms` Map, deletes through the fetch mock.
 */
import { RETRY_ALARM_NAME, TOKEN_KEY, alarms, expired, fresh, settle, seedQueue, readQueue, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect } from 'vitest';

installServiceWorkerHarness();

const SYNC_RETRY_ALARM_NAME = globalThis.SYNC_RETRY_ALARM_NAME;

describe('G1: onInstalled must rearm dss-delete-retry when the queue is non-empty', () => {
    it('R1: non-empty queue + token present + no open tabs -> dss-delete-retry alarm scheduled after onInstalled({reason:"update"})', async () => {
        await seedQueue([fresh('a1')]);

        chrome.runtime.onInstalled.callListeners({ reason: 'update' });
        await settle();

        expect(await readQueue(), 'precondition: the entry is still pending').toEqual([fresh('a1')]);
        expect(alarms.has(RETRY_ALARM_NAME)).toBe(true);
    });
});

describe('G2: no-token early return must still rearm dss-delete-retry', () => {
    it('R2: expired entry + no token -> retry alarm fires -> no fetch, queue unchanged, dss-delete-retry re-armed', async () => {
        await chrome.storage.local.remove(TOKEN_KEY);
        await seedQueue([expired('a1')]);

        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await settle();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(await readQueue()).toEqual([expired('a1')]);
        expect(alarms.has(RETRY_ALARM_NAME)).toBe(true);
    });
});

describe('R3 (control): empty queue -> no dss-delete-retry alarm after onInstalled', () => {
    it('R3: empty queue -> onInstalled schedules dss-sync-retry but NOT dss-delete-retry', async () => {
        chrome.runtime.onInstalled.callListeners({ reason: 'update' });
        await settle();

        expect(alarms.has(SYNC_RETRY_ALARM_NAME)).toBe(true);
        expect(alarms.has(RETRY_ALARM_NAME)).toBe(false);
    });
});
