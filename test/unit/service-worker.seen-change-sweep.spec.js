/**
 * service-worker.js — orphan dss-last-seen-change: key sweep (RED-phase spec).
 *
 * After remediatePendingDeletes() finishes, every chrome.storage.local key
 * with prefix "dss-last-seen-change:" whose UUID is NOT in the resulting
 * pending queue must be removed. Production showed 26 such orphan keys
 * accumulating.
 *
 * Assertions derived from requirements only; implementation NOT read.
 */
import '../../utils/deepseek-api.js';
import '../../utils/temporary-chat-constants.js';
import '../../background/service-worker-constants.js';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';

const RETRY_ALARM_NAME = globalThis.RETRY_ALARM_NAME;
const PENDING_SYNC_KEY = globalThis.DSS_TEMP_CHAT.DSS_PENDING_DELETES_SYNC_KEY;
const LEASE_TTL_MS = globalThis.DSS_TEMP_CHAT.LEASE_TTL_MS;
const NOW = 1700000000000;

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
    store = makePendingStoreMock();
    store.isLeaseExpired = (entry, now, lastSeenChange) =>
        !Number.isFinite(lastSeenChange) || now - lastSeenChange > LEASE_TTL_MS;
    store.refreshLease = vi.fn().mockResolvedValue(undefined);
    store.releaseLease = vi.fn().mockResolvedValue(undefined);
    store.recordLeaseObservation = vi.fn(async (_uuid, lastActiveAt) => lastActiveAt);
    globalThis.TemporaryChatPendingStore = store;
    globalThis.DSSSettingsRoutes = { install: vi.fn() };
    globalThis.DSSPendingStoreRoutes = { install: vi.fn() };
    globalThis.DSSEditorWindowRoutes = { install: vi.fn() };
    globalThis.fetch = vi.fn();

    await import('../../background/service-worker.js');
});

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    store.getPendingDeletes.mockReset().mockResolvedValue([]);
    store.savePendingDeletes.mockReset().mockResolvedValue(undefined);
    store.getOpenUuids.mockReset().mockResolvedValue([]);
    store.clearOpenUuids.mockReset().mockResolvedValue(undefined);
    store.getLastAuthToken.mockReset().mockResolvedValue('Bearer tok');
    store.refreshLease.mockReset().mockResolvedValue(undefined);
    store.releaseLease.mockReset().mockResolvedValue(undefined);
    store.recordLeaseObservation.mockReset().mockImplementation(async (_uuid, lastActiveAt) => lastActiveAt);
    globalThis.StorageManager.isSyncedWithCloud.mockReset().mockResolvedValue(true);
    globalThis.StorageManager.retrySync.mockReset();
    globalThis.fetch.mockReset().mockResolvedValue({ ok: true });
    chrome.alarms.create.mockClear?.();
    chrome.alarms.clear.mockClear?.();
    chrome.tabs.query.mockReset().mockResolvedValue([]);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('orphan dss-last-seen-change: key sweep after remediation', () => {
    it('R4a: keys whose UUID is not in the post-remediation queue are removed; keys with a queued UUID are kept', async () => {
        // Seed chrome.storage.local with two seen-change keys and one unrelated key
        await chrome.storage.local.set({
            'dss-last-seen-change:orphan-1': 5,
            'dss-last-seen-change:keep-1': 5,
            'dss-last-auth-token': 'Bearer x',
        });

        // Queue has only keep-1 with a fresh lease (not expired → will stay in queue)
        const keepEntry = { chatUuid: 'keep-1', attemptCount: 0, lastActiveAt: NOW };
        store.getPendingDeletes.mockResolvedValue([keepEntry]);
        // fetch 500 so keep-1 is NOT successfully deleted (stays in queue)
        globalThis.fetch.mockResolvedValue({ ok: false, status: 500 });
        // savePendingDeletes captures the resulting queue; keep-1 should remain
        store.savePendingDeletes.mockResolvedValue(undefined);

        // Fire the retry alarm
        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await flushAll(15);

        // Assert: orphan-1's seen-change key must be removed from local storage
        const localData = await chrome.storage.local.get(null);
        expect(localData).not.toHaveProperty('dss-last-seen-change:orphan-1');
        // keep-1's seen-change key must still be present
        expect(localData).toHaveProperty('dss-last-seen-change:keep-1', 5);
        // Unrelated keys must not be touched
        expect(localData).toHaveProperty('dss-last-auth-token', 'Bearer x');
    });
});
