---
name: sync-order-meta-tests
description: Tests for cloud sync order meta (PRESET_ORDER_META), mergePresets 4-param, retrySync stale-push prevention, and _detectSyncConflict auto vs manual.
metadata:
  type: project
---

Fix-sync branch added PRESET_ORDER_META (`dsPresetOrderMeta`) key and 4-param `mergePresets`. Tests created/updated:

- `storage-manager.merge.spec.js` — added 5 tests: 4-param order meta winner, createdAt tiebreak, 2-param backward compat
- `storage-manager.resolve-sync-conflict.spec.js` — added "order meta propagation" describe block (2 tests)
- `storage-manager.sync-conflict.spec.js` — replaced old "sets syncConflictPending" test with new auto-resolve + manual-only tests; added dsLocalAuth pin-release test
- `storage-manager.preset-order-sync.spec.js` — new file; 8 tests for `_pickPresetOrderByRecency` and `savePromptPresets` order meta writes
- `storage-manager.retry-sync-pull.spec.js` — new file; 4 tests for stale-push prevention in `retrySync`

**Key gotcha**: `savePromptPresets` only writes PRESET_ORDER_META when the index changes (`JSON.stringify(oldIds) !== JSON.stringify(newIds)`). Tests that expect PRESET_ORDER_META to be written must ensure the index actually changes (e.g., start with empty local PRESET_INDEX).

**Key gotcha**: `retrySync` triggers `resolveSyncConflict()` at the end if conflict is 'auto'. Tests that check cloud PRESET_INDEX must seed real `dsPreset_` objects, otherwise resolved index collapses to `[]`.

**Setup fix**: `storage-manager.chatmap.js` must be imported in `vitest.setup.js` before `storage-manager.js` runs, or `getChatPresetMap`/`mutateChatPresetMap` will be undefined on the StorageManager object (IIFE sets `globalThis.__DS_StorageManager_chatmap`).

**Why:** line 555 of storage-manager.js: `root.__DS_StorageManager_chatmap || {}` — must be populated before Object.assign runs.
