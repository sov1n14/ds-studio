---
name: module-state-bleed-fix
description: How to handle module-level state bleed between describe blocks in vitest tests for StorageManager
metadata:
  type: reference
---

The `_metaCache` and `_chunkIndexCache` module-level variables in `utils/storage-manager.js` persist across vitest describe blocks and even across `beforeEach` that clears chrome.storage (since they are in-memory closures, not storage-backed). This causes stale version baselines when tests read `meta.version` from cleared storage (0) but the bind/mutate operations use `_metaCache.version` (high, from previous tests).

**Fix**: Use `vi.resetModules()` + dynamic `await import(...)` per-test:
```js
let SM;
beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../utils/storage-manager.js');
    SM = mod.default ?? mod;
});
```

This gives each test a fresh module instance with `_metaCache = null`, so `_ensureChunkCachesLoaded()` re-reads from (empty) storage and starts version at 0.

**Why**: The production code has a `_buildNextMeta(prevMeta, ...)` function (line 31 of storage-manager.js) that increments `version: (prevMeta.version || 0) + 1` on every write. Tests 1-10 can drive the internal version to ~498, and without resetting the module, describe 11's tests see that stale baseline.
