import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Method D — onChanged Reconciliation Retry primitive tests.
 *
 * _writeChunkWithReconciliation uses meta.version as an optimistic
 * concurrency token. When the CAS check detects an advanced version,
 * caches are nulled and the operation retries (up to the budget).
 *
 * Each test uses vi.resetModules() + dynamic import so module-level
 * caches (_metaCache, _chunkIndexCache) start clean.
 *
 * Mock pattern for _safeGet:
 *   1. Capture original BEFORE spy:   const orig = SM._safeGet;
 *   2. Spy and provide implementation: vi.spyOn(SM, '_safeGet').mockImpl(...)
 *   3. In mock, call captured original: orig.call(SM, area, keys)
 */

const META_KEY = 'chatPresetMapMeta';
const CHUNK_PREFIX = 'chatPresetMap_';

describe('StorageManager _writeChunkWithReconciliation (Method D)', () => {
    let SM;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

    /**
     * Helper: set up a single-chunk baseline in sync storage with known
     * meta and chunk data, so the reconciliation method can find them.
     */
    async function setupSingleChunk(version, entries) {
        const chunk = { ...entries };
        const chunkSize = SM._byteLen(chunk);
        await chrome.storage.sync.set({
            [META_KEY]: { version, chunkCount: 1, chunkSizes: [chunkSize] },
            [CHUNK_PREFIX + '0']: chunk,
        });
    }

    // -----------------------------------------------------------------------
    // 1. No conflict — single write
    // -----------------------------------------------------------------------
    it('1. No conflict — single write, one _set call', async () => {
        await setupSingleChunk(5, { 'uuid-1': 'pid1' });

        const setSpy = vi.spyOn(SM, '_set');

        await SM._writeChunkWithReconciliation({
            chunkIdx: 0,
            applyDelta: (chunk) => {
                chunk['uuid-new'] = 'pid2';
            },
        });

        // Exactly one write to storage
        expect(setSpy).toHaveBeenCalledTimes(1);

        // Final state: both entries present
        const syncData = await chrome.storage.sync.get(null);
        expect(syncData[CHUNK_PREFIX + '0']).toEqual({
            'uuid-1': 'pid1',
            'uuid-new': 'pid2',
        });
        expect(syncData[META_KEY].version).toBe(6);
    });

    // -----------------------------------------------------------------------
    // 2. One conflict, succeeds on retry 2
    // -----------------------------------------------------------------------
    it('2. One conflict — mock meta mismatch on first CAS, succeeds on retry 2', async () => {
        await setupSingleChunk(5, { 'uuid-1': 'pid1' });

        // Capture original BEFORE spying
        const origSafeGet = SM._safeGet;
        let metaCasCallCount = 0;

        vi.spyOn(SM, '_safeGet').mockImplementation(async (area, keys) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            if (area === 'sync' && keyArr.includes(META_KEY)) {
                metaCasCallCount++;

                // Call #1 = _ensureChunkCachesLoaded,  #2 = CAS check
                if (metaCasCallCount === 2) {
                    return {
                        [META_KEY]: {
                            version: 99,
                            chunkCount: 1,
                            chunkSizes: [200],
                        },
                    };
                }
            }
            return origSafeGet.call(SM, area, keys);
        });

        const applyDelta = vi.fn((chunk) => {
            chunk['uuid-2'] = 'pid2';
        });

        const setSpy = vi.spyOn(SM, '_set');

        await SM._writeChunkWithReconciliation({
            chunkIdx: 0,
            applyDelta,
            retryBudget: 3,
        });

        // applyDelta was called twice (first attempt + retry)
        expect(applyDelta).toHaveBeenCalledTimes(2);

        // Exactly one _set call (the retry succeeded)
        expect(setSpy).toHaveBeenCalledTimes(1);

        // Final state includes the new entry
        const syncData = await chrome.storage.sync.get(null);
        expect(syncData[CHUNK_PREFIX + '0']).toEqual({
            'uuid-1': 'pid1',
            'uuid-2': 'pid2',
        });
        expect(syncData[META_KEY].version).toBe(6);
    });

    // -----------------------------------------------------------------------
    // 3. Three conflicts, succeeds on retry 4 (at budget boundary)
    // -----------------------------------------------------------------------
    it('3. Three conflicts — succeeds on retry 4 at budget boundary', async () => {
        await setupSingleChunk(5, { 'uuid-1': 'pid1' });

        const origSafeGet = SM._safeGet;
        let metaCasCallCount = 0;

        vi.spyOn(SM, '_safeGet').mockImplementation(async (area, keys) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            if (area === 'sync' && keyArr.includes(META_KEY)) {
                metaCasCallCount++;

                // Fail CAS checks at calls 2, 4, 6; pass at call 8
                if (metaCasCallCount % 2 === 0 && metaCasCallCount <= 6) {
                    return {
                        [META_KEY]: {
                            version: 99,
                            chunkCount: 1,
                            chunkSizes: [200],
                        },
                    };
                }
            }
            return origSafeGet.call(SM, area, keys);
        });

        const applyDelta = vi.fn((chunk) => {
            chunk['uuid-2'] = 'pid2';
        });

        const setSpy = vi.spyOn(SM, '_set');

        await SM._writeChunkWithReconciliation({
            chunkIdx: 0,
            applyDelta,
            retryBudget: 3,
        });

        // applyDelta called 4 times (first attempt + 3 retries)
        expect(applyDelta).toHaveBeenCalledTimes(4);

        // One _set call (retry 4 succeeded)
        expect(setSpy).toHaveBeenCalledTimes(1);

        // Version bumped from 5 to 6
        const syncData = await chrome.storage.sync.get(null);
        expect(syncData[META_KEY].version).toBe(6);
    });

    // -----------------------------------------------------------------------
    // 4. Four conflicts -> exhausted
    // -----------------------------------------------------------------------
    it('4. Four conflicts — throws WriteReconciliationExhaustedError', async () => {
        await setupSingleChunk(5, { 'uuid-1': 'pid1' });

        const origSafeGet = SM._safeGet;
        let metaReadIdx = 0;

        vi.spyOn(SM, '_safeGet').mockImplementation(async (area, keys) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            if (area === 'sync' && keyArr.includes(META_KEY)) {
                metaReadIdx++;

                // Fail only CAS checks (even calls). Odd calls = cache-load reads
                // must pass through so prevVersion matches the real storage version.
                // 4 CAS checks = calls 2, 4, 6, 8 — all fail → budget exhausted.
                if (metaReadIdx % 2 === 0) {
                    return {
                        [META_KEY]: {
                            version: 99,
                            chunkCount: 1,
                            chunkSizes: [200],
                        },
                    };
                }
            }
            return origSafeGet.call(SM, area, keys);
        });

        await expect(
            SM._writeChunkWithReconciliation({
                chunkIdx: 0,
                applyDelta: (chunk) => { chunk['uuid-2'] = 'pid2'; },
                retryBudget: 3,
            }),
        ).rejects.toThrow();
    });

    // -----------------------------------------------------------------------
    // 5. Idempotent re-apply (bind) — concurrent writer added uX
    // -----------------------------------------------------------------------
    it('5. Idempotent re-apply (bind) — concurrent writer added uX; retry adds uY; both present', async () => {
        await setupSingleChunk(5, { 'u1': 'p1' });

        const origSafeGet = SM._safeGet;
        let casAttempt = 0;

        vi.spyOn(SM, '_safeGet').mockImplementation(async (area, keys) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            if (area === 'sync' && keyArr.includes(META_KEY)) {
                casAttempt++;

                // casAttempt=1 = _ensureChunkCachesLoaded, casAttempt=2 = first CAS check
                if (casAttempt === 2) {
                    // Simulate concurrent writer: inject uX into the chunk, bump meta
                    await chrome.storage.sync.set({
                        [CHUNK_PREFIX + '0']: { 'u1': 'p1', 'uX': 'pX' },
                        [META_KEY]: { version: 6, chunkCount: 1, chunkSizes: [300] },
                    });
                    return {
                        [META_KEY]: { version: 6, chunkCount: 1, chunkSizes: [300] },
                    };
                }
            }
            return origSafeGet.call(SM, area, keys);
        });

        await SM._writeChunkWithReconciliation({
            chunkIdx: 0,
            applyDelta: (chunk) => { chunk['uY'] = 'pY'; },
            retryBudget: 3,
        });

        // All three entries present in the final chunk
        const syncData = await chrome.storage.sync.get(null);
        expect(syncData[CHUNK_PREFIX + '0']).toEqual({
            'u1': 'p1',
            'uX': 'pX',
            'uY': 'pY',
        });
    });

    // -----------------------------------------------------------------------
    // 6. Idempotent re-apply (unbind) — concurrent writer added uX
    // -----------------------------------------------------------------------
    it('6. Idempotent re-apply (unbind) — concurrent writer added uX; retry deletes u1; final = {uX}', async () => {
        await setupSingleChunk(5, { 'u1': 'p1' });

        const origSafeGet = SM._safeGet;
        let casAttempt = 0;

        vi.spyOn(SM, '_safeGet').mockImplementation(async (area, keys) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            if (area === 'sync' && keyArr.includes(META_KEY)) {
                casAttempt++;

                if (casAttempt === 2) {
                    // Concurrent writer added uX
                    await chrome.storage.sync.set({
                        [CHUNK_PREFIX + '0']: { 'u1': 'p1', 'uX': 'pX' },
                        [META_KEY]: { version: 6, chunkCount: 1, chunkSizes: [300] },
                    });
                    return {
                        [META_KEY]: { version: 6, chunkCount: 1, chunkSizes: [300] },
                    };
                }
            }
            return origSafeGet.call(SM, area, keys);
        });

        await SM._writeChunkWithReconciliation({
            chunkIdx: 0,
            applyDelta: (chunk) => { delete chunk['u1']; },
            retryBudget: 3,
        });

        // u1 deleted, uX preserved
        const syncData = await chrome.storage.sync.get(null);
        expect(syncData[CHUNK_PREFIX + '0']).toEqual({
            'uX': 'pX',
        });
    });

    // -----------------------------------------------------------------------
    // 7. Cache invalidation on conflict
    // -----------------------------------------------------------------------
    it('7. Cache invalidation on conflict — meta reads prove caches were nulled between retries', async () => {
        await setupSingleChunk(5, { 'uuid-1': 'pid1' });

        // Single spy on _ensureChunkCachesLoaded — counts invocations.
        const ensureSpy = vi.spyOn(SM, '_ensureChunkCachesLoaded');

        // Combined spy on _safeGet: counts meta reads (for cache-invalidation
        // proof) AND triggers a CAS conflict on the first retry.
        const origSafeGet = SM._safeGet;
        let metaGetCount = 0;

        vi.spyOn(SM, '_safeGet').mockImplementation(async (area, keys) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            const isMetaGet = area === 'sync' && keyArr.includes(META_KEY);

            if (isMetaGet) {
                metaGetCount++;
                // metaGetCount=1 = cache-loader, metaGetCount=2 = first CAS check
                if (metaGetCount === 2) {
                    return {
                        [META_KEY]: { version: 99, chunkCount: 1, chunkSizes: [200] },
                    };
                }
            }

            return origSafeGet.call(SM, area, keys);
        });

        await SM._writeChunkWithReconciliation({
            chunkIdx: 0,
            applyDelta: (chunk) => { chunk['uuid-2'] = 'pid2'; },
            retryBudget: 3,
        });

        // _ensureChunkCachesLoaded was called at least twice: initial + retry
        // after cache invalidation.
        expect(ensureSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

        // Meta read from storage happened at least 3 times (cache-load + CAS
        // fail + retry cache-load). If caches were not nulled, retry cache-load
        // would be a no-op and metaGetCount would be 2.
        expect(metaGetCount).toBeGreaterThanOrEqual(3);

        // Write still succeeded
        const syncData = await chrome.storage.sync.get(null);
        expect(syncData[META_KEY].version).toBe(6);
    });
});
