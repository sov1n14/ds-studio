import { describe, it, expect, beforeEach, vi } from 'vitest';
import TemporaryChatPendingStore from '../../content/temporary-chat-pending-store.js';

const SYNC_KEY = 'dss-pending-deletes-sync';
const LOCAL_OPEN_KEY = 'dss-open-temp-uuids';
const LOCAL_TOKEN_KEY = 'dss-last-auth-token';

describe('TemporaryChatPendingStore', () => {
    beforeEach(() => {
        // Global beforeEach in vitest.setup.js already clears both storage areas.
        vi.restoreAllMocks();
    });

    // ── Group A: pending-delete sync queue ──────────────────────────────────
    describe('A — pending-delete sync queue', () => {
        it('A1: addPendingDelete writes {chatUuid, attemptCount:0}', async () => {
            await TemporaryChatPendingStore.addPendingDelete('uuid-1');
            const queue = await TemporaryChatPendingStore.getPendingDeletes();
            expect(queue).toEqual([{ chatUuid: 'uuid-1', attemptCount: 0 }]);
        });

        it('A2: addPendingDelete is idempotent (no dup on repeat)', async () => {
            await TemporaryChatPendingStore.addPendingDelete('uuid-1');
            await TemporaryChatPendingStore.addPendingDelete('uuid-1');
            const queue = await TemporaryChatPendingStore.getPendingDeletes();
            expect(queue).toHaveLength(1);
        });

        it('A3: removePendingDelete removes only the matching uuid', async () => {
            await TemporaryChatPendingStore.addPendingDelete('uuid-1');
            await TemporaryChatPendingStore.addPendingDelete('uuid-2');
            await TemporaryChatPendingStore.removePendingDelete('uuid-1');
            const queue = await TemporaryChatPendingStore.getPendingDeletes();
            expect(queue).toEqual([{ chatUuid: 'uuid-2', attemptCount: 0 }]);
        });

        it('A4: removePendingDelete is a no-op when uuid is absent', async () => {
            await TemporaryChatPendingStore.addPendingDelete('uuid-1');
            await TemporaryChatPendingStore.removePendingDelete('does-not-exist');
            const queue = await TemporaryChatPendingStore.getPendingDeletes();
            expect(queue).toEqual([{ chatUuid: 'uuid-1', attemptCount: 0 }]);
        });

        it('A5: getPendingDeletes returns [] when key is absent', async () => {
            const queue = await TemporaryChatPendingStore.getPendingDeletes();
            expect(queue).toEqual([]);
        });
    });

    // ── Group B: open-set (local) ────────────────────────────────────────────
    describe('B — open-set (chrome.storage.local)', () => {
        it('B1: addOpenUuid adds a uuid', async () => {
            await TemporaryChatPendingStore.addOpenUuid('uuid-a');
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['uuid-a']);
        });

        it('B2: addOpenUuid is idempotent', async () => {
            await TemporaryChatPendingStore.addOpenUuid('uuid-a');
            await TemporaryChatPendingStore.addOpenUuid('uuid-a');
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['uuid-a']);
        });

        it('B3: removeOpenUuid removes only the matching uuid', async () => {
            await TemporaryChatPendingStore.addOpenUuid('uuid-a');
            await TemporaryChatPendingStore.addOpenUuid('uuid-b');
            await TemporaryChatPendingStore.removeOpenUuid('uuid-a');
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['uuid-b']);
        });

        it('B4: removeOpenUuid is a no-op when uuid is absent', async () => {
            await TemporaryChatPendingStore.addOpenUuid('uuid-a');
            await TemporaryChatPendingStore.removeOpenUuid('does-not-exist');
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['uuid-a']);
        });

        it('B5: clearOpenUuids empties the set', async () => {
            await TemporaryChatPendingStore.addOpenUuid('uuid-a');
            await TemporaryChatPendingStore.clearOpenUuids();
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual([]);
        });

        it('B6: getOpenUuids returns [] when key is absent', async () => {
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual([]);
        });
    });

    // ── Group C: last-auth-token (local) ─────────────────────────────────────
    describe('C — last-auth-token (chrome.storage.local)', () => {
        it('C1: setLastAuthToken/getLastAuthToken round-trip', async () => {
            await TemporaryChatPendingStore.setLastAuthToken('Bearer abc');
            expect(await TemporaryChatPendingStore.getLastAuthToken()).toBe('Bearer abc');
        });

        it('C2: getLastAuthToken returns null when absent', async () => {
            expect(await TemporaryChatPendingStore.getLastAuthToken()).toBeNull();
        });

        it('C3: setLastAuthToken is a no-op on falsy token', async () => {
            await TemporaryChatPendingStore.setLastAuthToken('Bearer abc');
            await TemporaryChatPendingStore.setLastAuthToken(null);
            expect(await TemporaryChatPendingStore.getLastAuthToken()).toBe('Bearer abc');
        });
    });

    // ── Group D: trackForDeletion ordering ───────────────────────────────────
    describe('D — trackForDeletion ordering', () => {
        it('D1: uuid ends up present in BOTH the local open-set and the sync queue', async () => {
            await TemporaryChatPendingStore.trackForDeletion('uuid-track');
            expect(await TemporaryChatPendingStore.getOpenUuids()).toContain('uuid-track');
            const queue = await TemporaryChatPendingStore.getPendingDeletes();
            expect(queue.map(i => i.chatUuid)).toContain('uuid-track');
        });

        it('D2: chrome.storage.local.set (open-set) is called before chrome.storage.sync.set (pending queue)', async () => {
            const callOrder = [];
            const origLocalSet = chrome.storage.local.set.bind(chrome.storage.local);
            const origSyncSet = chrome.storage.sync.set.bind(chrome.storage.sync);
            const localSetSpy = vi.spyOn(chrome.storage.local, 'set').mockImplementation((items) => {
                callOrder.push('local');
                return origLocalSet(items);
            });
            const syncSetSpy = vi.spyOn(chrome.storage.sync, 'set').mockImplementation((items) => {
                callOrder.push('sync');
                return origSyncSet(items);
            });

            await TemporaryChatPendingStore.trackForDeletion('uuid-order');

            expect(callOrder.indexOf('local')).toBeLessThan(callOrder.indexOf('sync'));

            localSetSpy.mockRestore();
            syncSetSpy.mockRestore();
        });
    });

    // ── Group E: privacy — no token ever reaches sync storage ────────────────
    describe('E — privacy: sync storage never contains the auth token', () => {
        it('E1: after trackForDeletion + setLastAuthToken, sync store contains only {chatUuid, attemptCount}', async () => {
            await TemporaryChatPendingStore.trackForDeletion('uuid-priv');
            await TemporaryChatPendingStore.setLastAuthToken('Bearer super-secret-token');

            const syncData = await chrome.storage.sync.get(null);
            const queue = syncData[SYNC_KEY];
            expect(Array.isArray(queue)).toBe(true);
            queue.forEach((entry) => {
                expect(Object.keys(entry).sort()).toEqual(['attemptCount', 'chatUuid']);
            });

            // Deep-scan the whole sync store for the token string — must never appear.
            const syncDump = JSON.stringify(syncData);
            expect(syncDump).not.toContain('super-secret-token');
            expect(syncDump).not.toContain('authToken');
            expect(syncDump.toLowerCase()).not.toContain('"token"');
        });
    });

    // ── Group F: write-error resilience ──────────────────────────────────────
    describe('F — write-error resilience', () => {
        it('F1: savePendingDeletes logs a warning and resolves (does not throw) when chrome.storage.sync.set rejects', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(new Error('quota exceeded'));

            await expect(TemporaryChatPendingStore.savePendingDeletes([{ chatUuid: 'x', attemptCount: 0 }]))
                .resolves.toBeUndefined();

            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('F2: setLastAuthToken logs a warning and resolves (does not throw) when chrome.storage.local.set rejects', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('quota exceeded'));

            await expect(TemporaryChatPendingStore.setLastAuthToken('Bearer tok')).resolves.toBeUndefined();

            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('F3: addOpenUuid logs a warning and resolves (does not throw) when chrome.storage.local.set rejects', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('quota exceeded'));

            await expect(TemporaryChatPendingStore.addOpenUuid('uuid-err')).resolves.toBeUndefined();

            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });
});
