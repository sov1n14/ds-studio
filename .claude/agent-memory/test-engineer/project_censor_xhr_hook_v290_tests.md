---
name: censor-xhr-hook-v290-tests
description: edit_message endpoint tests for censor-xhr-hook.js v2.9; vm sandbox pattern for IIFE hooks
metadata:
  type: project
---

censor-xhr-hook.js is an IIFE (`var`-based, not an ES module). Tests for it use `vm.runInContext` with a mock `XMLHttpRequest` class, a mock `window.postMessage`, and a pre-loaded `SseParser` (also loaded via `vm.runInContext`).

Key non-obvious detail: the hook always calls `originalSend.apply(xhr, arguments)` at the end of `send()`, even for intercepted URLs. So you cannot use `originalSend` call-count to detect whether the URL was intercepted. The correct observable proxy is whether a `readystatechange` listener was installed on the XHR object — checked via `xhr._eventListeners.readystatechange`.

Tests added: `ds-studio/test/unit/censor-xhr-hook-edit-message.spec.js` — 24 tests in Groups A-D covering URL matching, edit_message SSE end-to-end, request-body extraction, regression guard.

**Why:** v2.9 added edit_message endpoint to INTERCEPTED_ENDPOINTS. Tests needed to cover the new observable behavior.
**How to apply:** When writing future hook tests, use the wasHooked pattern (check listener installation) not originalSend call count.
