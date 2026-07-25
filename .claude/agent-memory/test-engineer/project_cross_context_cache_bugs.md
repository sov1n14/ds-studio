---
name: project-cross-context-cache-bugs
description: Seven cache-null / stale-snapshot bugs found in storage-manager.js chunked chatPresetMap cross-context concurrency (Phase C+D, v2.5.2); all fixed, workarounds removed, module-state-bleed test pattern used throughout
metadata:
  type: project
---

## Root cause

`test/unit/storage-manager.cross-context.integration.spec.js` (filename predates the "no integration tests" naming convention cleanup, but is a genuine collected unit spec under `test/unit/`, not a Playwright/e2e file) exposed seven bugs in `utils/storage-manager.js`'s chunked `chatPresetMap` implementation. All are only triggerable when `_installChunkCacheInvalidator()` has run (i.e. after `initialize()`), because the `onChanged` listener fires during `_set()` (via local-storage backup) and nulls the module-level `_metaCache`/`_chunkIndexCache`. **Existing unit tests never triggered these bugs** because they import `StorageManager` without calling `initialize()`.

## The seven bugs (all fixed in storage-manager.js v2.5.2)

1. **`bindChatToPreset` lock path cache-null** (~line 1106): append-new-chunk path calls `_set` (fires onChanged, nulls `_chunkIndexCache`), then calls `.set(uuid, newIdx)` on null. Fix: null guard + `_ensureChunkCachesLoaded()`.
2. **`_readAllChunks` meta-null race** (~line 279): `_ensureChunkCachesLoaded()` yields; concurrent write nulls `_metaCache`. Fix: use a local `metaCopy.chunkCount` snapshot.
3. **`mutateChatPresetMap` bulk-add stale-size** (~line 888): placement loop never updates `newMeta.chunkSizes[i]`, so entries never overflow chunk 0. Fix: update `chunkSizes[i]` after each placement.
4. **`unbindChat` cache-null before delete** (~line 1128): `await _get([chunkKey])` yields; concurrent write nulls `_chunkIndexCache`. Fix: null guard + `_ensureChunkCachesLoaded()`.
5. **`bindChatToPreset` lock callback `_metaCache` null** (~line 1188 / 1100): lock callback acquires the lock then calls `_set` (nulls `_metaCache`), then reads `_metaCache.chunkCount`. The `chatPresetMapLock` acquisition itself does NOT null caches — a concurrent context's data `_set` inside its own lock callback does, and can null the *waiting* context's caches before it enters its callback. Fix: `_ensureChunkCachesLoaded()` as first statement inside the lock callback.
6. **`mutateChatPresetMap` async mutator `_chunkIndexCache` null** (~line 851/872): user-supplied async mutator yields; onChanged nulls `_chunkIndexCache`; the deletion loop's unguarded `_chunkIndexCache.has(key)` then crashes. Fix: `_ensureChunkCachesLoaded()` after `await mutator(map)` returns (also guards the deletion-loop read directly).
7. **Lock-path stale-snapshot overwrite** (~line 952/955): both `mutateChatPresetMap`'s multi-chunk path and `bindChatToPreset`'s append-new-chunk path take a data snapshot **before** lock acquisition, then write that stale snapshot back inside the lock callback — a second concurrent lock acquirer's write overwrites the first's already-committed changes (last-writer-wins, not merge). Fix: lock callback re-reads fresh state (null caches → `_ensureChunkCachesLoaded` → re-read all chunks → re-run mutator → diff-write) inside the lock, for all three affected paths (bindChatToPreset append-new-chunk, mutateChatPresetMap multi-chunk, unbindChat trailing-empty-chunk was already correct).

**Status after fix:** integration tests run with true `Promise.all` concurrency (no artificial delays needed); 122 tests pass. Workarounds removed from the spec: the 100ms/200ms artificial delays and the manual `await ctxB._ensureChunkCachesLoaded()` calls inside async mutators were all deleted once the source fixes made them unnecessary — do NOT add delays or manual cache reloads back into new cross-context scenarios unless a new, distinct source bug is confirmed; prefer true `Promise.all` concurrency to actually exercise the race.

## Test-authoring pattern: module-state bleed

`_metaCache` and `_chunkIndexCache` are module-level closures in `utils/storage-manager.js` — they persist across vitest describe blocks and even across a `beforeEach` that clears `chrome.storage` (storage clearing doesn't touch in-memory closures). This causes stale version baselines: a test may read `meta.version` from freshly-cleared storage (0) while `_metaCache.version` still holds a high value from a previous test's writes (the production code's `_buildNextMeta` increments `version` on every write, and prior tests can drive it into the hundreds).

**Fix:** reset the module fresh per test via `vi.resetModules()` + dynamic import:
```js
let SM;
beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../utils/storage-manager.js');
    SM = mod.default ?? mod;
});
```
This gives each test `_metaCache = null`, so `_ensureChunkCachesLoaded()` re-reads from (empty) storage and starts version at 0.
