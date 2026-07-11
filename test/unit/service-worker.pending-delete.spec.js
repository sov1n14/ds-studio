/**
 * background/service-worker.js — pending-delete remediation coverage.
 *
 * service-worker.js is a classic script that calls importScripts(...) at the top
 * and references bare globals (StorageManager, TemporaryChatPendingStore). We stub
 * both BEFORE importing so the file's top-level listener registrations see the stubs.
 * fetch is stubbed globally to drive performDeleteFetch's success/failure branches.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const RETRY_ALARM_NAME = 'dss-delete-retry';
const SCHEDULE_DELETE_RETRY = 'DSS_SCHEDULE_DELETE_RETRY';
const OLD_PENDING_LOCAL_KEY = 'dss-pending-deletes';

function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Flush the macrotask queue multiple times to let long await-chains settle. */
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
    };
    globalThis.TemporaryChatPendingStore = pendingStoreStub;
    globalThis.fetch = vi.fn();

    await import('../../background/service-worker.js');
});

beforeEach(() => {
    pendingStoreStub.getPendingDeletes.mockReset().mockResolvedValue([]);
    pendingStoreStub.savePendingDeletes.mockReset().mockResolvedValue(undefined);
    pendingStoreStub.getOpenUuids.mockReset().mockResolvedValue([]);
    pendingStoreStub.clearOpenUuids.mockReset().mockResolvedValue(undefined);
    pendingStoreStub.getLastAuthToken.mockReset().mockResolvedValue(null);
    globalThis.StorageManager.isSyncedWithCloud.mockReset().mockResolvedValue(true);
    globalThis.StorageManager.retrySync.mockReset();
    globalThis.fetch.mockReset();
    chrome.alarms.create.mockClear?.();
    chrome.alarms.clear.mockClear?.();
});

describe('onStartup — remediation', () => {
    it('[CAP-02] happy path: queue [{u1,0}], token present, fetch ok → performDeleteFetch(u1, token), savePendingDeletes([]), clearOpenUuids called', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 0 }]);
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
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 0 }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue(null);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(pendingStoreStub.savePendingDeletes).not.toHaveBeenCalled();
    });

    it('[invariant] confirmed-deletion: fetch not ok → savePendingDeletes([{u1, attemptCount:1}]) and scheduleRetryAlarm (chrome.alarms.create) called', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 0 }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([{ chatUuid: 'u1', attemptCount: 1 }]);
        expect(chrome.alarms.create).toHaveBeenCalledWith(RETRY_ALARM_NAME, { delayInMinutes: 0.5 });
    });

    it('attemptCount cap: entry {attemptCount:2} + not-ok → dropped (saved [])', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 2 }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([]);
    });

    it('[idempotency] idempotent re-delete: fetch ok for already-deleted uuid → removed', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'u1', attemptCount: 1 }]);
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
    it('triggers remediation with open-set exclusion', async () => {
        pendingStoreStub.getOpenUuids.mockResolvedValue(['uOpen']);
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'uOpen', attemptCount: 0 }, { chatUuid: 'uOther', attemptCount: 0 }]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await flushAll();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ body: JSON.stringify({ chat_session_id: 'uOther' }) })
        );
    });

    it('ignores an unrelated alarm', async () => {
        chrome.runtime.onStartup.callListeners; // no-op reference to avoid unused import warnings
        pendingStoreStub.getPendingDeletes.mockClear();

        chrome.alarms.onAlarm.callListeners({ name: 'some-other-alarm' });
        await flushMicrotasks();

        expect(pendingStoreStub.getPendingDeletes).not.toHaveBeenCalled();
    });
});

describe('onChanged (sync, dss-pending-deletes-sync) — safeguard + loop guard + area filter', () => {
    it('[safeguard] openSet=[uOpen], queue [{uOpen,0},{uOther,0}] → only uOther fetched/removed, uOpen retained', async () => {
        pendingStoreStub.getOpenUuids.mockResolvedValue(['uOpen']);
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'uOpen', attemptCount: 0 },
            { chatUuid: 'uOther', attemptCount: 0 },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.storage.onChanged.callListeners({ 'dss-pending-deletes-sync': { newValue: [] } }, 'sync');
        await flushAll();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([{ chatUuid: 'uOpen', attemptCount: 0 }]);
    });

    it('loop guard: every queue entry excluded → savePendingDeletes NOT called, fetch count 0', async () => {
        pendingStoreStub.getOpenUuids.mockResolvedValue(['uOpen']);
        pendingStoreStub.getPendingDeletes.mockResolvedValue([{ chatUuid: 'uOpen', attemptCount: 0 }]);
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

describe('onInstalled', () => {
    it('removes the old dss-pending-deletes local key', async () => {
        const removeSpy = vi.spyOn(chrome.storage.local, 'remove');
        chrome.runtime.onInstalled.callListeners();
        await flushMicrotasks();

        expect(removeSpy).toHaveBeenCalledWith(OLD_PENDING_LOCAL_KEY);
        removeSpy.mockRestore();
    });
});
