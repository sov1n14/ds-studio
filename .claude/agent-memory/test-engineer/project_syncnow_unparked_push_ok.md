---
name: syncnow-unparked-push-ok
description: syncNow() does correctly push a never-parked local-newer preset to remote, via retrySync()'s trailing whole-storage resolveSyncConflict() auto-detection, not per-item logic.
metadata:
  type: project
---

Initial suspicion (before writing tests) was that `syncNow()` = `retrySync() + getSettings()` would silently skip pushing a local edit that was never added to `dsLocalAuth` (e.g. a normal successful edit that simply hasn't reached the cloud, sitting newer than a stale remote copy) — because `retrySync()` only iterates `dsLocalAuth` pending keys.

Verified via `test/unit/storage-manager.sync-now.spec.js` ("local newer, never parked in dsLocalAuth" test) that this actually passes: `retrySync()` ends with a whole-store `_detectSyncConflict(syncRaw, localRaw)` check; when it classifies as `'auto'`, it calls `resolveSyncConflict()`, which does its own per-key newer-wins merge across all keys (not just `dsLocalAuth` pending ones) and pushes accordingly. So the never-parked local-newer case is covered as a side effect of that trailing conflict-resolution step, not by dedicated design in `syncnow.js` itself.

**Why this matters:** don't assume "not explicitly handled" == "broken" for this codebase — always write the test and check `resolveSyncConflict()` / `_detectSyncConflict()` before reporting a gap to code-implementer. See [[project_syncnow_persist_gap]] for the actual confirmed gap (remote-newer overwrite not persisted to `chrome.storage.local`).

**How to apply:** when testing sync convergence paths, trace through `retrySync()`'s tail (lines ~220-226 of `utils/storage-manager.sync.js`) — it silently broadens scope beyond the `dsLocalAuth` queue via auto conflict resolution.
