---
name: project_tombstone_object_shape_tests
description: Tombstone entry shape changed from bare number to {ts, deleted} object; tests rewritten for new shape and clearPresetTombstones bug fix.
metadata:
  type: project
---

`utils/storage-manager.presets.js` (tombstone methods merged in here since v4.11.3; were
previously in a now-deleted standalone `storage-manager.tombstones.js`) tombstone entries changed shape: legacy `{ [id]: deletedAtTs }` (bare number) → `{ [id]: { ts, deleted } }`. `normalizeTombstoneEntry/Map` provide backward-compat on read (bare number → `{ ts: n, deleted: true }`). `_mergeTombstones` now unions by `ts` and carries the whole winning entry (including `deleted`). `clearPresetTombstones()` bug fix: no longer deletes the map key — writes `{ ts: now, deleted: false }` instead, so a newer "cleared" tombstone can outrace a stale "deleted" tombstone still held by an unsynced device during merge. No-op only when the id already has `{ deleted: false }` (not merely "id absent").

**Why:** Prior key-deletion behavior meant clearing a tombstone lost the ts-based conflict resolution — an unsynced device with a stale `deleted:true` entry could resurrect the deletion after merge, since the cleared side had no entry to compare `ts` against.

**How to apply:** Any test asserting `not.toHaveProperty(id)` after `clearPresetTombstones()` is testing the OLD buggy behavior and must be rewritten to check `{ deleted: false }`. Any test constructing tombstone objects directly must use `{ ts, deleted }` shape (bare numbers are only for legacy-compat assertions). Watch for map-wide normalization side effects: writing to `clearPresetTombstones` normalizes and rewrites ALL entries in the map (not just the target id), even untouched ones — so bare-number siblings turn into object shape too when a write occurs.

Related files: `test/unit/storage-manager.tombstones.spec.js` (45 tests, full rewrite), `test/unit/storage-manager.sync-conflict.spec.js` (fixed 1 assertion), `test/unit/storage-manager.structural-write-guard.spec.js` and `test/unit/storage-manager.migration-push.spec.js` (verified unaffected — no value-shape assertions).
