---
name: cross-context-workaround-removal
description: All workarounds for three source bugs removed from cross-context integration tests; true Promise.all concurrency restored; 122 tests pass
metadata:
  type: project
---

After Phase C+D bug fixes landed in `storage-manager.js` (v2.5.2), the cross-context integration test file `storage-manager.cross-context.integration.spec.js` had its three workarounds removed:

**Bug 1 workaround removed** (Scenario D append-new-chunk): The 100ms delay on ctxB was removed. Both contexts now enter the lock path concurrently via `Promise.all`. ctxA appends chunk 1, ctxB re-reads inside the lock (Bug 1 fix) and appends chunk 2. chunkCount assertion updated from 2 to 3.

**Bug 2 workaround removed** (Scenarios B and C): The explicit `await ctxB._ensureChunkCachesLoaded()` calls inside async mutators were removed. The source now handles this internally (line 851 in `mutateChatPresetMap`).

**Bug 3 workaround removed** (Scenario C): The 200ms delay on ctxA was removed. Both sweep (lock path) and bind (lock path) execute concurrently via `Promise.all`. The lock callback re-reads fresh state inside the lock (Bug 3 fix), preventing stale-snapshot overwrite.

**Why:** Phase C+D source fixes (null guards in lock callback, cache reload after async mutator yield, fresh state re-read inside lock) make the workarounds unnecessary. Test now validates true concurrent execution.  
**How to apply:** When adding new cross-context scenarios, do NOT add delays or manual cache reloads unless a new source bug is confirmed. Prefer `Promise.all` true concurrency.
