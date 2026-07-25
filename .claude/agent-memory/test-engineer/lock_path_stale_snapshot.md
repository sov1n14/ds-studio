---
name: lock-path-stale-snapshot
description: Lock callback uses pre-lock snapshot data; concurrent lock-path operations overwrite each other's committed changes (last-writer-wins)
metadata:
  type: project
---

The multi-chunk lock path (Method C) in both mutateChatPresetMap and bindChatToPreset uses data snapshots taken BEFORE lock acquisition. Inside the lock callback, these stale snapshots are written back. A second concurrent lock acquirer writes its OWN stale snapshot, overwriting the first acquirer's committed data (last-writer-wins, not merge).

**Why:** mutateChatPresetMap calls `_readAllChunks()` before `_withChatPresetMapLock`, capturing a snapshot of meta and chunks. The lock callback writes these snapshots to storage. If two contexts both enter the lock path, the second acquirer's snapshot does not include the first acquirer's committed changes. The second write overwrites the first.

**Affected paths:**
- bindChatToPreset append-new-chunk (line 1099) — reads `_metaCache.chunkCount` inside lock, but meta was loaded before lock; if meta is stale, creates chunk at wrong index
- mutateChatPresetMap multi-chunk (line 952) — writes newChunks snapshot, may overwrite concurrent changes
- unbindChat trailing-empty-chunk (line 1150) — reads _readAllChunks inside lock, which is correct

**How to apply:** Lock-path tests must accept that concurrent writers to the same chunks produce last-writer-wins (not merge). For mutually exclusive operations (different chunks), no conflict.
