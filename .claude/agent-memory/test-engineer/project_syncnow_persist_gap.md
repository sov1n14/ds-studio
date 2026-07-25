---
name: syncnow-persist-gap
description: syncNow() (utils/storage-manager.syncnow.js) does not persist remote-newer overwrites to chrome.storage.local; getSettings()/_get() is read-only.
metadata:
  type: project
---

`StorageManager.syncNow()` = `retrySync()` then `return getSettings()`. `getSettings()` -> `_get()` computes a sync-wins merge in memory and returns it, but `_get()` never calls `_safeSet('local', ...)`. So when remote is newer for a `dsPreset_<id>` item, the value returned to the caller (and used by popup/content-script) is correct, but `chrome.storage.local` itself is never updated with the remote value — a later offline read (or any code path reading storage.local directly instead of through `getSettings()`) would still see the stale local copy.

Confirmed via `test/unit/storage-manager.sync-now.spec.js`: "overwrites local storage with remote content (persisted...)" and the two-items-independent test both fail with the local storage still holding the stale value, even though the returned settings object is correct.

**Why:** report.md §4.1 item 3 explicitly requires "If remote is newer → overwrite local (persist the overwrite to chrome.storage.local, not just return a merged value in memory)". Current implementation only satisfies the in-memory half.

**How to apply:** When reviewing/testing any future syncNow()-related change, always assert against `chrome.storage.local.get(...)` directly, not just the object returned by `getSettings()` — the two can diverge. Route the actual fix (persisting merged/overwritten values back to storage.local inside `_get()` or a wrapper) to code-implementer; test-engineer must not patch production code.

Separately noted but out of scope: `utils/storage-manager.js` line ~324 has a stray literal backslash `\ Sync success:` where a `//` comment was likely intended (harmless syntax-wise since it's inside a comment-like position, but looks like a typo — worth flagging to code-implementer if noticed again).

See [[project_syncnow_unparked_push_ok]] for the related "local-newer-but-never-parked" case, which actually DOES work (via retrySync's trailing resolveSyncConflict auto-detection), so it is not a gap.
