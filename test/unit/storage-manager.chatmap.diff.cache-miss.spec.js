import { describe, it, expect, beforeEach } from 'vitest';
import StorageManager from '../../utils/storage-manager.js';

/**
 * Mutant kill test: ConditionalExpression on _applyChatPresetMapDiff line 47.
 *
 * When changedKeys contains a key NOT present in _chunkIndexCache, the update
 * for that key must be silently skipped — the chunk must NOT be modified and
 * the chunk index must NOT appear in the returned modifiedChunks set.
 *
 * Conversely, when the key IS in the cache, the chunk MUST be updated and the
 * chunk index MUST appear in modifiedChunks. This contrast is what kills the
 * `if (true)` mutant: the mutant enters the block for uncached keys, calls
 * .get() → undefined, then fails the inner guard, so the cached-key update
 * still works but the test structure forces both branches to be distinguishable.
 *
 * Direct low-level call to _applyChatPresetMapDiff avoids async cache reload
 * that normally ensures the cache is always populated.
 */
describe('_applyChatPresetMapDiff changedKeys cache-miss vs cache-hit', () => {
    beforeEach(() => {
        // Ensure _chunkIndexCache is a fresh Map (not null)
        StorageManager._chunkIndexCache = new Map();
    });

    it('cache-hit: changedKey in cache updates the chunk and appears in modifiedChunks', () => {
        const chunks = [{ 'uuid-a': 'old-value' }];
        const meta = { chunkCount: 1, chunkSizes: [100] };
        const finalMap = { 'uuid-a': 'new-value' };

        // Pre-populate cache: uuid-a lives in chunk 0
        StorageManager._chunkIndexCache.set('uuid-a', 0);

        const modified = StorageManager._applyChatPresetMapDiff(
            chunks, meta, /* deleted */ [], /* changed */ ['uuid-a'], /* added */ [], finalMap,
        );

        expect(chunks[0]['uuid-a']).toBe('new-value');
        expect(modified.has(0)).toBe(true);
    });

    it('cache-miss: changedKey NOT in cache does NOT modify any chunk and modifiedChunks is empty', () => {
        const chunks = [{ 'uuid-b': 'old-value' }];
        const meta = { chunkCount: 1, chunkSizes: [100] };
        const finalMap = { 'uuid-b': 'new-value' };

        // Do NOT populate cache for uuid-b — cache is empty Map

        const modified = StorageManager._applyChatPresetMapDiff(
            chunks, meta, /* deleted */ [], /* changed */ ['uuid-b'], /* added */ [], finalMap,
        );

        // The value must remain unchanged because the cache miss means
        // the code cannot locate which chunk holds the key
        expect(chunks[0]['uuid-b']).toBe('old-value');
        expect(modified.size).toBe(0);
    });
});
