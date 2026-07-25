---
name: lock-path-metanull-bug
description: bindChatToPreset append-new-chunk lock callback reads _metaCache.chunkCount without null guard; cross-context onChanged from concurrent _set can null it
metadata:
  type: project
---

bindChatToPreset lock path (storage-manager.js line 1100) reads `_metaCache.chunkCount` inside `_withChatPresetMapLock` callback without a null guard. A cross-context `_set` (in ctxA's lock callback) fires onChanged which nulls ctxB's `_metaCache` while ctxB waits for the lock. When ctxB acquires the lock and enters the callback, `_metaCache` is null -> TypeError.

**Why:** The onChanged listener (line 425-435) nulls both `_chunkIndexCache` and `_metaCache` when any `chatPresetMapMeta` or `chatPresetMap_*` key changes. The lock acquisition does NOT null caches (`chatPresetMapLock` doesn't match the listener filter), but the data `_set` inside the lock callback does. A concurrent context's `_set` can thus null the waiting context's caches.

**How to apply:** Any test that has two contexts simultaneously in the `bindChatToPreset` append-new-chunk lock path must account for this. Workaround: delay the second context so it sees the first context's committed chunk and takes the reconciliation path instead. Source fix: add `if (!_metaCache) await this._ensureChunkCachesLoaded();` at line 1100 before reading `_metaCache.chunkCount`.

Related bugs:
- `[[mutate-cache-null-bug]]` — same root cause in mutateChatPresetMap deletion loop
- `[[lock-path-stale-snapshot]]` — lock callback uses pre-lock snapshots, causing overwrites
