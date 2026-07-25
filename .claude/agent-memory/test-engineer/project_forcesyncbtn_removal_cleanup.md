---
name: forcesyncbtn-removal-cleanup
description: forceSyncBtn UI button removed from popup; describe block in popup.sync-write-quota.spec.js renamed since it tested StorageManager.retrySync() directly, not the DOM button.
metadata:
  type: project
---

The manual-sync button (`#forceSyncBtn`) and its click handler were removed from `popup/popup.html` and `popup/popup.js` (manifest bumped 4.8.4 -> 4.8.5). `StorageManager.retrySync()` itself was untouched and remains used by `background/service-worker.js` and `utils/storage-manager.syncnow.js`.

In `test/unit/popup.sync-write-quota.spec.js`, the describe block at ~line 371 was named `retrySync() — forceSyncBtn integration scenarios` but its 3 tests never touched the DOM button — they called `StorageManager.retrySync()` directly and asserted on `result.success` / `remainingUnsyncedCount`. Renamed to `retrySync() behavior` and kept as-is (still valid coverage, not duplicated elsewhere — other retrySync specs test clear/pull sub-behaviors, not the top-level success/failure/remaining-count contract).

No other test file referenced `forceSyncBtn`, `manualSyncButton`, or `syncingButtonText`.

**How to apply:** if asked again to audit for removed-feature test cruft, grep the whole `test/` tree for the removed symbol names first — don't assume a describe block name implies DOM coupling; read the actual assertions.

Also noted: this project's vitest config lives at `test/vitest.config.js` (not repo root), so `npx vitest run <paths>` must be run from inside `test/` with `--config vitest.config.js`, otherwise `chrome` global (via `setupFiles`) is never loaded and all chrome.* calls throw ReferenceError.
