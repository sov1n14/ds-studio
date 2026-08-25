/**
 * background/service-worker.js — pending-delete remediation coverage.
 *
 * service-worker.js is a classic script that calls importScripts(...) at the top
 * and references bare globals (StorageManager, TemporaryChatPendingStore). We stub
 * both BEFORE importing so the file's top-level listener registrations see the stubs.
 * fetch is stubbed globally to drive performDeleteFetch's success/failure branches.
 *
 * Lease gating: remediatePendingDeletes() takes no arguments and deletes a queue
 * entry only when TemporaryChatPendingStore.isLeaseExpired(entry, now) is true.
 * The store double carries a REAL isLeaseExpired plus refreshLease and a
 * releaseLease that zeroes lastActiveAt on the queue the double serves, so fixtures
 * drive deletion vs. retention purely through each entry's lease freshness. An
 * expired lease is lastActiveAt: 0 (now - 0 exceeds LEASE_TTL_MS); a fresh lease is
 * lastActiveAt: Date.now() at fixture time.
 */
import '../../utils/deepseek-api.js';
import '../../utils/temporary-chat-constants.js';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const RETRY_ALARM_NAME = 'dss-delete-retry';
const SCHEDULE_DELETE_RETRY = 'DSS_SCHEDULE_DELETE_RETRY';
const LEASE_TTL_MS = 600000;
const EXPIRED = 0; // lastActiveAt far in the past → lease expired
const fresh = () => Date.now(); // lease refreshed now → not expired

function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushAll(times = 5) {
    for (let i = 0; i < times; i++) {
        await flushMicrotasks();
    }
}

let pendingStoreStub;

beforeAll(async () => {
    globalThis.importScripts = vi.fn();
    globalThis.StorageManager = {
        isSyncedWithCloud: vi.fn().mockResolvedValue(true),
        retrySync: vi.fn(),
    };
    pendingStoreStub = {
        getPendingDeletes: vi.fn().mockResolvedValue([]),
        savePendingDeletes: vi.fn().mockResolvedValue(undefined),
        getOpenUuids: vi.fn().mockResolvedValue([]),
        clearOpenUuids: vi.fn().mockResolvedValue(undefined),
        getLastAuthToken: vi.fn().mockResolvedValue(null),
        isLeaseExpired: (entry, now) =>
            !Number.isFinite(entry?.lastActiveAt) || now - entry.lastActiveAt > LEASE_TTL_MS,
        refreshLease: vi.fn(),
        releaseLease: vi.fn(async (uuid) => {
            const queue = await pendingStoreStub.getPendingDeletes();
            const entry = queue.find((e) => e.chatUuid === uuid);
            if (entry) entry.lastActiveAt = 0;
        }),
    };
    globalThis.TemporaryChatPendingStore = pendingStoreStub;
    globalThis.DSSSettingsRoutes = { install: vi.fn() };
    globalThis.DSSPendingStoreRoutes = { install: vi.fn() };
    globalThis.DSSEditorWindowRoutes = { install: vi.fn() };
    globalThis.fetch = vi.fn();

    await import('../../background/service-worker.js');
});

beforeEach(() => {
    pendingStoreStub.getPendingDeletes.mockReset().mockResolvedValue([]);
    pendingStoreStub.savePendingDeletes.mockReset().mockResolvedValue(undefined);
    pendingStoreStub.getOpenUuids.mockReset().mockResolvedValue([]);
    pendingStoreStub.clearOpenUuids.mockReset().mockResolvedValue(undefined);
    pendingStoreStub.getLastAuthToken.mockReset().mockResolvedValue(null);
    pendingStoreStub.refreshLease.mockReset();
    pendingStoreStub.releaseLease.mockClear();
    globalThis.StorageManager.isSyncedWithCloud.mockReset().mockResolvedValue(true);
    globalThis.StorageManager.retrySync.mockReset();
    globalThis.fetch.mockReset();
    chrome.alarms.create.mockClear?.();
    chrome.alarms.clear.mockClear?.();
});

describe('onStartup — remediation', () => {
    it('[CAP-02] happy path: expired queue [{u1,0}], token present, fetch ok → performDeleteFetch(u1, token), savePendingDeletes([]), clearOpenUuids called', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 0, lastActiveAt: EXPIRED }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://chat.deepseek.com/api/v0/chat_session/delete',
            expect.objectContaining({
                headers: expect.objectContaining({ authorization: 'Bearer tok' }),
                body: JSON.stringify({ chat_session_id: 'u1' }),
            })
        );
        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([]);
        expect(pendingStoreStub.clearOpenUuids).toHaveBeenCalled();
    });

    it('[known limitation] cross-device no-token: token null → no fetch, savePendingDeletes NOT called', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 0, lastActiveAt: EXPIRED }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue(null);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(pendingStoreStub.savePendingDeletes).not.toHaveBeenCalled();
    });

    it('[invariant] confirmed-deletion: expired lease + fetch not ok → savePendingDeletes([{u1, attemptCount:1}]) and scheduleRetryAlarm called', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 0, lastActiveAt: EXPIRED }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([{ chatUuid: 'u1', attemptCount: 1 }]);
        expect(chrome.alarms.create).toHaveBeenCalledWith(RETRY_ALARM_NAME, { delayInMinutes: 0.5 });
    });

    it('attemptCount cap: expired entry {attemptCount:2} + not-ok → dropped (saved [])', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 2, lastActiveAt: EXPIRED }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([]);
    });

    it('[idempotency] idempotent re-delete: fetch ok for already-deleted expired uuid → removed', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 1, lastActiveAt: EXPIRED }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([]);
    });
});

describe('onMessage — DSS_SCHEDULE_DELETE_RETRY', () => {
    it('creates the dss-delete-retry alarm with delayInMinutes 0.5', async () => {
        chrome.runtime.onMessage.callListeners({ type: SCHEDULE_DELETE_RETRY, chatUuid: 'u1' }, {}, () => {});
        await flushMicrotasks();

        expect(chrome.alarms.create).toHaveBeenCalledWith(RETRY_ALARM_NAME, { delayInMinutes: 0.5 });
    });

    it('ignores an unrelated message type', async () => {
        chrome.alarms.create.mockClear();
        chrome.runtime.onMessage.callListeners({ type: 'SOME_OTHER_TYPE' }, {}, () => {});
        await flushMicrotasks();

        expect(chrome.alarms.create).not.toHaveBeenCalled();
    });
});

describe('onAlarm — dss-delete-retry', () => {
    it('remediates by lease expiry and does not consult the open set', async () => {
        pendingStoreStub.getOpenUuids.mockResolvedValue(['uExpired']);
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'uExpired', attemptCount: 0, lastActiveAt: EXPIRED },
            { chatUuid: 'uFresh', attemptCount: 0, lastActiveAt: fresh() },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await flushAll();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ body: JSON.stringify({ chat_session_id: 'uExpired' }) })
        );
        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([
            expect.objectContaining({ chatUuid: 'uFresh' }),
        ]);
    });

    it('ignores an unrelated alarm', async () => {
        chrome.runtime.onStartup.callListeners; // no-op reference
        pendingStoreStub.getPendingDeletes.mockClear();

        chrome.alarms.onAlarm.callListeners({ name: 'some-other-alarm' });
        await flushMicrotasks();

        expect(pendingStoreStub.getPendingDeletes).not.toHaveBeenCalled();
    });
});

describe('onChanged (sync, dss-pending-deletes-sync) — lease gating + loop guard + area filter', () => {
    it('[safeguard] fresh lease retains, expired lease deletes: [{uFresh},{uExpired}] → only uExpired fetched/removed, uFresh retained by its fresh lease', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'uFresh', attemptCount: 0, lastActiveAt: fresh() },
            { chatUuid: 'uExpired', attemptCount: 0, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.storage.onChanged.callListeners({ 'dss-pending-deletes-sync': { newValue: [] } }, 'sync');
        await flushAll();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ body: JSON.stringify({ chat_session_id: 'uExpired' }) })
        );
        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([
            expect.objectContaining({ chatUuid: 'uFresh' }),
        ]);
    });

    it('loop guard: every queue entry has a fresh lease → savePendingDeletes NOT called, fetch count 0', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'uFresh', attemptCount: 0, lastActiveAt: fresh() }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');

        chrome.storage.onChanged.callListeners({ 'dss-pending-deletes-sync': { newValue: [] } }, 'sync');
        await flushAll();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(pendingStoreStub.savePendingDeletes).not.toHaveBeenCalled();
    });

    it('area filter: area "local" is ignored', async () => {
        pendingStoreStub.getPendingDeletes.mockClear();

        chrome.storage.onChanged.callListeners({ 'dss-pending-deletes-sync': { newValue: [] } }, 'local');
        await flushMicrotasks();

        expect(pendingStoreStub.getPendingDeletes).not.toHaveBeenCalled();
    });
});
