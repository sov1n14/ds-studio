---
name: cross-context-bugs-discovered
description: Seven source bugs found during Phase C+D (v2.5.0) cross-context integration testing; all fixed in working tree
metadata:
  type: project
---

# Cross-Context Cache-Null Bugs Discovered During Phase C+D Integration Test Creation

The cross-context integration test suite (`test/unit/storage-manager.cross-context.integration.spec.js`) exposed seven bugs in `utils/storage-manager.js`. Four were found during initial test creation, three more during integration test strengthening (true concurrent execution). All are only triggerable when `_installChunkCacheInvalidator()` has been called (i.e., after `initialize()`), because the onChanged listener fires during `_set()` (via local-storage backup), nulling module-level `_metaCache` and `_chunkIndexCache`.

**Existing unit tests never triggered these bugs** because they import `StorageManager` without calling `initialize()`.

## Batch 1 — Original 4 Bugs (all fixed)

### Bug 1 — `bindChatToPreset` lock path cache-null (line ~1106)
`bindChatToPreset`'s append-new-chunk path calls `_set` (fires onChanged, nulls `_chunkIndexCache`), then calls `.set(uuid, newIdx)` on null. **Fix**: null guard + `_ensureChunkCachesLoaded()`.

### Bug 2 — `_readAllChunks` meta-null race (line ~279)
`_ensureChunkCachesLoaded()` yields; concurrent write nulls `_metaCache`. **Fix**: use local `metaCopy.chunkCount` snapshot.

### Bug 3 — `mutateChatPresetMap` bulk-add stale-size (line ~888)
Placement loop never updates `newMeta.chunkSizes[i]`, so entries never overflow chunk 0. **Fix**: update `chunkSizes[i]` after each placement.

### Bug 4 — `unbindChat` cache-null before delete (line ~1128)
`await _get([chunkKey])` yields; concurrent write nulls `_chunkIndexCache`. **Fix**: null guard + `_ensureChunkCachesLoaded()`.

## Batch 2 — 3 Additional Bugs (all fixed, discovered during test strengthening)

### Bug 5 — `bindChatToPreset` lock callback `_metaCache` null (line ~1188)
Lock callback acquires lock then calls `_set` which nulls `_metaCache`, then accesses `_metaCache.chunkCount`. **Fix**: `_ensureChunkCachesLoaded()` as first statement inside lock callback.

### Bug 6 — `mutateChatPresetMap` async mutator `_chunkIndexCache` null (line ~851)
User-supplied async mutator yields; onChanged nulls `_chunkIndexCache`; subsequent diff loop crashes. **Fix**: `_ensureChunkCachesLoaded()` after `await mutator(map)` returns.

### Bug 7 — Lock path stale-snapshot overwrite (line ~955)
Lock callback uses snapshot read before lock acquisition; second acquirer overwrites first's changes. **Fix**: lock callback re-reads fresh state (null caches → `_ensureChunkCachesLoaded` → re-read all chunks → re-run mutator → diff-write) inside the lock.

## Status
All 7 bugs fixed in `storage-manager.js` v2.5.2. The integration tests now run with true `Promise.all` concurrency (no workarounds). 122 tests pass.
