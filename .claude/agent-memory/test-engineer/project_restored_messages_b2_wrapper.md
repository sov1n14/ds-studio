---
name: restored-messages-b2-wrapper-shape
description: B2 refactor collision — StorageManager.getRestoredMessages() already existed and returns the raw chrome.storage get() wrapper, not the unwrapped map
metadata:
  type: project
---

Backlog B2 (move `restored_messages` out of `popup/popup.backup-manager.js` into the storage layer) collides with a pre-existing API: `StorageManager.getRestoredMessages()` already exists in `utils/storage-manager.local.js` and resolves the raw `chrome.storage.local.get(KEY)` **wrapper** (`{ restored_messages: {...} }`), which its only consumer `content/censor-reply-restore.storage.js` unwraps itself. `saveRestoredMessages(map)` (whole-value overwrite) also already exists; "clear" today is `saveRestoredMessages({})`, not a key removal.

**Why:** the B2 directive specifies an unwrapped-map getter matching what the popup consumes. Honouring it is a breaking change to the content-layer caller, not a pure addition.

**How to apply:** when specs for this area go red on `{ restored_messages: ... } to deeply equal { 'msg-1': ... }`, that is the wrapper, not a missing method. Any red suite here must include a round-trip guard through `saveRestoredMessages` so the content-layer caller is not silently broken. See [[red-phase-runner]].
