---
name: order-meta-guard-red-2026-07-26
description: Confirmed defect - retrySync() pushes a pending dsPresetOrderMeta unconditionally with no newer-wins comparison, unlike dsPreset_* items.
metadata:
  type: project
---

New file `test/unit/storage-manager.retry-sync-order-meta-guard.spec.js` (3 tests) proves `StorageManager.retrySync()` has no newer-wins guard for a directly-pending `dsPresetOrderMeta` entry (i.e. `dsLocalAuth` containing the literal string `'dsPresetOrderMeta'`, not `PRESET_INDEX`).

**Confirmed RED:** stale local `orderUpdatedAt` (1000) overwrote a newer cloud copy (5000) after `retrySync()` ??both when order meta was pending alongside nothing else, and when tested in isolation with `dsPresetIndex` deliberately absent from `dsLocalAuth`.

**GREEN as expected:** genuinely-newer local order meta is still pushed (rules out "guard disables all pushing" as the fix).

**Why this differs from existing coverage:** `storage-manager.retry-sync-pull.spec.js`'s "does NOT push local PRESET_INDEX when cloud order is newer" test pends `dsLocalAuth: [PRESET_INDEX]` (not `PRESET_ORDER_META` itself) ??order-meta reconciliation there only happens via the trailing whole-store `resolveSyncConflict()` pass (see [[syncnow-unparked-push-ok]]), which apparently masks the missing per-key guard for the direct-pend case. Pending `dsPresetOrderMeta` itself is the uncovered path.

**How to apply:** when `code-implementer` fixes `utils/storage-manager.sync.js`, expect the fix to add a newer-wins comparison (likely reusing whatever comparator gates `dsPreset_*` pushes) to the branch that handles a pending `dsPresetOrderMeta` key specifically. Route to `test-executor` for certifying run once implemented ??do not seed `dsPreset_*` objects for this guard's assertions, only `dsPresetOrderMeta` state is asserted.
