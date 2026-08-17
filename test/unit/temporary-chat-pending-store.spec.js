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
        it('F1: savePendingDeletes logs a warning and resolves (does not throw) when chrome.storage.sync.set rejects, and the caught error itself reaches console.warn', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const writeError = new Error('quota exceeded');
            vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(writeError);

            await expect(TemporaryChatPendingStore.savePendingDeletes([{ chatUuid: 'x', attemptCount: 0 }]))
                .resolves.toBeUndefined();

            expect(warnSpy).toHaveBeenCalled();
            // Not just "was warn called" -- the actual caught Error must be
            // among the arguments console.warn received, or the diagnostic
            // detail was silently dropped somewhere on the way there.
            const forwardedArgs = warnSpy.mock.calls.flat();
            expect(forwardedArgs).toContain(writeError);
            warnSpy.mockRestore();
        });

        it('F2: setLastAuthToken logs a warning and resolves (does not throw) when chrome.storage.local.set rejects, and the caught error itself reaches console.warn', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const writeError = new Error('quota exceeded');
            vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(writeError);

            await expect(TemporaryChatPendingStore.setLastAuthToken('Bearer tok')).resolves.toBeUndefined();

            expect(warnSpy).toHaveBeenCalled();
            const forwardedArgs = warnSpy.mock.calls.flat();
            expect(forwardedArgs).toContain(writeError);
            warnSpy.mockRestore();
        });

        it('F3: addOpenUuid logs a warning and resolves (does not throw) when chrome.storage.local.set rejects, and the caught error itself reaches console.warn', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const writeError = new Error('quota exceeded');
            vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(writeError);

            await expect(TemporaryChatPendingStore.addOpenUuid('uuid-err')).resolves.toBeUndefined();

            expect(warnSpy).toHaveBeenCalled();
            const forwardedArgs = warnSpy.mock.calls.flat();
            expect(forwardedArgs).toContain(writeError);
            warnSpy.mockRestore();
        });

        it('F4: removeOpenUuid logs a warning and resolves (does not throw) when chrome.storage.local.remove rejects, and the caught error itself reaches console.warn', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const writeError = new Error('quota exceeded');
            vi.spyOn(chrome.storage.local, 'remove').mockRejectedValueOnce(writeError);

            await expect(TemporaryChatPendingStore.removeOpenUuid('uuid-err')).resolves.toBeUndefined();

            expect(warnSpy).toHaveBeenCalled();
            const forwardedArgs = warnSpy.mock.calls.flat();
            expect(forwardedArgs).toContain(writeError);
            warnSpy.mockRestore();
        });
    });
    // ── Group G: concurrent open-set writes (regression: lost update) ───────
    // Reproduces a production incident: addOpenUuid/removeOpenUuid each did a
    // read-modify-write over the whole array with no serialization. When two
    // calls overlapped, the second write was built from a stale snapshot and
    // silently discarded the first call's effect, deleting an open conversation.
    describe('G — concurrent open-set writes (regression: lost update)', () => {
        it('G1: concurrent addOpenUuid("a") + addOpenUuid("b") from [] keeps both', async () => {
            await Promise.all([
                TemporaryChatPendingStore.addOpenUuid('a'),
                TemporaryChatPendingStore.addOpenUuid('b'),
            ]);
            const result = await TemporaryChatPendingStore.getOpenUuids();
            expect(new Set(result)).toEqual(new Set(['a', 'b']));
        });

        it('G2: concurrent removeOpenUuid("a") + addOpenUuid("b") from ["a"] loses neither op', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            await Promise.all([
                TemporaryChatPendingStore.removeOpenUuid('a'),
                TemporaryChatPendingStore.addOpenUuid('b'),
            ]);
            const result = await TemporaryChatPendingStore.getOpenUuids();
            expect(result).not.toContain('a');
            expect(result).toContain('b');
        });

        it('G3: stale read overtaking - a slow-reading operation must not clobber a faster one that finished its full cycle in between', async () => {
            // Operation A's read is artificially delayed so that operation B's
            // entire read-modify-write cycle completes BEFORE A performs its
            // write. A naive read-modify-write implementation builds A's write
            // from a stale pre-B snapshot, so A's write silently erases B's
            // effect. Both 'a' (from A) and 'b' (from B) must survive.
            const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
            let callCount = 0;
            const getSpy = vi.spyOn(chrome.storage.local, 'get').mockImplementation((keys) => {
                callCount += 1;
                if (callCount === 1) {
                    // Capture the CURRENT snapshot immediately (before B has a
                    // chance to write), but delay DELIVERING that snapshot to
                    // operation A's continuation. This lets B's whole
                    // read-modify-write cycle finish in the gap, so A resumes
                    // holding a snapshot that predates B's write.
                    const snapshotPromise = originalGet(keys);
                    return new Promise((resolve) => {
                        snapshotPromise.then((snapshot) => {
                            setTimeout(() => resolve(snapshot), 50);
                        });
                    });
                }
                return originalGet(keys);
            });

            const opA = TemporaryChatPendingStore.addOpenUuid('a');
            // Ensure operation B starts after A's read has been issued but
            // resolves (read+write) well before A's delayed read resolves.
            await new Promise((resolve) => setTimeout(resolve, 5));
            const opB = TemporaryChatPendingStore.addOpenUuid('b');

            await Promise.all([opA, opB]);
            getSpy.mockRestore();

            const result = await TemporaryChatPendingStore.getOpenUuids();
            expect(new Set(result)).toEqual(new Set(['a', 'b']));
        });

        it('G4: concurrent duplicate addOpenUuid("a") from [] results in exactly one entry', async () => {
            await Promise.all([
                TemporaryChatPendingStore.addOpenUuid('a'),
                TemporaryChatPendingStore.addOpenUuid('a'),
            ]);
            const result = await TemporaryChatPendingStore.getOpenUuids();
            expect(result).toEqual(['a']);
        });

        it('G5: concurrent removeOpenUuid of an absent uuid + addOpenUuid does not lose the add nor reject', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            await expect(Promise.all([
                TemporaryChatPendingStore.removeOpenUuid('z'),
                TemporaryChatPendingStore.addOpenUuid('b'),
            ])).resolves.toBeDefined();
            const result = await TemporaryChatPendingStore.getOpenUuids();
            expect(new Set(result)).toEqual(new Set(['a', 'b']));
        });
    });


    // Group H: per-uuid storage layout + legacy migration (new contract)
    // Storage layout is changing from ONE shared array key to ONE key per uuid
    // (prefix dss-open-temp-uuid:), specifically to eliminate the stale-read
    // lost-update class of bug reproduced in Group G. These tests assert the
    // raw underlying storage shape, not just the public getOpenUuids() view,
    // because the whole point of the fix is WHERE data physically lives.
    describe('H - per-uuid storage keys + legacy array migration', () => {
        const PREFIX = 'dss-open-temp-uuid:';

        it('H1: addOpenUuid("a") from empty storage writes exactly one new key, for "a" only', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');

            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['a']);

            const allLocal = await chrome.storage.local.get(null);
            const prefixedKeys = Object.keys(allLocal).filter(k => k.startsWith(PREFIX));
            expect(prefixedKeys).toEqual([PREFIX + 'a']);
        });

        it('H2: addOpenUuid("b") does not touch sibling "a" key', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            const before = (await chrome.storage.local.get(null))[PREFIX + 'a'];

            await TemporaryChatPendingStore.addOpenUuid('b');

            const after = (await chrome.storage.local.get(null))[PREFIX + 'a'];
            expect(after).toEqual(before);
            expect(new Set(await TemporaryChatPendingStore.getOpenUuids())).toEqual(new Set(['a', 'b']));
        });

        it('H3 (DECISIVE, regression guard): a stale-reading sibling write must not erase an already-durable entry', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');

            const staleSnapshot = {};
            const getSpy = vi.spyOn(chrome.storage.local, 'get').mockImplementationOnce(() => {
                return Promise.resolve(staleSnapshot);
            });

            await TemporaryChatPendingStore.addOpenUuid('b');
            getSpy.mockRestore();

            const result = await TemporaryChatPendingStore.getOpenUuids();
            expect(new Set(result)).toEqual(new Set(['a', 'b']));

            const allLocal = await chrome.storage.local.get(null);
            expect(allLocal[PREFIX + 'a']).toBeDefined();
            expect(allLocal[PREFIX + 'b']).toBeDefined();
        });

        it('H4: removeOpenUuid("a") removes only its own key, leaving "b"', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            await TemporaryChatPendingStore.addOpenUuid('b');

            await TemporaryChatPendingStore.removeOpenUuid('a');

            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['b']);
            const allLocal = await chrome.storage.local.get(null);
            expect(allLocal[PREFIX + 'a']).toBeUndefined();
            expect(allLocal[PREFIX + 'b']).toBeDefined();
        });

        it('H5: removeOpenUuid of an absent uuid is a no-op', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            await expect(TemporaryChatPendingStore.removeOpenUuid('does-not-exist')).resolves.toBeUndefined();
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['a']);
        });

        it('H6: duplicate addOpenUuid("a") sequentially and concurrently yields exactly one entry', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            await TemporaryChatPendingStore.addOpenUuid('a');
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['a']);

            await TemporaryChatPendingStore.clearOpenUuids();
            await Promise.all([
                TemporaryChatPendingStore.addOpenUuid('a'),
                TemporaryChatPendingStore.addOpenUuid('a'),
            ]);
            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual(['a']);
        });

        it('H7: concurrent addOpenUuid of different uuids from empty results in both present', async () => {
            await Promise.all([
                TemporaryChatPendingStore.addOpenUuid('a'),
                TemporaryChatPendingStore.addOpenUuid('b'),
            ]);
            expect(new Set(await TemporaryChatPendingStore.getOpenUuids())).toEqual(new Set(['a', 'b']));
        });

        it('H8: getOpenUuids returns the union of legacy array entries and new-style keys, de-duplicated', async () => {
            await chrome.storage.local.set({ [LOCAL_OPEN_KEY]: ['old1', 'old2'] });
            await TemporaryChatPendingStore.addOpenUuid('old1');
            await TemporaryChatPendingStore.addOpenUuid('new1');

            const result = await TemporaryChatPendingStore.getOpenUuids();
            expect(new Set(result)).toEqual(new Set(['old1', 'old2', 'new1']));
            expect(result.length).toBe(3);
        });

        it('H9: the legacy array key is never written to by add/remove operations', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            await TemporaryChatPendingStore.addOpenUuid('b');
            await TemporaryChatPendingStore.removeOpenUuid('a');
            let allLocal = await chrome.storage.local.get(null);
            expect(allLocal[LOCAL_OPEN_KEY]).toBeUndefined();

            await chrome.storage.local.set({ [LOCAL_OPEN_KEY]: ['legacy-only'] });
            const legacyBefore = (await chrome.storage.local.get(null))[LOCAL_OPEN_KEY];
            await TemporaryChatPendingStore.addOpenUuid('c');
            await TemporaryChatPendingStore.removeOpenUuid('c');
            allLocal = await chrome.storage.local.get(null);
            expect(allLocal[LOCAL_OPEN_KEY]).toEqual(legacyBefore);
        });

        it('H10: clearOpenUuids removes both the new per-uuid keys and the legacy array key', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            await TemporaryChatPendingStore.addOpenUuid('b');
            await chrome.storage.local.set({ [LOCAL_OPEN_KEY]: ['old1'] });

            await TemporaryChatPendingStore.clearOpenUuids();

            expect(await TemporaryChatPendingStore.getOpenUuids()).toEqual([]);
            const allLocal = await chrome.storage.local.get(null);
            expect(Object.keys(allLocal).some(k => k.startsWith(PREFIX))).toBe(false);
            expect(allLocal[LOCAL_OPEN_KEY]).toBeUndefined();
        });

        it('H11: addOpenUuid/removeOpenUuid with null/undefined do not throw and do not alter stored state', async () => {
            await TemporaryChatPendingStore.addOpenUuid('a');
            const before = await TemporaryChatPendingStore.getOpenUuids();

            await expect(TemporaryChatPendingStore.addOpenUuid(null)).resolves.toBeUndefined();
            await expect(TemporaryChatPendingStore.addOpenUuid(undefined)).resolves.toBeUndefined();
            await expect(TemporaryChatPendingStore.removeOpenUuid(null)).resolves.toBeUndefined();
            await expect(TemporaryChatPendingStore.removeOpenUuid(undefined)).resolves.toBeUndefined();

            expect(new Set(await TemporaryChatPendingStore.getOpenUuids())).toEqual(new Set(before));
        });
    });

});
