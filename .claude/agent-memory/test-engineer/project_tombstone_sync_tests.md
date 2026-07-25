---
name: project_tombstone_sync_tests
description: Tombstone-based deletion sync (v4.8.x) unit tests, and a test-infra gap that had to be fixed (vitest.setup.js missing tombstones.js preload)
metadata:
  type: project
---

New file `test/unit/storage-manager.tombstones.spec.js` (31 tests) covers the tombstone
deletion-sync fix: `_mergeTombstones`, `_pruneTombstones` (30-day retention, boundary
inclusive), `_isTombstonedAway` (>= comparison, so equal timestamp still tombstoned),
`recordPresetTombstones()`, `mergePresets()` tombstone-aware exclusion (stale local/stale
sync/symmetric/body-still-present cases), a newer-edit-survives-tombstone case,
`savePromptPresets()` writing tombstones to both storages on delete, `resolveSyncConflict()`
end-to-end + the original cross-device resurrection regression, the delete-vs-newer-edit
race (genuine conflict must not auto-delete newer content), and `_get()` persisting a
sync-wins `PRESET_INDEX`/`PRESET_ORDER_META` to `chrome.storage.local` (not just in-memory).

Also added one tombstone-write assertion to the existing delete test in
`storage-manager.structural-write-guard.spec.js` per project CLAUDE.md's obsolescence-cleanup
rule.

**Found and fixed a test-infrastructure gap (not production code):**
`test/setup/vitest.setup.js` preloads `storage-manager.chunk-lock/sync/presets/chatmap/...`
bundle files but was missing the tombstone methods' bundle. At the time, tombstone code lived
in a standalone `utils/storage-manager.tombstones.js` file, mixed in via
`root.__DS_StorageManager_tombstones`; without this preload `_mergeTombstones`/
`_pruneTombstones`/`_isTombstonedAway`/`recordPresetTombstones` would silently be undefined on
`StorageManager` in every spec file. Fixed by adding the missing import alongside the other
bundle preloads. This is a test-infra fix within `test/`, within test-engineer's authority — no
production code touched.

**UPDATE (v4.11.3):** `utils/storage-manager.tombstones.js` no longer exists as a standalone
file — it was merged into `utils/storage-manager.presets.js`, and the tombstone methods now
arrive via `root.__DS_StorageManager_presets`. The gap described above is moot post-merge since
`storage-manager.presets.js` was always preloaded; verify `vitest.setup.js` still imports
`storage-manager.presets.js` before relying on tombstone methods in new tests.

**Gotcha for future tombstone tests:** don't use small literal timestamps like `12345` as a
`deletedAt` — `_pruneTombstones` treats anything more than 30 days before "now" (real
`Date.now()`) as expired and drops it, since 12345 ms since epoch is 1970. Use
`Date.now() - N * DAY_MS` for anything meant to survive pruning.

One implementation bug found and confirmed already fixed by the code-implementer: the
`_get()` sync-wins-but-only-in-memory persistence gap (see [[project_syncnow_persist_gap]])
was the root cause of the original bug; the new `remoteWinsToPersist` mechanism in
`storage-manager.js` `_get()` resolves it and is now covered by tests above.

No outstanding implementation bugs found in this pass — all 138 tests across the 11 scoped
`storage-manager.*` preset/sync/tombstone spec files pass.
