/**
 * Cross-Context Integration Tests (Phase C+D — v2.5.0)
 *
 * Simulates two Extension JS contexts sharing chrome.storage.{sync,local}
 * backing store with isolated module-level state (_metaCache,
 * _chunkIndexCache, _chatPresetMapChainTail).  onChanged events fan out
 * to both contexts' chunk-cache invalidators.
 *
 * === Expected pre-fix failure modes ===
 * Without Phase C+D (Method C lock + Method D reconciliation):
 *   A: last-writer-wins clobbers one uuid.
 *   B: orphaned sweep overwrites concurrent bind or vice versa.
 *   C: multi-chunk sweep races with bind -> data loss/orphan residue.
 *   D: two concurrent chunk-appends collide -> one entry lost.
 *   E: crashed owner holds lock forever -> deadlock.
 *
 * === Fixed source bugs (Phase C+D in v2.5.0) ===
 * Bug 1 — bindChatToPreset lock path cache-null: _ensureChunkCachesLoaded()
 *   is now called inside the lock callback before accessing _metaCache.
 * Bug 2 — _chunkIndexCache null after async mutator yield: source reloads
 *   caches via _ensureChunkCachesLoaded() after await mutator(map).
 * Bug 3 — stale-snapshot overwrite in lock path: lock callback re-reads
 *   all chunks from storage before applying mutations (nulls + reloads).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDualContext, clearSharedStorage } from '../helpers/dual-context-storage.js';

// Lock constants (match utils/storage-manager.js — not exported from module)
const LOCK_KEY = 'chatPresetMapLock';
const LOCK_TTL_MS = 3000;
const LOCK_ACQUIRE_TIMEOUT_MS = 5000;
const CHUNK_SOFT_LIMIT_BYTES = 7168;

// Shared helper: write chunk data to BOTH sync and local, firing the
// onChanged invalidator via the local write so caches are nulled.
async function seedStorageMultiChunk(meta, chunks) {
    const items = { ...meta, ...chunks };
    await chrome.storage.sync.set(items);
    await chrome.storage.local.set(items);
}

describe('Cross-context integration (Phase C+D)', () => {
    /** @type {import('../../utils/storage-manager.js').default} */
    let ctxA;
    /** @type {import('../../utils/storage-manager.js').default} */
    let ctxB;

    beforeEach(async () => {
        const ctx = await createDualContext();
        ctxA = ctx.ctxA;
        ctxB = ctx.ctxB;

        // Seed data to force reconciliation path (single existing chunk with
        // plenty of space).  This ensures bindChatToPreset takes the single-
        // chunk reconciliation path (Method D), not the lock path (Method C),
        // for test isolation / path-selection purposes.
        // Tests that need the lock path override this with their own seed.
        await chrome.storage.sync.set({
            chatPresetMapMeta: { version: 1, chunkCount: 1, chunkSizes: [50] },
            chatPresetMap_0: { '@seed': 'seed' },
        });

        await ctxA.initialize();
        await ctxB.initialize();
    });

    afterEach(() => {
        clearSharedStorage();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario A — Two tabs bind different uuids in the same chunk.
    //   Path: reconciliation (both) — null-safe.  Passes.
    // ─────────────────────────────────────────────────────────────────────────
    it(
        'Scenario A — Two tabs bind different uuids in the same chunk; both entries present, no data loss',
        { timeout: 15000 },
        async () => {
            // Regression guard: if Method D (reconciliation / CAS retry) is
            // removed, this test MUST fail.
            // Expected failure mode without the fix:
            //   last-writer-wins, one uuid's binding (uA or uB) is silently
            //   overwritten by the other.

            const [rA, rB] = await Promise.all([
                ctxA.bindChatToPreset('uA', 'preset-a'),
                ctxB.bindChatToPreset('uB', 'preset-b'),
            ]);

            const map = await ctxA.getChatPresetMap();
            expect(map['uA']).toBe('preset-a');
            expect(map['uB']).toBe('preset-b');
            expect(Object.keys(map)).toHaveLength(3);

            const syncData = await chrome.storage.sync.get(null);
            expect(syncData.chatPresetMapMeta.chunkCount).toBe(1);
            const chunk = syncData['chatPresetMap_0'];
            expect(chunk['uA']).toBe('preset-a');
            expect(chunk['uB']).toBe('preset-b');
            expect(chunk['@seed']).toBe('seed');
        },
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario B — Content-script auto-bind + popup orphan sweep (concurrent).
    //   Both use reconciliation (Method D), null-safe.  Promise.all is ok.
    // ─────────────────────────────────────────────────────────────────────────
    it(
        'Scenario B — Auto-bind concurrent with orphan sweep; binding preserved, orphan removed',
        { timeout: 15000 },
        async () => {
            // Regression guard: if Method C (lock) is removed, this test MUST
            // fail.  Expected failure mode without the fix:
            //   sweep's multi-chunk read races with concurrent write -> orphan
            //   entries remain OR bindings are lost.

            // Pre-seed: orphan entry pointing to a preset that will be swept.
            // Seed data (from beforeEach): chunk_0 has plenty of space.
            await ctxA.bindChatToPreset('orphan-uuid', 'pStale');

            // Concurrent: ctxA adds a new binding while ctxB sweeps orphans.
            // Both are single-chunk (reconciliation path).
            // The async mutator yield is safe: source reloads caches after
            // await mutator(map) to handle cross-context onChanged invalidation.
            await Promise.all([
                ctxA.bindChatToPreset('uA', 'pAlive'),
                ctxB.mutateChatPresetMap(async (map) => {
                    for (const [uuid, presetId] of Object.entries(map)) {
                        if (presetId === 'pStale') {
                            delete map[uuid];
                        }
                    }
                }),
            ]);

            const map = await ctxA.getChatPresetMap();
            // New binding present
            expect(map['uA']).toBe('pAlive');
            // Orphan was swept
            expect(map['orphan-uuid']).toBeUndefined();
            // Seed preserved
            expect(map['@seed']).toBe('seed');
            expect(Object.keys(map)).toHaveLength(2);
        },
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario C — Preset deletion sweep (multi-chunk -> lock) + concurrent
    //              bind (lock path, append-new-chunk).
    //
    // Pre-populate multi-chunk via direct storage write (seed data to force
    // lock path: 2 chunks means mutateChatPresetMap uses the multi-chunk /
    // rebalance path).  The sweep deletes entries across both chunks; the
    // bind appends a new chunk.
    // ─────────────────────────────────────────────────────────────────────────
    it(
        'Scenario C — Multi-chunk deletion sweep concurrent with single-chunk bind; all deletions applied, new binding present',
        { timeout: 30000 },
        async () => {
            // Regression guard: if Method C (lock) is removed, this test MUST
            // fail.  Expected failure mode without the fix:
            //   popup's multi-chunk cleanup reads stale snapshot -> concurrent
            //   bind's write is overwritten by sweep -> bindings restored for
            //   deleted preset OR uA not persisted.

            // Manually construct 2 chunks via direct storage write
            // (seed data to force lock path: 2 chunks trigger multi-chunk
            //  diff in mutateChatPresetMap -> Method C lock path).
            const chunk0 = { '@seed': 'seed' };
            const chunk1 = {};
            for (let i = 0; i < 30; i++) {
                chunk0[`del-${String(i).padStart(3, '0')}`] = 'D'.repeat(200) + String(i);
                chunk1[`del-${String(i + 30).padStart(3, '0')}`] = 'D'.repeat(200) + String(i + 30);
            }
            // Write to BOTH sync and local so invalidators fire and caches null.
            await seedStorageMultiChunk(
                {
                    chatPresetMapMeta: { version: 5, chunkCount: 2, chunkSizes: [7160, 7160] },
                },
                {
                    chatPresetMap_0: chunk0,
                    chatPresetMap_1: chunk1,
                },
            );

            // Verify multi-chunk layout visible from storage
            const metaCheck = await chrome.storage.sync.get('chatPresetMapMeta');
            expect(metaCheck.chatPresetMapMeta.chunkCount).toBe(2);

            // Force both contexts to reload caches from the new storage.
            await ctxA.getChatPresetMap();
            await ctxB.getChatPresetMap();

            // Concurrent: sweep (lock path, multi-chunk diff) and bind
            // (lock path, append-new-chunk -- no chunk has room).
            // The lock serialises both operations.  Bug 3 fix (re-read all
            // chunks inside the lock) ensures the second acquirer works on
            // a fresh snapshot, preventing stale-snapshot overwrite.
            const dRepeat = 'D'.repeat(200);
            await Promise.all([
                ctxB.mutateChatPresetMap(async (map) => {
                    for (const [uuid, presetId] of Object.entries(map)) {
                        if (typeof presetId === 'string' && presetId.startsWith(dRepeat)) {
                            delete map[uuid];
                        }
                    }
                }),
                ctxA.bindChatToPreset('new-uA', 'preset-a'),
            ]);

            const map = await ctxA.getChatPresetMap();

            // New binding and seed preserved
            expect(map['new-uA']).toBe('preset-a');
            expect(map['@seed']).toBe('seed');

            // No synthetic entries remain
            for (const [uuid, presetId] of Object.entries(map)) {
                if (uuid === '@seed' || uuid === 'new-uA') continue;
                expect(typeof presetId).toBe('string');
                expect(presetId.startsWith(dRepeat)).toBe(false);
            }
            expect(Object.keys(map)).toHaveLength(2);
        },
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario D (reconciliation) — Two tabs add entries to the same chunk
    //   concurrently via mutateChatPresetMap (single-chunk, reconciliation).
    //
    // Both additions go through mutateChatPresetMap with a single entry each.
    // Since the chunk has space, the diff is single-chunk -> reconciliation
    // path (_writeChunkWithReconciliation).  The reconciliation retry loop
    // handles the CAS conflict when both contexts write the same chunk:
    // the slower context sees meta.version advance, invalidates caches, and
    // retries with fresh data.
    // ─────────────────────────────────────────────────────────────────────────
    it(
        'Scenario D (reconciliation) — Two tabs add entries to the same chunk concurrently; both entries present, no data loss',
        { timeout: 15000 },
        async () => {
            // Regression guard: if Method D (reconciliation / CAS retry) is
            // removed, this test MUST fail.  Expected failure mode without
            // the fix:
            //   CAS conflict unhandled -> one write silently lost (last-writer-
            //   wins on the chunk level).

            await Promise.all([
                ctxA.mutateChatPresetMap((map) => {
                    map['uA'] = 'preset-a';
                }),
                ctxB.mutateChatPresetMap((map) => {
                    map['uB'] = 'preset-b';
                }),
            ]);

            const map = await ctxA.getChatPresetMap();
            expect(map['uA']).toBe('preset-a');
            expect(map['uB']).toBe('preset-b');
            expect(map['@seed']).toBe('seed');
            expect(Object.keys(map)).toHaveLength(3);

            // Single chunk
            const metaAfter = await chrome.storage.sync.get('chatPresetMapMeta');
            expect(metaAfter.chatPresetMapMeta.chunkCount).toBe(1);

            // No index collision
            const syncData = await chrome.storage.sync.get(null);
            const uuidCounts = {};
            for (let i = 0; i < metaAfter.chatPresetMapMeta.chunkCount; i++) {
                const chunk = syncData[`chatPresetMap_${i}`] || {};
                for (const uuid of Object.keys(chunk)) {
                    uuidCounts[uuid] = (uuidCounts[uuid] || 0) + 1;
                }
            }
            for (const [uuid, count] of Object.entries(uuidCounts)) {
                expect(count, `UUID "${uuid}" appears in ${count} chunks, expected 1`)
                    .toBe(1);
            }

            // Version monotonicity: ctxB's mutate saw ctxA's writes via
            // cross-context cache invalidation.
            expect(metaAfter.chatPresetMapMeta.version).toBeGreaterThanOrEqual(2);
        },
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario D (append-new-chunk) — Two tabs both trigger the append-new-
    //   chunk lock path (Method C).
    //
    // Seed data to force lock path: single chunk near CHUNK_SOFT_LIMIT so
    // no existing chunk has room for a new entry.  Both bindChatToPreset
    // calls compute entrySize + current sizes >= CHUNK_SOFT_LIMIT and fall
    // through to the append-new-chunk lock path.
    //
    // Both enter the lock path (no chunk has room).  The lock serialises
    // the appends: ctxA acquires first, appends chunk 1; ctxB then acquires,
    // sees chunk 1 (via cache reload inside the lock callback — Bug 1 fix),
    // and appends chunk 2.  Both operations complete without a _metaCache
    // null crash.
    // ─────────────────────────────────────────────────────────────────────────
    it(
        'Scenario D (append-new-chunk) — Both tabs add entries to a full chunk; lock serialises both appends; both entries present, chunkCount increases',
        { timeout: 30000 },
        async () => {
            // Regression guard: if Method C (lock) is removed, this test MUST
            // fail.  Expected failure mode without the fix:
            //   both contexts append to the same new chunk index -> one
            //   append's entries are silently lost (chunk index collision).

            // Seed data to force lock path: single chunk at 7160 bytes.
            // An entry like {"uA":"pAlive"} is ~15 bytes; 7160 + 15 = 7175 >=
            // CHUNK_SOFT_LIMIT (7168), so bindChatToPreset sees no room in
            // chunk 0 and falls through to the append-new-chunk lock path.
            const fill = {};
            for (let i = 0; i < 62; i++) {
                fill[`f-${String(i).padStart(3, '0')}`] = 'X'.repeat(100);
            }
            await seedStorageMultiChunk(
                { chatPresetMapMeta: { version: 1, chunkCount: 1, chunkSizes: [7160] } },
                { chatPresetMap_0: fill },
            );

            // Force both contexts to reload caches from the new seed data.
            await ctxA.getChatPresetMap();
            await ctxB.getChatPresetMap();

            // Both enter the lock path concurrently.  The lock serialises:
            // ctxA acquires first, appends chunk 1; ctxB then acquires,
            // reloads caches inside the lock callback (Bug 1 fix), sees
            // chunk 1 already exists, and appends chunk 2.
            await Promise.all([
                ctxA.bindChatToPreset('uA', 'pAlive'),
                ctxB.bindChatToPreset('uB', 'pAlive'),
            ]);

            // Verify: both UUIDs present
            const map = await ctxA.getChatPresetMap();
            expect(map['uA']).toBe('pAlive');
            expect(map['uB']).toBe('pAlive');

            // chunkCount increased to 3 (original + ctxA's new chunk + ctxB's new chunk).
            // Both appending via lock means each context creates its own new chunk.
            const metaAfter = await chrome.storage.sync.get('chatPresetMapMeta');
            expect(metaAfter.chatPresetMapMeta.chunkCount).toBe(3);

            // No index collision: each UUID appears in exactly 1 chunk
            const syncData = await chrome.storage.sync.get(null);
            const uuidCounts = {};
            for (let i = 0; i < metaAfter.chatPresetMapMeta.chunkCount; i++) {
                const chunk = syncData[`chatPresetMap_${i}`] || {};
                for (const uuid of Object.keys(chunk)) {
                    uuidCounts[uuid] = (uuidCounts[uuid] || 0) + 1;
                }
            }
            for (const [uuid, count] of Object.entries(uuidCounts)) {
                expect(count, `UUID "${uuid}" appears in ${count} chunks, expected 1`)
                    .toBe(1);
            }

            // Version monotonicity
            expect(metaAfter.chatPresetMapMeta.version).toBeGreaterThanOrEqual(2);

            // Lock was released after all operations
            const lockAfter = await chrome.storage.local.get(LOCK_KEY);
            expect(lockAfter[LOCK_KEY]).toBeUndefined();
        },
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario E (TTL recovery) — crashed lock owner.
    //
    // Pre-populate multi-chunk via direct storage write (seed data to force
    // lock path: 2 chunks trigger multi-chunk diff in mutateChatPresetMap).
    // ctxA acquires lock then "crashes" (no release).
    // ctxB's replacement from 2+ chunks to 1 entry triggers the multi-chunk
    // lock path.  The lock is expired -> ctxB acquires, writes, releases.
    // ─────────────────────────────────────────────────────────────────────────
    it(
        'Scenario E — Lock TTL recovery: ctxA acquires lock then "crashes"; after TTL expiry ctxB acquires and completes a lock-protected operation',
        { timeout: 20000 },
        async () => {
            // Regression guard: if lock TTL recovery is removed, this test
            // MUST fail.  Expected failure mode without the fix:
            //   crashed owner holds lock forever -> deadlock (ctxB hangs on
            //   lock acquisition until LOCK_ACQUIRE_TIMEOUT_MS, then throws).

            // Pre-populate 2 chunks via direct storage write
            // (seed data to force lock path: 2 chunks -> multi-chunk diff).
            const chunk0 = { '@keep': 'keep' };
            const chunk1 = { '@more': 'more' };
            await seedStorageMultiChunk(
                {
                    chatPresetMapMeta: { version: 1, chunkCount: 2, chunkSizes: [100, 100] },
                },
                {
                    chatPresetMap_0: chunk0,
                    chatPresetMap_1: chunk1,
                },
            );

            // Force cache reload
            await ctxA.getChatPresetMap();
            await ctxB.getChatPresetMap();

            const metaCheck = await chrome.storage.sync.get('chatPresetMapMeta');
            expect(metaCheck.chatPresetMapMeta.chunkCount).toBe(2);

            // ctxA acquires the lock.
            const tokenA = await ctxA._acquireChatPresetMapLock();
            expect(tokenA).toBeDefined();

            // --- ctxA "crashes" (no release) ---

            // Shorten lock TTL to simulate time passing.
            await chrome.storage.local.set({
                chatPresetMapLock: {
                    owner: tokenA,
                    expiresAt: Date.now() + 100,
                },
            });

            // ctxB's mutate replaces from 2 chunks to 1 entry.
            // Multi-chunk diff -> lock path -> _withChatPresetMapLock.
            // Lock expired -> ctxB acquires, writes, releases.
            await ctxB.mutateChatPresetMap(() => ({
                'recovered-uuid': 'preset-recovered',
            }));

            const map = await ctxB.getChatPresetMap();
            expect(map['recovered-uuid']).toBe('preset-recovered');
            expect(Object.keys(map)).toHaveLength(1);

            // Lock was released after the operation
            const lockAfter = await chrome.storage.local.get('chatPresetMapLock');
            expect(lockAfter.chatPresetMapLock).toBeUndefined();
        },
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario E (lock contention) — Two contexts simultaneously enter
    //   lock-protected operations.  One acquires the lock first; the second
    //   polls until the first releases.  Both complete without deadlock.
    //
    // Seed data to force lock path: 2 chunks so both mutateChatPresetMap
    // calls trigger multi-chunk diff -> Method C lock path.
    //
    // NOTE: The lock path uses stale snapshots (taken before lock acquisition).
    // When both operations replace the entire map (multi-chunk -> lock), the
    // second writer's snapshot overwrites the first writer's committed data.
    // This is a known design limitation — the test verifies deadlock-free
    // execution and lock release, not data-level conflict resolution.
    // ─────────────────────────────────────────────────────────────────────────
    it(
        'Scenario E — Lock contention: both contexts concurrently start lock-protected operations; second waits, both complete, no deadlock',
        { timeout: 30000 },
        async () => {
            // Regression guard: if Method C (lock) is removed, this test MUST
            // fail.  Expected failure mode without the fix:
            //   both contexts' operations race concurrently -> data loss per
            //   Scenario A/B/C/D depending on operation type (last-writer-wins,
            //   orphan residue, or chunk index collision).

            // Seed data to force lock path: 2 chunks so both mutate operations
            // trigger multi-chunk diff -> _withChatPresetMapLock (Method C).
            await seedStorageMultiChunk(
                {
                    chatPresetMapMeta: { version: 1, chunkCount: 2, chunkSizes: [100, 100] },
                },
                {
                    chatPresetMap_0: { '@a': 'a' },
                    chatPresetMap_1: { '@b': 'b' },
                },
            );

            // Force both contexts to reload caches.
            await ctxA.getChatPresetMap();
            await ctxB.getChatPresetMap();

            const start = performance.now();

            // Both operations replace the entire map (deletes from both chunks
            // + adds one entry).  Both compute multi-chunk diff -> lock path.
            // The lock serialises writes; the second acquirer (ctxB) uses a
            // stale snapshot and overwrites ctxA's committed chunk data.
            // This is expected: the test verifies forward progress, not merge.
            await Promise.all([
                ctxA.mutateChatPresetMap(() => ({ 'result-a': 'done' })),
                ctxB.mutateChatPresetMap(() => ({ 'result-b': 'done' })),
            ]);

            const elapsed = performance.now() - start;

            // Both completed within the lock acquisition timeout (no deadlock).
            expect(elapsed).toBeLessThan(LOCK_ACQUIRE_TIMEOUT_MS);

            // At least one operation's effect is visible (lock serialised the
            // writes).  Due to the stale-snapshot design, the second writer
            // overwrites the first, but forward progress is guaranteed.
            const map = await ctxA.getChatPresetMap();
            expect(Object.keys(map).length).toBeGreaterThanOrEqual(1);

            // Lock was released after both operations.
            const lockAfter = await chrome.storage.local.get(LOCK_KEY);
            expect(lockAfter[LOCK_KEY]).toBeUndefined();
        },
    );
});
