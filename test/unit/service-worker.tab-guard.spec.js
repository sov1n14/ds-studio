/**
 * service-worker.js — tab-query guard for in-use conversations (RED-phase spec).
 *
 * Before deleting an expired-lease item, remediatePendingDeletes should query
 * all DeepSeek tabs and skip deletion (refreshing the lease instead) for any
 * item whose chatUuid matches a currently-open tab URL.
 *
 * Also asserts cleanup of observation keys on successful delete.
 *
 * Assertions derived from requirements only; implementation NOT read.
 */
import '../../utils/deepseek-api.js';
import '../../utils/temporary-chat-constants.js';
import '../../background/service-worker-constants.js';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { makePendingStoreMock } from '../helpers/pending-store-mock.js';

const RETRY_ALARM_NAME = globalThis.RETRY_ALARM_NAME;
const PENDING_SYNC_KEY = globalThis.DSS_PENDING_DELETES_SYNC_KEY;
const LEASE_TTL_MS = globalThis.LEASE_TTL_MS;
const NOW = 1700000000000;

function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
async function flushAll(times = 5) {
    for (let i = 0; i < times; i++) await flushMicrotasks();
}

function fetchedUuids() {
    return globalThis.fetch.mock.calls.map((c) => JSON.parse(c[1].body).chat_session_id);
}

function savedQueue() {
    const calls = store.savePendingDeletes.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

let store;

const realIsLeaseExpired = (entry, now, lastSeenChange) =>
    !Number.isFinite(lastSeenChange) || now - lastSeenChange > LEASE_TTL_MS;

const expired = (uuid, extra = {}) => ({
    chatUuid: uuid,
    attemptCount: 0,
    lastActiveAt: NOW - (LEASE_TTL_MS + 1),
    ...extra,
});

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
    store.isLeaseExpired = realIsLeaseExpired;
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

describe('tab-query guard: skip deletion when a local tab is viewing the conversation', () => {
    it('TG-1: tab with matching UUID skips deletion and refreshes lease instead', async () => {
        store.getPendingDeletes.mockResolvedValue([expired('abc-123')]);
        chrome.tabs.query.mockResolvedValue([
            { url: 'https://chat.deepseek.com/a/chat/s/abc-123' },
        ]);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        // performDeleteFetch should NOT have been called for abc-123
        expect(fetchedUuids()).not.toContain('abc-123');
        // refreshLease should have been called as proxy heartbeat
        expect(store.refreshLease).toHaveBeenCalledWith('abc-123');
        // item remains in queue unchanged (no attemptCount increment)
        const queue = savedQueue();
        expect(queue).toBeDefined();
        expect(queue).toEqual([expect.objectContaining({ chatUuid: 'abc-123', attemptCount: 0 })]);
    });

    it('TG-2: tab with different UUID does not prevent deletion', async () => {
        store.getPendingDeletes.mockResolvedValue([expired('abc-123')]);
        chrome.tabs.query.mockResolvedValue([
            { url: 'https://chat.deepseek.com/a/chat/s/different-uuid' },
        ]);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        // chrome.tabs.query MUST have been called (new behavior)
        expect(chrome.tabs.query).toHaveBeenCalledWith({ url: '*://chat.deepseek.com/*' });
        expect(fetchedUuids()).toContain('abc-123');
    });

    it('TG-3: no DeepSeek tabs -- normal deletion proceeds', async () => {
        store.getPendingDeletes.mockResolvedValue([expired('abc-123')]);
        chrome.tabs.query.mockResolvedValue([]);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        // chrome.tabs.query MUST have been called (new behavior)
        expect(chrome.tabs.query).toHaveBeenCalledWith({ url: '*://chat.deepseek.com/*' });
        expect(fetchedUuids()).toContain('abc-123');
    });

    it('TG-4: multiple items, one protected by tab — only unprotected item deleted', async () => {
        store.getPendingDeletes.mockResolvedValue([expired('aaa-aaa'), expired('bbb-bbb')]);
        chrome.tabs.query.mockResolvedValue([
            { url: 'https://chat.deepseek.com/a/chat/s/aaa-aaa' },
        ]);

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        // aaa-aaa should be skipped (tab-guarded) and refreshed
        expect(fetchedUuids()).not.toContain('aaa-aaa');
        expect(store.refreshLease).toHaveBeenCalledWith('aaa-aaa');
        // bbb-bbb should be deleted normally
        expect(fetchedUuids()).toContain('bbb-bbb');
    });

    it('TG-5: chrome.tabs.query failure degrades gracefully -- deletion proceeds', async () => {
        store.getPendingDeletes.mockResolvedValue([expired('abc-123')]);
        chrome.tabs.query.mockRejectedValue(new Error('tabs API unavailable'));

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        // chrome.tabs.query MUST have been called (new behavior)
        expect(chrome.tabs.query).toHaveBeenCalledWith({ url: '*://chat.deepseek.com/*' });
        // fail-open: deletion should proceed despite tabs API failure
        expect(fetchedUuids()).toContain('abc-123');
    });
});

describe('cleanup of observation key on successful delete', () => {
    it('TG-6: successful delete removes the dss-last-seen-change:<uuid> local storage key', async () => {
        const removeSpy = vi.spyOn(chrome.storage.local, 'remove');
        store.getPendingDeletes.mockResolvedValue([expired('del-uuid')]);
        chrome.tabs.query.mockResolvedValue([]);
        globalThis.fetch.mockResolvedValue({ ok: true });

        chrome.runtime.onStartup.callListeners();
        await flushAll();

        expect(removeSpy).toHaveBeenCalledWith('dss-last-seen-change:del-uuid');
    });
});
