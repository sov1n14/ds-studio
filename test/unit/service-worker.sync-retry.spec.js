/**
 * background/service-worker.js — cloud-sync retry wiring (resilience fix)
 *
 * Covers:
 *   - chrome.runtime.onStartup triggers a best-effort retryParkedSync()
 *   - chrome.runtime.onInstalled creates the 'dss-sync-retry' alarm
 *     (periodInMinutes 5) and triggers an immediate retry
 *   - chrome.alarms.onAlarm calls retryParkedSync() only for the
 *     'dss-sync-retry' alarm name, and is isolated from the pre-existing
 *     'dss-delete-retry' alarm listener
 *
 * Harness notes:
 *   - service-worker.js is a classic (non-module) script that calls
 *     importScripts(...) at the top and references the bare `StorageManager`
 *     global. We stub both BEFORE importing the file so its top-level
 *     listener registrations see our stubs.
 *   - Listener registration is a one-time module side effect; ESM import
 *     caching means the file's top-level code runs only once for this test
 *     file. Each test resets the StorageManager stub's mock state instead
 *     of re-importing the module.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const SYNC_RETRY_ALARM_NAME = 'dss-sync-retry';
const DELETE_RETRY_ALARM_NAME = 'dss-delete-retry';

function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

let storageManagerStub;
let pendingStoreStub;

beforeAll(async () => {
    globalThis.importScripts = vi.fn();
    storageManagerStub = {
        isSyncedWithCloud: vi.fn().mockResolvedValue(true),
        retrySync: vi.fn().mockResolvedValue({ success: true, remainingUnsyncedCount: 0 }),
    };
    globalThis.StorageManager = storageManagerStub;

    // service-worker.js's onStartup listener now also calls TemporaryChatPendingStore
    // (clearOpenUuids + remediatePendingDeletes via getPendingDeletes/getLastAuthToken).
    // Stub it so the listener does not throw; pending-delete behaviour itself is
    // covered by service-worker.pending-delete.spec.js.
    pendingStoreStub = {
        getPendingDeletes: vi.fn().mockResolvedValue([]),
        savePendingDeletes: vi.fn().mockResolvedValue(undefined),
        getOpenUuids: vi.fn().mockResolvedValue([]),
        clearOpenUuids: vi.fn().mockResolvedValue(undefined),
        getLastAuthToken: vi.fn().mockResolvedValue(null),
    };
    globalThis.TemporaryChatPendingStore = pendingStoreStub;

    // Import once; top-level chrome.runtime.onStartup / onInstalled / alarms.onAlarm
    // registrations happen here.
    await import('../../background/service-worker.js');
});

beforeEach(() => {
    storageManagerStub.isSyncedWithCloud.mockReset().mockResolvedValue(true);
    storageManagerStub.retrySync.mockReset().mockResolvedValue({ success: true, remainingUnsyncedCount: 0 });
    pendingStoreStub.getPendingDeletes.mockReset().mockResolvedValue([]);
    pendingStoreStub.savePendingDeletes.mockReset().mockResolvedValue(undefined);
    pendingStoreStub.getOpenUuids.mockReset().mockResolvedValue([]);
    pendingStoreStub.clearOpenUuids.mockReset().mockResolvedValue(undefined);
    pendingStoreStub.getLastAuthToken.mockReset().mockResolvedValue(null);
    chrome.alarms.create.mockClear?.();
});

describe('chrome.runtime.onStartup — retryParkedSync on startup', () => {
    it('calls retrySync when isSyncedWithCloud() resolves false', async () => {
        storageManagerStub.isSyncedWithCloud.mockResolvedValue(false);

        chrome.runtime.onStartup.callListeners();
        await flushMicrotasks();

        expect(storageManagerStub.isSyncedWithCloud).toHaveBeenCalled();
        expect(storageManagerStub.retrySync).toHaveBeenCalled();
    });

    it('does NOT call retrySync when isSyncedWithCloud() resolves true', async () => {
        storageManagerStub.isSyncedWithCloud.mockResolvedValue(true);

        chrome.runtime.onStartup.callListeners();
        await flushMicrotasks();

        expect(storageManagerStub.isSyncedWithCloud).toHaveBeenCalled();
        expect(storageManagerStub.retrySync).not.toHaveBeenCalled();
    });
});

describe('chrome.runtime.onInstalled — periodic alarm creation + immediate retry', () => {
    it('creates the dss-sync-retry alarm with periodInMinutes 5', async () => {
        chrome.runtime.onInstalled.callListeners();
        await flushMicrotasks();

        expect(chrome.alarms.create).toHaveBeenCalledWith(
            SYNC_RETRY_ALARM_NAME,
            { periodInMinutes: 5 }
        );
    });

    it('also triggers an immediate retry attempt', async () => {
        storageManagerStub.isSyncedWithCloud.mockResolvedValue(false);

        chrome.runtime.onInstalled.callListeners();
        await flushMicrotasks();

        expect(storageManagerStub.retrySync).toHaveBeenCalled();
    });
});

describe('chrome.alarms.onAlarm — alarm-name isolation', () => {
    it('invokes the retry path when the alarm name is dss-sync-retry', async () => {
        storageManagerStub.isSyncedWithCloud.mockResolvedValue(false);

        chrome.alarms.onAlarm.callListeners({ name: SYNC_RETRY_ALARM_NAME });
        await flushMicrotasks();

        expect(storageManagerStub.isSyncedWithCloud).toHaveBeenCalled();
        expect(storageManagerStub.retrySync).toHaveBeenCalled();
    });

    it('does NOT call retrySync for the unrelated dss-delete-retry alarm', async () => {
        chrome.alarms.onAlarm.callListeners({ name: DELETE_RETRY_ALARM_NAME });
        await flushMicrotasks();

        expect(storageManagerStub.isSyncedWithCloud).not.toHaveBeenCalled();
        expect(storageManagerStub.retrySync).not.toHaveBeenCalled();
    });
});
