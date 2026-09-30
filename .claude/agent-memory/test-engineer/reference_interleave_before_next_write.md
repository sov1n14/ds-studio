---
name: reference-interleave-before-next-write
description: h.interleaveBeforeNextWrite in chat-map-writer-harness injects a concurrent SW commit between a caller's snapshot read and its first write; recipe and caveats for stale write-back (lost update) scenarios
metadata:
  type: reference
---

`h.interleaveBeforeNextWrite(action, ms)` (test/helpers/chat-map-writer-harness.js, added 2026-09-24) holds the next set()/remove() on either area, runs `action` (e.g. `b.bindChatToPreset(...)`), then applies the held write. Hooking the write, not a read, is what makes it discriminate: a read hook fires too early when the code under test does several reads (local then sync) and the later read is fresh.

**How to apply:** always assert `ix.hasTripped()` and await `ix.done()` (else vacuous). A 1 s gate lets the held write proceed if `action` is queued behind it (fixed code where the held write is inside the SW queue), so it cannot deadlock. Check preconditions about the concurrent commit INSIDE `action`, not after the call under test: the buggy code may revert local too (seen with retrySync, 2026-09-24).

Observed 2026-09-24: an engine BIND writes chunk + meta to both sync and local but does not remove those keys from dsLocalAuth. Used by test/unit/chat-map.sync-leaks.scenario.spec.js ([[reference-chat-map-writer-harness]]).
