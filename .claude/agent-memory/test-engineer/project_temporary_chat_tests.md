---
name: temporary-chat-tests
description: Temporary Chat v2 tests — Navigation API-based delete, SPA toggle, create-detection; uuid-regex gotcha documented
metadata:
  type: project
---

Tests updated for the rebuilt Temporary Chat feature (Navigation API-based, v2).

**State fields in TemporaryChatDelete (new API):**
- `capturedAuthToken`, `trackedTemporaryUuid`, `isPendingCreate`, `suppressNextUnloadDelete`, `isKeyboardRefresh`, `isListening`
- Old fields `isEnabled`, `isPageRefresh` are GONE.

**UUID regex gotcha:** `extractUuidFromUrl` uses `/\/a\/chat\/s\/([a-f0-9-]+)/`. Any UUID passed via `setPathname` must use only `[a-f0-9-]` chars or `extractUuidFromUrl()` returns null. Use `face0000-f00d-dead-beef-...` style UUIDs.

**Obsolete removals:**
- `handleChatLeft`, `enable()`, `disable()` — removed from production; all referencing tests deleted.
- `dss-chat-left` dispatch removed from `content-script.js` — "dispatches dss-chat-left" describe block removed from `content-script.chat-delete.spec.js`.
- `isPageRefresh` → renamed to `isKeyboardRefresh` in `content-script.refresh-detection.spec.js`.

**New spec added:** `test/unit/censor-xhr-hook.create-detection.spec.js` — inline replication pattern (same as auth-capture spec) for `maybeNotifyCreate` XHR open and fetch override; 11 tests.

**DSS_CHAT_LEFT_EVENT:** Still exported by production constants.js (kept for compat). Constants spec still asserts its value. No test dispatches/listens to `dss-chat-left` anymore.

**SPA toggle tests added:** Groups H (removeToggleRow) and I (handleNavigation) in `temporary-chat-toggle.spec.js`.

**Key patterns:**
- For testing Navigation API handlers, use minimal `{ destination: { url }, navigationType }` event objects.
- `handleNavigationEvent` IS exported in the new module — can call directly.
- For testing `handleBeforeUnload`, set `trackedTemporaryUuid` to the same hex UUID that's in `setPathname`.
