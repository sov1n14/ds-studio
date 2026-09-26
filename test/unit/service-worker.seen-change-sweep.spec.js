/**
 * background/service-worker.js — orphan dss-last-seen-change:<uuid> key sweep, asserted on chrome.storage.local end state.
 *
 * After a sweep, every local key with the seen-change prefix whose UUID is not in the resulting queue must be gone (production accumulated 26 orphans); keys for UUIDs still queued, and unrelated keys, must survive.
 *
 * Real background/pending-store.js and real background/service-worker.js share the in-memory chrome.storage fixture (deep-copy get/set). Mocked trust boundaries only: chrome.storage.onChanged registration, chrome.tabs, chrome.alarms (Map-backed), fetch. StorageManager and the route installers are stubbed because they are off the sweep path.
 */
import { RETRY_ALARM_NAME, TOKEN_KEY, NOW, alarms, expired, fresh, settle, seedQueue, fetchedUuids, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect } from 'vitest';

installServiceWorkerHarness();

const SEEN = globalThis.DSS_TEMP_CHAT.DSS_LAST_SEEN_CHANGE_KEY_PREFIX;

describe('orphan seen-change key sweep after remediation', () => {
    it('R4a: orphan keys are removed; keys of still-queued uuids (fresh and failed) and unrelated keys are kept', async () => {
        const keepObservation = { lastActiveAt: NOW, observedAt: NOW };
        await chrome.storage.local.set({
            [SEEN + 'orphan-1']: 5,
            [SEEN + 'orphan-2']: { lastActiveAt: 7, observedAt: NOW - 1 },
            [SEEN + 'keep-1']: keepObservation,
        });
        await seedQueue([fresh('keep-1'), expired('fail-1')]);
        globalThis.fetch.mockResolvedValue({ ok: false, status: 500 });

        chrome.alarms.onAlarm.callListeners({ name: RETRY_ALARM_NAME });
        await settle();

        expect(fetchedUuids(), 'precondition: fail-1 was attempted and failed').toEqual(['fail-1']);
        const local = await chrome.storage.local.get(null);
        expect(local).not.toHaveProperty(SEEN + 'orphan-1');
        expect(local).not.toHaveProperty(SEEN + 'orphan-2');
        expect(local[SEEN + 'keep-1']).toEqual(keepObservation);
        expect(local, 'failed entry stays queued, so its observation is kept').toHaveProperty(SEEN + 'fail-1');
        expect(local[TOKEN_KEY]).toBe('Bearer tok');
    });
});
