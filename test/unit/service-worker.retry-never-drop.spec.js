/**
 * service-worker.js -- retry-never-drop + exponential backoff + periodic alarm + lastActiveAt.
 * All tests assert CORRECT behavior that does NOT yet exist. They MUST fail against current code.
 */
import '../../utils/deepseek-api.js';
import '../../utils/temporary-chat-constants.js';
import '../../background/service-worker-constants.js';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const RETRY_ALARM_NAME = globalThis.RETRY_ALARM_NAME;
const LEASE_TTL_MS = globalThis.LEASE_TTL_MS;
const EXPIRED = 0;

function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
async function flushAll(times = 5) {
    for (let i = 0; i < times; i++) await flushMicrotasks();
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
        recordLeaseObservation: vi.fn(async (_uuid, lastActiveAt) => lastActiveAt),
        isLeaseExpired: (entry, now, lastSeenChange) =>
            !Number.isFinite(lastSeenChange) || now - lastSeenChange > LEASE_TTL_MS,
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
    pendingStoreStub.recordLeaseObservation.mockReset().mockImplementation(async (_uuid, lastActiveAt) => lastActiveAt);
    pendingStoreStub.refreshLease.mockReset();
    pendingStoreStub.releaseLease.mockClear();
    globalThis.StorageManager.isSyncedWithCloud.mockReset().mockResolvedValue(true);
    globalThis.StorageManager.retrySync.mockReset();
    globalThis.fetch.mockReset();
    chrome.alarms.create.mockClear?.();
    chrome.alarms.clear.mockClear?.();
});

describe('never-drop: items remain in queue regardless of attempt count', () => {
    it('attemptCount 2 + fetch fail -> item stays (not dropped)', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 2, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([
            expect.objectContaining({ chatUuid: 'u1', attemptCount: 3 }),
        ]);
    });

    it('attemptCount 10 + fetch fail -> stays with attemptCount 11', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 10, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([
            expect.objectContaining({ chatUuid: 'u1', attemptCount: 11 }),
        ]);
    });

    it('attemptCount 99 + fetch fail -> stays with attemptCount 100', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 99, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(pendingStoreStub.savePendingDeletes).toHaveBeenCalledWith([
            expect.objectContaining({ chatUuid: 'u1', attemptCount: 100 }),
        ]);
    });
});

describe('exponential backoff alarm delay', () => {
    it('attemptCount 1 -> 2 min (0.5 * 2^2 after increment)', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 1, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(chrome.alarms.create).toHaveBeenCalledWith(
            RETRY_ALARM_NAME,
            expect.objectContaining({ periodInMinutes: 2 }),
        );
    });

    it('attemptCount 3 -> 8 min (0.5 * 2^4 after increment)', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 3, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(chrome.alarms.create).toHaveBeenCalledWith(
            RETRY_ALARM_NAME,
            expect.objectContaining({ periodInMinutes: 8 }),
        );
    });

    it('attemptCount 6 -> capped at 30 min', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 6, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(chrome.alarms.create).toHaveBeenCalledWith(
            RETRY_ALARM_NAME,
            expect.objectContaining({ periodInMinutes: 30 }),
        );
    });

    it('multiple items: uses shortest backoff', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 5, lastActiveAt: EXPIRED },
            { chatUuid: 'u2', attemptCount: 1, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(chrome.alarms.create).toHaveBeenCalledWith(
            RETRY_ALARM_NAME,
            expect.objectContaining({ periodInMinutes: 2 }),
        );
    });
});

describe('periodic alarm (periodInMinutes, not delayInMinutes)', () => {
    it('alarm uses periodInMinutes, not delayInMinutes', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 0, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        const createCall = chrome.alarms.create.mock.calls.find(
            (c) => c[0] === RETRY_ALARM_NAME
        );
        expect(createCall).toBeDefined();
        const alarmOptions = createCall[1];
        expect(alarmOptions).toHaveProperty('periodInMinutes');
        expect(alarmOptions).not.toHaveProperty('delayInMinutes');
    });

    it('alarm cleared when queue empty after successful deletes', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 0, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await flushAll();

        expect(chrome.alarms.clear).toHaveBeenCalledWith(RETRY_ALARM_NAME);
    });
});

describe('lastActiveAt preserved on re-queue after failed delete', () => {
    it('failed delete re-queues item with original lastActiveAt intact', async () => {
        pendingStoreStub.getPendingDeletes.mockResolvedValue([
            { chatUuid: 'u1', attemptCount: 0, lastActiveAt: EXPIRED },
        ]);
        pendingStoreStub.getLastAuthToken.mockResolvedValue('Bearer tok');
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        const savedQueue = pendingStoreStub.savePendingDeletes.mock.calls[0][0];
        const requeued = savedQueue.find((e) => e.chatUuid === 'u1');
        expect(requeued).toBeDefined();
        expect(requeued).toHaveProperty('lastActiveAt');
        expect(requeued.lastActiveAt).toBe(EXPIRED);
    });
});
