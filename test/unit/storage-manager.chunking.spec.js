import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

/**
 * Chunking behavior tests for the chatPresetMap implementation.
 *
 * NOTE on module-level state bleed:
 * The write queue (_chatPresetMapChainTail) and chunk caches (_metaCache,
 * _chunkIndexCache) are module-level and persist across tests. To avoid
 * cascading timeouts from a previous test's pending queue operations,
 * each test uses explicit timeouts where needed and entry counts that
 * comfortably fit within the serialized queue throughput.
 *
 * With 200-char preset values, ~34 entries fill one 7168-byte chunk.
 */

const LARGE_VALUE = (i) => 'D'.repeat(200) + String(i);

describe('StorageManager chunked chatPresetMap', () => {
    beforeEach(() => {
        // Storage is cleared by vitest.setup.js beforeEach
    });

    describe('1. Auto-split on overflow', () => {
        it('inserts 80 entries with 200-char values overflowing multiple 7168-byte chunks and verifies all are retrievable',
            { timeout: 30000 },
            async () => {
                const COUNT = 80;
                const promises = [];
                for (let i = 0; i < COUNT; i++) {
                    const uuid = `uuid-${String(i).padStart(3, '0')}`;
                    promises.push(StorageManager.bindChatToPreset(uuid, LARGE_VALUE(i)));
                }
                await Promise.all(promises);

                // All entries returned via getChatPresetMap
                const map = await StorageManager.getChatPresetMap();
                expect(Object.keys(map)).toHaveLength(COUNT);
                for (let i = 0; i < COUNT; i++) {
                    const uuid = `uuid-${String(i).padStart(3, '0')}`;
                    expect(map[uuid]).toBe(LARGE_VALUE(i));
                }

                // Multiple chunk keys exist in storage
                const syncData = await chrome.storage.sync.get(null);
                const meta = syncData.chatPresetMapMeta;
                expect(meta).toBeDefined();
                expect(meta.chunkCount).toBeGreaterThan(1);

                // Total entries across all chunks matches COUNT
                let totalEntries = 0;
                for (let i = 0; i < meta.chunkCount; i++) {
                    const chunk = syncData[`chatPresetMap_${i}`] || {};
                    totalEntries += Object.keys(chunk).length;
                }
                expect(totalEntries).toBe(COUNT);
            },
        );
    });

    describe('2. UUID uniqueness across chunks', () => {
        it('inserts many entries and verifies no UUID appears in more than one chunk',
            { timeout: 30000 },
            async () => {
                const COUNT = 80;
                const promises = [];
                for (let i = 0; i < COUNT; i++) {
                    const uuid = `uuid-${String(i).padStart(3, '0')}`;
                    promises.push(StorageManager.bindChatToPreset(uuid, LARGE_VALUE(i)));
                }
                await Promise.all(promises);

                const syncData = await chrome.storage.sync.get(null);
                const meta = syncData.chatPresetMapMeta;
                expect(meta).toBeDefined();
                expect(meta.chunkCount).toBeGreaterThan(1);

                // Build uuid -> [chunk indices] map from raw storage
                const uuidToChunks = {};
                for (let i = 0; i < meta.chunkCount; i++) {
                    const chunk = syncData[`chatPresetMap_${i}`] || {};
                    for (const uuid of Object.keys(chunk)) {
                        if (!uuidToChunks[uuid]) uuidToChunks[uuid] = [];
                        uuidToChunks[uuid].push(i);
                    }
                }

                // Each UUID must appear in exactly one chunk
                for (const [uuid, chunks] of Object.entries(uuidToChunks)) {
                    expect(chunks,
                        `UUID ${uuid} appears in ${chunks.length} chunks: ${JSON.stringify(chunks)}`,
                    ).toHaveLength(1);
                }
            },
        );
    });

    describe('3. In-place update stays in same chunk', () => {
        it('rebinds an existing UUID and confirms it stays in the same chunk with the new value',
            async () => {
                const FIRST_VAL = 'A'.repeat(100);
                const SECOND_VAL = 'B'.repeat(100);

                await StorageManager.bindChatToPreset('uuid-1', FIRST_VAL);

                // Identify which chunk uuid-1 landed in
                let syncData = await chrome.storage.sync.get(null);
                const metaBefore = syncData.chatPresetMapMeta;
                const chunkKey = `chatPresetMap_${metaBefore.chunkCount - 1}`;
                expect(syncData[chunkKey]).toBeDefined();
                expect(syncData[chunkKey]['uuid-1']).toBe(FIRST_VAL);

                // Rebind to a different value
                await StorageManager.bindChatToPreset('uuid-1', SECOND_VAL);

                // Same number of chunks, same chunk, new value
                syncData = await chrome.storage.sync.get(null);
                const metaAfter = syncData.chatPresetMapMeta;
                expect(metaAfter.chunkCount).toBe(metaBefore.chunkCount);
                expect(syncData[chunkKey]['uuid-1']).toBe(SECOND_VAL);

                // uuid-1 appears in exactly one chunk
                const uuidCounts = {};
                for (let i = 0; i < metaAfter.chunkCount; i++) {
                    const chunk = syncData[`chatPresetMap_${i}`] || {};
                    for (const uuid of Object.keys(chunk)) {
                        uuidCounts[uuid] = (uuidCounts[uuid] || 0) + 1;
                    }
                }
                expect(uuidCounts['uuid-1']).toBe(1);
            },
        );
    });

    describe('4. Trailing empty chunk trimming', () => {
        it('empties the last chunk via unbind and verifies chunkCount decreases and orphaned keys are removed',
            { timeout: 30000 },
            async () => {
                const COUNT = 80;
                const promises = [];
                for (let i = 0; i < COUNT; i++) {
                    const uuid = `uuid-${String(i).padStart(3, '0')}`;
                    promises.push(StorageManager.bindChatToPreset(uuid, LARGE_VALUE(i)));
                }
                await Promise.all(promises);

                let syncData = await chrome.storage.sync.get(null);
                const meta = syncData.chatPresetMapMeta;
                const originalChunkCount = meta.chunkCount;
                expect(originalChunkCount).toBeGreaterThanOrEqual(2);

                // Identify UUIDs in the last chunk
                const lastChunkIdx = originalChunkCount - 1;
                const lastChunk = syncData[`chatPresetMap_${lastChunkIdx}`] || {};
                const lastChunkUuids = Object.keys(lastChunk);
                expect(lastChunkUuids.length).toBeGreaterThan(0);

                // Unbind all UUIDs from the last chunk
                for (const uuid of lastChunkUuids) {
                    await StorageManager.unbindChat(uuid);
                }

                // Verify state after trimming
                syncData = await chrome.storage.sync.get(null);
                const newMeta = syncData.chatPresetMapMeta;

                // chunkCount decreased
                expect(newMeta.chunkCount).toBeLessThan(originalChunkCount);

                // Orphaned chunk keys removed from storage
                for (let i = newMeta.chunkCount; i < originalChunkCount; i++) {
                    expect(syncData[`chatPresetMap_${i}`]).toBeUndefined();
                }

                // Remaining entries are all from earlier chunks
                const map = await StorageManager.getChatPresetMap();
                expect(Object.keys(map).length).toBe(COUNT - lastChunkUuids.length);
                for (const uuid of Object.keys(map)) {
                    expect(lastChunkUuids).not.toContain(uuid);
                }
            },
        );
    });

    describe('5. Non-trailing empty chunk persists', () => {
        it('empties a middle chunk and verifies chunkCount stays the same and the chunk key still exists',
            { timeout: 30000 },
            async () => {
                const COUNT = 80;
                const promises = [];
                for (let i = 0; i < COUNT; i++) {
                    const uuid = `uuid-${String(i).padStart(3, '0')}`;
                    promises.push(StorageManager.bindChatToPreset(uuid, LARGE_VALUE(i)));
                }
                await Promise.all(promises);

                let syncData = await chrome.storage.sync.get(null);
                const meta = syncData.chatPresetMapMeta;
                const originalChunkCount = meta.chunkCount;
                expect(originalChunkCount).toBeGreaterThanOrEqual(3);

                // Pick a middle chunk (not the last)
                const middleChunkIdx = Math.floor(originalChunkCount / 2);
                const middleChunk = syncData[`chatPresetMap_${middleChunkIdx}`] || {};
                const middleChunkUuids = Object.keys(middleChunk);
                expect(middleChunkUuids.length).toBeGreaterThan(0);

                // Unbind all UUIDs from the middle chunk
                for (const uuid of middleChunkUuids) {
                    await StorageManager.unbindChat(uuid);
                }

                // Verify state
                syncData = await chrome.storage.sync.get(null);
                const newMeta = syncData.chatPresetMapMeta;

                // chunkCount unchanged (trailing chunk still has entries)
                expect(newMeta.chunkCount).toBe(originalChunkCount);

                // Middle chunk key still exists
                const middleChunkAfter = syncData[`chatPresetMap_${middleChunkIdx}`];
                expect(middleChunkAfter).toBeDefined();

                // All other entries are intact (none from the middle chunk)
                const map = await StorageManager.getChatPresetMap();
                const middleUuidSet = new Set(middleChunkUuids);
                expect(Object.keys(map).length).toBe(COUNT - middleChunkUuids.length);
                for (const uuid of Object.keys(map)) {
                    expect(middleUuidSet.has(uuid)).toBe(false);
                }
            },
        );
    });

    describe('6. mutateChatPresetMap whole-map rebalance', () => {
        it('replaces a large multi-chunk map with a small one and verifies chunkCount collapses',
            { timeout: 30000 },
            async () => {
                const COUNT = 35;
                const promises = [];
                for (let i = 0; i < COUNT; i++) {
                    const uuid = `uuid-${String(i).padStart(3, '0')}`;
                    promises.push(StorageManager.bindChatToPreset(uuid, LARGE_VALUE(i)));
                }
                await Promise.all(promises);

                // Verify we actually have multiple chunks
                let syncData = await chrome.storage.sync.get(null);
                expect(syncData.chatPresetMapMeta.chunkCount).toBeGreaterThan(1);

                // Replace with 5 entries via mutateChatPresetMap (returning new object)
                const smallMap = {
                    'keep-a': 'val-a',
                    'keep-b': 'val-b',
                    'keep-c': 'val-c',
                    'keep-d': 'val-d',
                    'keep-e': 'val-e',
                };
                await StorageManager.mutateChatPresetMap(() => smallMap);

                // Map has exactly 5 entries
                const result = await StorageManager.getChatPresetMap();
                expect(Object.keys(result)).toHaveLength(5);
                for (const [k, v] of Object.entries(smallMap)) {
                    expect(result[k]).toBe(v);
                }

                // chunkCount collapsed to 1
                syncData = await chrome.storage.sync.get(null);
                expect(syncData.chatPresetMapMeta.chunkCount).toBe(1);
            },
        );
    });

    describe('7. mutateChatPresetMap affinity preservation', () => {
        it('deletes one entry and adds one via mutateChatPresetMap; unchanged UUIDs remain', async () => {
            await StorageManager.bindChatToPreset('keep-1', 'val-1');
            await StorageManager.bindChatToPreset('keep-2', 'val-2');
            await StorageManager.bindChatToPreset('delete-me', 'old-val');

            await StorageManager.mutateChatPresetMap((map) => {
                delete map['delete-me'];
                map['new-entry'] = 'new-val';
            });

            const map = await StorageManager.getChatPresetMap();
            expect(map['keep-1']).toBe('val-1');
            expect(map['keep-2']).toBe('val-2');
            expect(map['delete-me']).toBeUndefined();
            expect(map['new-entry']).toBe('new-val');

            const syncData = await chrome.storage.sync.get(null);
            const meta = syncData.chatPresetMapMeta;
            let totalUuids = 0;
            for (let i = 0; i < meta.chunkCount; i++) {
                const chunk = syncData[`chatPresetMap_${i}`] || {};
                totalUuids += Object.keys(chunk).length;
            }
            expect(totalUuids).toBe(3);
        });
    });

    describe('8. getChatPresetMap returns merged view', () => {
        it('populates entries across multiple chunks and verifies getChatPresetMap returns the full merged map',
            { timeout: 30000 },
            async () => {
                const COUNT = 80;
                const promises = [];
                for (let i = 0; i < COUNT; i++) {
                    const uuid = `uuid-${String(i).padStart(3, '0')}`;
                    promises.push(StorageManager.bindChatToPreset(uuid, LARGE_VALUE(i)));
                }
                await Promise.all(promises);

                // Verify storage has multiple chunks
                const syncData = await chrome.storage.sync.get(null);
                const meta = syncData.chatPresetMapMeta;
                expect(meta.chunkCount).toBeGreaterThan(1);

                // getChatPresetMap returns the complete merged map
                const map = await StorageManager.getChatPresetMap();
                expect(Object.keys(map)).toHaveLength(COUNT);
                for (let i = 0; i < COUNT; i++) {
                    const uuid = `uuid-${String(i).padStart(3, '0')}`;
                    expect(map[uuid]).toBe(LARGE_VALUE(i));
                }
            },
        );
    });

    describe('9. getSettings().chatPresetMap uses chunked layout', () => {
        it('creates bindings and verifies settings.chatPresetMap contains all entries', async () => {
            await StorageManager.bindChatToPreset('alpha', 'preset-a');
            await StorageManager.bindChatToPreset('beta', 'preset-b');
            await StorageManager.bindChatToPreset('gamma', 'preset-c');

            const settings = await StorageManager.getSettings();
            expect(settings.chatPresetMap).toEqual({
                alpha: 'preset-a',
                beta: 'preset-b',
                gamma: 'preset-c',
            });
        });
    });

    describe('10. Map consistency after sequential operations', () => {
        it('performs bind/re-bind/unbind/mutate in sequence and verifies map correctness after each step',
            async () => {
                // Step 1: bind uuid-1
                await StorageManager.bindChatToPreset('uuid-1', 'preset-a');
                let map = await StorageManager.getChatPresetMap();
                expect(map).toEqual({ 'uuid-1': 'preset-a' });

                // Step 2: bind uuid-2
                await StorageManager.bindChatToPreset('uuid-2', 'preset-b');
                map = await StorageManager.getChatPresetMap();
                expect(map).toEqual({ 'uuid-1': 'preset-a', 'uuid-2': 'preset-b' });

                // Step 3: re-bind uuid-1 (in-place update)
                await StorageManager.bindChatToPreset('uuid-1', 'preset-a-v2');
                map = await StorageManager.getChatPresetMap();
                expect(map).toEqual({ 'uuid-1': 'preset-a-v2', 'uuid-2': 'preset-b' });

                // Step 4: unbind uuid-1
                await StorageManager.unbindChat('uuid-1');
                map = await StorageManager.getChatPresetMap();
                expect(map).toEqual({ 'uuid-2': 'preset-b' });

                // Step 5: bind uuid-3
                await StorageManager.bindChatToPreset('uuid-3', 'preset-c');
                map = await StorageManager.getChatPresetMap();
                expect(map).toEqual({ 'uuid-2': 'preset-b', 'uuid-3': 'preset-c' });

                // Step 6: mutateChatPresetMap deletes uuid-2, adds uuid-4
                await StorageManager.mutateChatPresetMap((m) => {
                    delete m['uuid-2'];
                    m['uuid-4'] = 'preset-d';
                });
                map = await StorageManager.getChatPresetMap();
                expect(map).toEqual({ 'uuid-3': 'preset-c', 'uuid-4': 'preset-d' });

                // Final consistency check: no UUID appears in multiple chunks
                const syncData = await chrome.storage.sync.get(null);
                const meta = syncData.chatPresetMapMeta;
                if (meta && meta.chunkCount > 0) {
                    const uuidCounts = {};
                    for (let i = 0; i < meta.chunkCount; i++) {
                        const chunk = syncData[`chatPresetMap_${i}`] || {};
                        for (const uuid of Object.keys(chunk)) {
                            uuidCounts[uuid] = (uuidCounts[uuid] || 0) + 1;
                        }
                    }
                    for (const [uuid, count] of Object.entries(uuidCounts)) {
                        expect(count, `UUID ${uuid} appears in ${count} chunks`).toBe(1);
                    }
                }
            },
        );
    });

    describe('11. version monotonicity', () => {
        /**
         * Module-level state (_metaCache, _chunkIndexCache) bleeds from tests 1–10
         * and also across tests within this block (each test mutates the same SM
         * instance).  We reset the module registry before EVERY test so that each
         * test runs with a fresh StorageManager instance and clean internal caches.
         */
        let SM;

        beforeEach(async () => {
            vi.resetModules();
            const mod = await import('../../utils/storage-manager.js');
            SM = mod.default ?? mod;
        });

        it('bind bumps version by exactly 1',
            async () => {
                const metaBefore = await chrome.storage.sync.get('chatPresetMapMeta');
                const versionBefore = metaBefore.chatPresetMapMeta?.version ?? 0;

                await SM.bindChatToPreset('vm-uuid-1', 'preset-a');

                const metaAfter = await chrome.storage.sync.get('chatPresetMapMeta');
                expect(metaAfter.chatPresetMapMeta.version).toBe(versionBefore + 1);
            },
        );

        it('unbind bumps version by exactly 1',
            async () => {
                await SM.bindChatToPreset('vm-uuid-2', 'preset-a');
                const metaAfterBind = await chrome.storage.sync.get('chatPresetMapMeta');
                const versionAfterBind = metaAfterBind.chatPresetMapMeta.version;

                await SM.unbindChat('vm-uuid-2');

                const metaAfterUnbind = await chrome.storage.sync.get('chatPresetMapMeta');
                expect(metaAfterUnbind.chatPresetMapMeta.version).toBe(versionAfterBind + 1);
            },
        );

        it('mutate bumps version by exactly 1',
            async () => {
                await SM.bindChatToPreset('vm-uuid-3', 'preset-a');
                const metaBefore = await chrome.storage.sync.get('chatPresetMapMeta');
                const versionBefore = metaBefore.chatPresetMapMeta.version;

                await SM.mutateChatPresetMap(m => { m['vm-uuid-4'] = 'preset-b'; });

                const metaAfter = await chrome.storage.sync.get('chatPresetMapMeta');
                expect(metaAfter.chatPresetMapMeta.version).toBe(versionBefore + 1);
            },
        );

        it('Sequential writes produce strictly increasing version',
            { timeout: 15000 },
            async () => {
                let meta = await chrome.storage.sync.get('chatPresetMapMeta');
                let prevVersion = meta.chatPresetMapMeta?.version ?? 0;
                const operations = [
                    () => SM.bindChatToPreset('vm-seq-1', 'preset-a'),
                    () => SM.bindChatToPreset('vm-seq-2', 'preset-b'),
                    () => SM.mutateChatPresetMap(m => { m['vm-seq-3'] = 'preset-c'; }),
                    () => SM.bindChatToPreset('vm-seq-4', 'preset-d'),
                    () => SM.unbindChat('vm-seq-1'),
                    () => SM.mutateChatPresetMap(m => { delete m['vm-seq-2']; }),
                    () => SM.bindChatToPreset('vm-seq-5', 'preset-e'),
                    () => SM.unbindChat('vm-seq-4'),
                    () => SM.bindChatToPreset('vm-seq-6', 'preset-f'),
                    () => SM.mutateChatPresetMap(m => { m['vm-seq-7'] = 'preset-g'; }),
                ];

                for (const op of operations) {
                    await op();
                    meta = await chrome.storage.sync.get('chatPresetMapMeta');
                    const newVersion = meta.chatPresetMapMeta?.version ?? 0;
                    expect(newVersion).toBe(prevVersion + 1);
                    prevVersion = newVersion;
                }
            },
        );

        it('No-op bind (same uuid, same value) does NOT bump version',
            async () => {
                await SM.bindChatToPreset('vm-nop-1', 'preset-a');
                const metaAfterFirst = await chrome.storage.sync.get('chatPresetMapMeta');
                const versionAfterFirst = metaAfterFirst.chatPresetMapMeta.version;

                await SM.bindChatToPreset('vm-nop-1', 'preset-a');

                const metaAfterSecond = await chrome.storage.sync.get('chatPresetMapMeta');
                expect(metaAfterSecond.chatPresetMapMeta.version).toBe(versionAfterFirst);
            },
        );

        it('No-op unbind (uuid not present) does NOT bump version',
            async () => {
                const metaBefore = await chrome.storage.sync.get('chatPresetMapMeta');
                const versionBefore = metaBefore.chatPresetMapMeta?.version ?? 0;

                await SM.unbindChat('vm-nonexistent');

                const metaAfter = await chrome.storage.sync.get('chatPresetMapMeta');
                expect(metaAfter.chatPresetMapMeta?.version ?? 0).toBe(versionBefore);
            },
        );

        it('No-op mutate (mutator changes nothing) does NOT bump version',
            async () => {
                await SM.bindChatToPreset('vm-nop-2', 'preset-a');
                const metaBefore = await chrome.storage.sync.get('chatPresetMapMeta');
                const versionBefore = metaBefore.chatPresetMapMeta.version;

                await SM.mutateChatPresetMap(map => {});

                const metaAfter = await chrome.storage.sync.get('chatPresetMapMeta');
                expect(metaAfter.chatPresetMapMeta.version).toBe(versionBefore);
            },
        );

        it('mutate that only changes a value (equal byte length) still bumps version',
            async () => {
                await SM.bindChatToPreset('vm-nop-3', 'AAA');
                const metaBefore = await chrome.storage.sync.get('chatPresetMapMeta');
                const versionBefore = metaBefore.chatPresetMapMeta.version;

                await SM.mutateChatPresetMap(m => { m['vm-nop-3'] = 'BBB'; });

                const metaAfter = await chrome.storage.sync.get('chatPresetMapMeta');
                expect(metaAfter.chatPresetMapMeta.version).toBe(versionBefore + 1);
            },
        );

        it('bindChatToPreset insert path issues at most 1 chunk read (for M1)',
            async () => {
                for (let i = 0; i < 10; i++) {
                    await SM.bindChatToPreset(`vm-spy-${i}`, 'X');
                }

                const syncData = await chrome.storage.sync.get(null);
                expect(syncData.chatPresetMapMeta.chunkCount).toBe(1);

                const spy = vi.spyOn(chrome.storage.sync, 'get');

                await SM.bindChatToPreset('vm-spy-new', 'X');

                let totalChunkKeysRead = 0;
                for (const call of spy.mock.calls) {
                    const keys = call[0];
                    if (Array.isArray(keys)) {
                        totalChunkKeysRead += keys.filter(k => typeof k === 'string' && k.startsWith('chatPresetMap_')).length;
                    } else if (typeof keys === 'string' && keys.startsWith('chatPresetMap_')) {
                        totalChunkKeysRead++;
                    }
                }

                expect(totalChunkKeysRead).toBeLessThanOrEqual(1);

                spy.mockRestore();
            },
        );

    });

    describe('12. Hot-path lock-avoidance', () => {
        let SM;
        const LOCK_KEY = 'chatPresetMapLock';

        beforeEach(async () => {
            vi.resetModules();
            const mod = await import('../../utils/storage-manager.js');
            SM = mod.default ?? mod;
        });

        it('bindChatToPreset single-chunk in-place — lock key untouched', async () => {
            // Create initial binding
            await SM.bindChatToPreset('uuid-test', 'preset-a');

            const safeGetSpy = vi.spyOn(SM, '_safeGet');
            const safeSetSpy = vi.spyOn(SM, '_safeSet');

            // In-place update (same uuid, new value)
            await SM.bindChatToPreset('uuid-test', 'preset-b');

            const lockGetCalls = safeGetSpy.mock.calls.filter(
                ([area, keys]) => {
                    if (area !== 'local') return false;
                    const keyArr = Array.isArray(keys) ? keys : [keys];
                    return keyArr.includes(LOCK_KEY);
                },
            );
            const lockSetCalls = safeSetSpy.mock.calls.filter(
                ([area, items]) => area === 'local' && items && LOCK_KEY in items,
            );

            expect(lockGetCalls).toHaveLength(0);
            expect(lockSetCalls).toHaveLength(0);
        });

        it('unbindChat non-trailing — lock key untouched', async () => {
            // Create multiple bindings in one chunk
            await SM.bindChatToPreset('uuid-a', 'preset-a');
            await SM.bindChatToPreset('uuid-b', 'preset-b');
            await SM.bindChatToPreset('uuid-c', 'preset-c');

            const safeGetSpy = vi.spyOn(SM, '_safeGet');
            const safeSetSpy = vi.spyOn(SM, '_safeSet');

            // Unbind a non-trailing entry (uuid-a)
            await SM.unbindChat('uuid-a');

            const lockGetCalls = safeGetSpy.mock.calls.filter(
                ([area, keys]) => {
                    if (area !== 'local') return false;
                    const keyArr = Array.isArray(keys) ? keys : [keys];
                    return keyArr.includes(LOCK_KEY);
                },
            );
            const lockSetCalls = safeSetSpy.mock.calls.filter(
                ([area, items]) => area === 'local' && items && LOCK_KEY in items,
            );

            expect(lockGetCalls).toHaveLength(0);
            expect(lockSetCalls).toHaveLength(0);
        });
    });

});
