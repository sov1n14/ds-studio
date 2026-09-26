/**
 * background/service-worker.js — cloud-sync retry wiring (resilience fix)
 *
 * Covers:
 *   - chrome.runtime.onStartup triggers a best-effort retryParkedSync()
 *   - chrome.runtime.onInstalled creates the 'dss-sync-retry' alarm (periodInMinutes 5) and triggers an immediate retry
 *   - chrome.alarms.onAlarm calls retryParkedSync() only for the 'dss-sync-retry' alarm name, and is isolated from the 'dss-delete-retry' alarm listener
 *
 * Harness: test/helpers/service-worker-harness.js loads the REAL pending-store and service worker (so the onStartup/onInstalled sweeps run for real against the in-memory storage fixture). StorageManager is the harness stub; its isSyncedWithCloud/retrySync are the collaborator this spec is about. Alarms are observed through the harness `alarms` Map.
 */
import { alarms, settle, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect, beforeEach } from 'vitest';

installServiceWorkerHarness();

const SYNC_RETRY_ALARM_NAME = globalThis.SYNC_RETRY_ALARM_NAME;
const DELETE_RETRY_ALARM_NAME = globalThis.RETRY_ALARM_NAME;

let storageManager;

beforeEach(() => {
    storageManager = globalThis.StorageManager;
    storageManager.isSyncedWithCloud.mockReset().mockResolvedValue(true);
    storageManager.retrySync.mockReset().mockResolvedValue({ success: true, remainingUnsyncedCount: 0 });
});

describe('module load — settings routes wiring', () => {
    it('installs DSSSettingsRoutes exactly once at load', () => {
        expect(globalThis.DSSSettingsRoutes.install).toHaveBeenCalledTimes(1);
    });
});

describe('chrome.runtime.onStartup — retryParkedSync on startup', () => {
    it('calls retrySync when isSyncedWithCloud() resolves false', async () => {
        storageManager.isSyncedWithCloud.mockResolvedValue(false);

        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(storageManager.retrySync).toHaveBeenCalled();
    });

    it('does NOT call retrySync when isSyncedWithCloud() resolves true', async () => {
        chrome.runtime.onStartup.callListeners();
        await settle();

        expect(storageManager.isSyncedWithCloud).toHaveBeenCalled();
        expect(storageManager.retrySync).not.toHaveBeenCalled();
    });
});

describe('chrome.runtime.onInstalled — periodic alarm creation + immediate retry', () => {
    it('schedules the dss-sync-retry alarm with periodInMinutes 5', async () => {
        chrome.runtime.onInstalled.callListeners({ reason: 'update' });
        await settle();

        expect(alarms.get(SYNC_RETRY_ALARM_NAME)).toEqual({ periodInMinutes: 5 });
    });

    it('also triggers an immediate retry attempt', async () => {
        storageManager.isSyncedWithCloud.mockResolvedValue(false);

        chrome.runtime.onInstalled.callListeners({ reason: 'update' });
        await settle();

        expect(storageManager.retrySync).toHaveBeenCalled();
    });
});

describe('chrome.alarms.onAlarm — alarm-name isolation', () => {
    it('invokes the retry path when the alarm name is dss-sync-retry', async () => {
        storageManager.isSyncedWithCloud.mockResolvedValue(false);

        chrome.alarms.onAlarm.callListeners({ name: SYNC_RETRY_ALARM_NAME });
        await settle();

        expect(storageManager.retrySync).toHaveBeenCalled();
    });

    it('does NOT call retrySync for the unrelated dss-delete-retry alarm', async () => {
        storageManager.isSyncedWithCloud.mockResolvedValue(false);

        chrome.alarms.onAlarm.callListeners({ name: DELETE_RETRY_ALARM_NAME });
        await settle();

        expect(storageManager.isSyncedWithCloud).not.toHaveBeenCalled();
        expect(storageManager.retrySync).not.toHaveBeenCalled();
    });
});
