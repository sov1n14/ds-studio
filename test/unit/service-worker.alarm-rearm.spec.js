/**
 * background/service-worker.js — alarm re-arm gap coverage (RED-phase spec).
 *
 * Validates that the dss-delete-retry alarm is (re)created in two scenarios
 * where the current code leaves a non-empty pending-delete queue with no alarm:
 *
 * G1: chrome.runtime.onInstalled only creates the sync alarm; it never
 *     remediates the pending-delete queue, so after an extension reload/update
 *     with a non-empty queue the retry alarm is never scheduled.
 *
 * G2: remediatePendingDeletes() returns early when getLastAuthToken() is null,
 *     before scheduleRetryAlarm() is called, so a non-empty queue on a device
 *     with no captured token has no alarm.
 *
 * Assertions derived from requirements only; implementation NOT read before
 * authoring (read only to confirm line numbers cited in the defect report).
 */
import '../../utils/deepseek-api.js';
import '../../utils/temporary-chat-constants.js';
import '../../background/service-worker-constants.js';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const RETRY_ALARM_NAME = globalThis.RETRY_ALARM_NAME;   // 'dss-delete-retry'
const SYNC_RETRY_ALARM_NAME = globalThis.SYNC_RETRY_ALARM_NAME; // 'dss-sync-retry'
const LEASE_TTL_MS = globalThis.LEASE_TTL_MS;

function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
async function flushAll(times = 10) {
    for (let i = 0; i < times; i++) await flushMicrotasks();
}

let store;

beforeAll(async () => {
    globalThis.importScripts = vi.fn();
    globalThis.StorageManager = {
        isSyncedWithCloud: vi.fn().mockResolvedValue(true),
        retrySync: vi.fn(),
    };
    store = {
        getPendingDeletes: vi.fn().mockResolvedValue([]),
        savePendingDeletes: vi.fn().mockResolvedValue(undefined),
        getOpenUuids: vi.fn().mockResolvedValue([]),
        clearOpenUuids: vi.fn().mockResolvedValue(undefined),
        getLastAuthToken: vi.fn().mockResolvedValue(null),
        recordLeaseObservation: vi.fn(async (_uuid, lastActiveAt) => lastActiveAt),
        isLeaseExpired: (entry, now, lastSeenChange) =>
            !Number.isFinite(lastSeenChange) || now - lastSeenChange > LEASE_TTL_MS,
        refreshLease: vi.fn().mockResolvedValue(undefined),
        releaseLease: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.TemporaryChatPendingStore = store;
    globalThis.DSSSettingsRoutes = { install: vi.fn() };
    globalThis.DSSPendingStoreRoutes = { install: vi.fn() };
    globalThis.DSSEditorWindowRoutes = { install: vi.fn() };
    globalThis.fetch = vi.fn();

    await import('../../background/service-worker.js');
});

beforeEach(() => {
    store.getPendingDeletes.mockReset().mockResolvedValue([]);
    store.savePendingDeletes.mockReset().mockResolvedValue(undefined);
    store.getOpenUuids.mockReset().mockResolvedValue([]);
    store.clearOpenUuids.mockReset().mockResolvedValue(undefined);
    store.getLastAuthToken.mockReset().mockResolvedValue(null);
    store.recordLeaseObservation.mockReset().mockImplementation(async (_uuid, lastActiveAt) => lastActiveAt);
    store.refreshLease.mockReset().mockResolvedValue(undefined);
    store.releaseLease.mockReset().mockResolvedValue(undefined);
    globalThis.StorageManager.isSyncedWithCloud.mockReset().mockResolvedValue(true);
    globalThis.StorageManager.retrySync.mockReset();
    globalThis.fetch.mockReset();
    chrome.alarms.create.mockClear?.();
    chrome.alarms.clear.mockClear?.();
    chrome.tabs.query.mockReset().mockResolvedValue([]);
});

describe('G1: onInstalled must rearm dss-delete-retry when queue is non-empty', () => {
    it('R1: non-empty sync queue + token present + no open tabs → dss-delete-retry alarm created after onInstalled({reason:"update"})', async () => {
        // Seed: one pending entry with expired lease, token available
        store.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'a1', attemptCount: 0, lastActiveAt: Date.now() },
        ]);
        store.getLastAuthToken.mockResolvedValue('Bearer x');
        // fetch should succeed if remediation runs (entry would be removed),
        // but the key assertion is on the alarm, not the fetch outcome
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.runtime.onInstalled.callListeners({ reason: 'update' });
        await flushAll();

        // The dss-delete-retry alarm MUST be created (in addition to dss-sync-retry)
        const retryAlarmCalls = chrome.alarms.create.mock.calls.filter(
            ([name]) => name === RETRY_ALARM_NAME
        );
        expect(retryAlarmCalls.length).toBeGreaterThanOrEqual(1);
    });
});

describe('G2: no-token early return must still rearm dss-delete-retry', () => {
    it('R2: non-empty queue + no token → alarm fires → dss-delete-retry rearmed, no fetch attempted, queue entry unchanged', async () => {
        // Seed: one pending entry, NO token
        store.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'a1', attemptCount: 0, lastActiveAt: Date.now() },
        ]);
        store.getLastAuthToken.mockResolvedValue(null);

        // Fire the retry alarm (simulates the alarm going off)
        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await flushAll();

        // dss-delete-retry alarm MUST be (re)created so the queue is retried later
        const retryAlarmCalls = chrome.alarms.create.mock.calls.filter(
            ([name]) => name === RETRY_ALARM_NAME
        );
        expect(retryAlarmCalls.length).toBeGreaterThanOrEqual(1);

        // No delete attempted without a token
        expect(globalThis.fetch).not.toHaveBeenCalled();

        // Queue entry must remain unchanged (attemptCount still 0)
        if (store.savePendingDeletes.mock.calls.length > 0) {
            const savedQueue = store.savePendingDeletes.mock.calls[0][0];
            expect(savedQueue).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ chatUuid: 'a1', attemptCount: 0 }),
                ])
            );
        }
    });
});

describe('R3 (control): empty queue → no dss-delete-retry alarm after onInstalled', () => {
    it('R3: empty sync queue → onInstalled creates only dss-sync-retry, NOT dss-delete-retry (passes on current code)', async () => {
        // Queue is empty (default from beforeEach)
        store.getPendingDeletes.mockResolvedValue([]);

        chrome.runtime.onInstalled.callListeners({ reason: 'update' });
        await flushAll();

        // dss-sync-retry SHOULD have been created
        const syncAlarmCalls = chrome.alarms.create.mock.calls.filter(
            ([name]) => name === SYNC_RETRY_ALARM_NAME
        );
        expect(syncAlarmCalls.length).toBeGreaterThanOrEqual(1);

        // dss-delete-retry MUST NOT be created for an empty queue
        const retryAlarmCalls = chrome.alarms.create.mock.calls.filter(
            ([name]) => name === RETRY_ALARM_NAME
        );
        expect(retryAlarmCalls.length).toBe(0);
    });
});
