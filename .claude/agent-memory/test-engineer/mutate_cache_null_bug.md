---
name: mutate-cache-null-bug
description: mutateChatPresetMap deletion loop reads _chunkIndexCache without null guard; cross-context _Set via onChanged nulls it after async mutator yields
metadata:
  type: project
---

mutateChatPresetMap deletion loop (storage-manager.js line 872) checks `_chunkIndexCache.has(key)` without a null guard. A concurrent context's `_set` via onChanged can null `_chunkIndexCache` while the async mutator `await` yields, causing TypeError.

**Why:** Between `_readAllChunks()` (which loads caches) and the deletion loop, `await mutator(map)` yields to the event loop. A concurrent `_set` in another context fires onChanged, nulling the module-level `_chunkIndexCache`. The deletion loop then crashes on null.

**How to apply:** Any test with concurrent mutateChatPresetMap operations that use deletions must reload caches before the deletion loop runs. Workaround in test: make the mutator async and call `await ctxB._ensureChunkCachesLoaded()` at the end, or delay the concurrent operation so it completes after the other. Source fix: add `if (!_chunkIndexCache) await this._ensureChunkCachesLoaded();` at line 872.

Related:
- `[[lock-path-metanull-bug]]` — same root cause in bindChatToPreset lock path
