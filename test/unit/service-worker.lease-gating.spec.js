/**
 * background/service-worker.js — lease-gated deletion (RED-phase spec).
 *
 * Specifies that lease gating REPLACES the device-local open-UUID exclude list on
 * every remediation scan path (onStartup, the dss-delete-retry alarm, and the sync
 * storage.onChanged event). Assertions are derived purely from the stated
 * requirements and the public collaborator interfaces (TemporaryChatPendingStore,
 * DSSDeepSeekApi.performDeleteFetch); the service-worker implementation is NOT read.
 *
 * Bootstrap mirrors service-worker.pending-delete.spec.js: service-worker.js is a
 * classic script referencing bare globals, stubbed BEFORE import so its top-level
 * listener registrations bind to the stubs. Deterministic now is provided by a
 * Date.now spy (fake timers would stall the macrotask flusher that lets the service
 * worker await-chains settle, so a Date.now spy is used instead).
 */
import '../../utils/deepseek-api.js';
import '../../utils/temporary-chat-constants.js';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';

const RETRY_ALARM_NAME = 'dss-delete-retry';
const PENDING_SYNC_KEY = 'dss-pending-deletes-sync';
const LEASE_TTL_MS = 600000;
const NOW = 1700000000000;

function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushAll(times = 5) {
    for (let i = 0; i < times; i++) {
        await flushMicrotasks();
    }
}

function fetchedUuids() {
    return globalThis.fetch.mock.calls.map((c) => JSON.parse(c[1].body).chat_session_id);
}

function savedQueue() {
    const calls = store.savePendingDeletes.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

const realIsLeaseExpired = (entry, now) =>
    !Number.isFinite(entry?.lastActiveAt) || now - entry.lastActiveAt > LEASE_TTL_MS;

let store;

const TRIGGERS = {
    onStartup: () => chrome.runtime.onStartup.callListeners(),
    'retry alarm': () => chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME }),
    'sync storage.onChanged': () =>
        chrome.storage.onChanged.callListeners({ [PENDING_SYNC_KEY]: { newValue: [] } }, 'sync'),
};

beforeAll(async () => {
    globalThis.importScripts = vi.fn();
    globalThis.StorageManager = {
        isSyncedWithCloud: vi.fn().mockResolvedValue(true),
        retrySync: vi.fn(),
    };
    store = makePendingStoreMock();
    store.isLeaseExpired = realIsLeaseExpired;
    store.refreshLease = vi.fn().mockResolvedValue(undefined);
    store.releaseLease = vi.fn().mockResolvedValue(undefined);
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
    store.isLeaseExpired = realIsLeaseExpired;
    globalThis.StorageManager.isSyncedWithCloud.mockReset().mockResolvedValue(true);
    globalThis.StorageManager.retrySync.mockReset();
    globalThis.fetch.mockReset().mockResolvedValue({ ok: true });
    chrome.alarms.create.mockClear?.();
    chrome.alarms.clear.mockClear?.();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const fresh = (uuid, extra = {}) => ({ chatUuid: uuid, attemptCount: 0, lastActiveAt: NOW, ...extra });
const expired = (uuid, extra = {}) => ({ chatUuid: uuid, attemptCount: 0, lastActiveAt: NOW - (LEASE_TTL_MS + 1), ...extra });

describe('lease gating replaces the open-UUID exclude list on every scan path', () => {
    describe.each(Object.entries(TRIGGERS))('%s', (_name, trigger) => {
        it('deletes only the expired-lease entry and retains the fresh-lease entry', async () => {
            store.getPendingDeletes.mockResolvedValue([fresh('fresh-uuid'), expired('expired-uuid')]);

            trigger();
            await flushAll();

            expect(fetchedUuids()).toEqual(['expired-uuid']);
            expect(savedQueue()).toEqual([expect.objectContaining({ chatUuid: 'fresh-uuid' })]);
        });
    });
});

describe('lease boundary conditions', () => {
    it('an entry exactly at the TTL boundary (now - lastActiveAt === 600000) is NOT deleted', async () => {
        const boundary = { chatUuid: 'boundary-uuid', attemptCount: 0, lastActiveAt: NOW - LEASE_TTL_MS };
        store.getPendingDeletes.mockResolvedValue([boundary, expired('expired-uuid')]);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(fetchedUuids()).toEqual(['expired-uuid']);
        expect(savedQueue()).toEqual([expect.objectContaining({ chatUuid: 'boundary-uuid' })]);
    });

    it('an entry with no lastActiveAt field is treated as expired and IS deleted', async () => {
        const noLease = { chatUuid: 'no-lease-uuid', attemptCount: 0 };
        store.getPendingDeletes.mockResolvedValue([noLease, fresh('fresh-uuid')]);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(fetchedUuids()).toEqual(['no-lease-uuid']);
        expect(savedQueue()).toEqual([expect.objectContaining({ chatUuid: 'fresh-uuid' })]);
    });
});

describe('onStartup fast-restart recovery', () => {
    it('releases the lease of locally-open uuids so they become deletable, deleting A and keeping B', async () => {
        const queue = [fresh('A'), fresh('B')];
        store.getOpenUuids.mockResolvedValue(['A']);
        store.getPendingDeletes.mockResolvedValue(queue);
        store.releaseLease.mockImplementation(async (uuid) => {
            const entry = queue.find((e) => e.chatUuid === uuid);
            if (entry) entry.lastActiveAt = 0;
        });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(fetchedUuids()).toEqual(['A']);
        expect(savedQueue()).toEqual([expect.objectContaining({ chatUuid: 'B' })]);
    });
});

describe('device-local open set no longer gates the alarm and sync paths', () => {
    const RETRY_AND_SYNC = {
        'retry alarm': TRIGGERS['retry alarm'],
        'sync storage.onChanged': TRIGGERS['sync storage.onChanged'],
    };

    describe.each(Object.entries(RETRY_AND_SYNC))('%s', (_name, trigger) => {
        it('never deletes a fresh-lease entry even when it is absent from the local open set', async () => {
            store.getOpenUuids.mockResolvedValue([]);
            store.getPendingDeletes.mockResolvedValue([fresh('fresh-uuid')]);

            trigger();
            await flushAll();

            expect(fetchedUuids()).toEqual([]);
            expect(store.savePendingDeletes).not.toHaveBeenCalled();
        });
    });
});

describe('preserved remediation behaviour under lease gating', () => {
    it('a failed delete increments attemptCount and the entry is dropped after 3 attempts', async () => {
        store.getPendingDeletes.mockResolvedValue([expired('retry-uuid', { attemptCount: 0 })]);
        globalThis.fetch.mockResolvedValue({ ok: false });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(savedQueue()).toEqual([expect.objectContaining({ chatUuid: 'retry-uuid', attemptCount: 1 })]);

        store.savePendingDeletes.mockClear();
        store.getPendingDeletes.mockResolvedValue([expired('retry-uuid', { attemptCount: 2 })]);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(savedQueue()).toEqual([]);
    });
});
