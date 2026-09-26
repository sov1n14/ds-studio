---
name: pitfall-storage-mock-shared-references
description: chrome-storage-mock.js used to return/store live references (no clone), masking stale-snapshot / lost-update bugs; since 2026-09-24 it structuredClones — verify before relying on either
metadata:
  type: feedback
---

Historically the in-memory chrome.storage fixture handed out the stored object itself on get and stored the caller's object on set, so a caller mutating its read result silently mutated storage and a stale-snapshot write-back looked correct. Real chrome.storage structured-clones both ways.

On 2026-09-24 test/fixtures/chrome-storage-mock.js was changed to structuredClone on get (all key shapes), set, and every onChanged payload; guarded by test/unit/chrome-storage-mock.copy-semantics.spec.js. Check the file header before assuming either behavior. The switch exposed three read-mutate / identity-compare defects in utils/storage-manager.* (unbindChat trailing path, CAS TOCTOU in _writeChunkWithReconciliation, identity compare in _reconcileRemoteWins).

**Why:** the SW sweep clobber scenario passed 5/5 against known-buggy code until clones were introduced.

**How to apply:** for any concurrent-write / lost-update test, confirm the fixture clones (or wrap area.get/set with structuredClone in the spec). A new concurrency test green against reported-buggy code: suspect this first.
