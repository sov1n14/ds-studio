/**
 * background/service-worker.js — tab guard for in-use conversations, asserted on end state.
 *
 * An expired-lease entry whose chatUuid is open in a local DeepSeek tab must not be deleted; its lease is refreshed instead and that refresh must be what ends up persisted. A tabs.query failure fails open. A successful delete removes the entry's seen-change observation key.
 *
 * Real background/pending-store.js and real background/service-worker.js share the in-memory chrome.storage fixture (deep-copy get/set). Mocked trust boundaries only: chrome.storage.onChanged registration, chrome.tabs, chrome.alarms (Map-backed), fetch. StorageManager and the route installers are stubbed because they are off the sweep path.
 */
import { NOW, expired, settle, seedQueue, readQueue, fetchedUuids, installServiceWorkerHarness } from '../helpers/service-worker-harness.js';
import { describe, it, expect } from 'vitest';

installServiceWorkerHarness();

const SEEN = globalThis.DSS_TEMP_CHAT.DSS_LAST_SEEN_CHANGE_KEY_PREFIX;
const tabFor = (uuid, id = 1) => ({ id, url: 'https://chat.deepseek.com/a/chat/s/' + uuid });

async function startupSweep() {
    chrome.runtime.onStartup.callListeners();
    await settle();
}

describe('tab guard: skip deletion when a local tab is viewing the conversation', () => {
    it('TG-1: expired entry open in a tab is not deleted and ends queued with a refreshed lease and unchanged attemptCount', async () => {
        await seedQueue([expired('abc-123')]);
        chrome.tabs.query.mockResolvedValue([tabFor('abc-123')]);

        await startupSweep();

        expect(fetchedUuids()).not.toContain('abc-123');
        expect(await readQueue()).toEqual([{ chatUuid: 'abc-123', attemptCount: 0, lastActiveAt: NOW }]);
    });

    it('TG-2: a tab on a different conversation does not protect the entry', async () => {
        await seedQueue([expired('abc-123')]);
        chrome.tabs.query.mockResolvedValue([tabFor('def-456')]);

        await startupSweep();

        expect(fetchedUuids()).toEqual(['abc-123']);
        expect(await readQueue()).toEqual([]);
    });

    it('TG-3: no DeepSeek tabs -> normal deletion proceeds', async () => {
        await seedQueue([expired('abc-123')]);

        await startupSweep();

        expect(fetchedUuids()).toEqual(['abc-123']);
        expect(await readQueue()).toEqual([]);
    });

    it('TG-4: of two expired entries only the unguarded one is deleted; the guarded one persists with its refreshed lease', async () => {
        await seedQueue([expired('aaa-aaa'), expired('bbb-bbb')]);
        chrome.tabs.query.mockResolvedValue([tabFor('aaa-aaa')]);

        await startupSweep();

        expect(fetchedUuids()).toEqual(['bbb-bbb']);
        expect(await readQueue()).toEqual([{ chatUuid: 'aaa-aaa', attemptCount: 0, lastActiveAt: NOW }]);
    });

    it('TG-5: tabs.query rejection fails open -> deletion proceeds', async () => {
        await seedQueue([expired('abc-123')]);
        chrome.tabs.query.mockRejectedValue(new Error('tabs API unavailable'));

        await startupSweep();

        expect(fetchedUuids()).toEqual(['abc-123']);
        expect(await readQueue()).toEqual([]);
    });
});

describe('observation key cleanup on successful delete', () => {
    it('TG-6: after a successful delete the dss-last-seen-change:<uuid> key is gone from local storage', async () => {
        await chrome.storage.local.set({ [SEEN + 'del-uuid']: { lastActiveAt: 0, observedAt: NOW - 1 } });
        await seedQueue([expired('del-uuid')]);

        await startupSweep();

        expect(fetchedUuids()).toEqual(['del-uuid']);
        expect(await chrome.storage.local.get(SEEN + 'del-uuid')).toEqual({});
    });
});
