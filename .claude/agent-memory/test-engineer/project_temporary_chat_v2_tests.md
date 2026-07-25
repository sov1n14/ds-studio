---
name: project-temporary-chat-v2-tests
description: Temporary Chat v2 test patterns — chrome.storage.session mock, IIFE closure spy limitations, retry timer patterns
metadata:
  type: project
---

Temporary Chat v2 added chrome.storage.session (replacing sessionStorage for enabled flag), TemporaryChatDeleteApi module, and Service Worker routing via chrome.runtime.sendMessage.

**Why:** Enabled flag moved to chrome.storage.session for cross-tab sync. beforeunload now routes keepalive deletes through SW via chrome.runtime.sendMessage. deleteChatSession moved to TemporaryChatDeleteApi (separate module).

**How to apply:**

1. **chrome.storage.session mock** — set global.chrome BEFORE import statement; use a _reset() helper in beforeEach.
2. **IIFE closure spy limitation** — vi.spyOn on exported methods does NOT intercept calls from within the same IIFE closure. Test effects (state changes, timer started) instead of spy call counts. For deleteChatSessionWithRetry, control behavior via global.fetch mock.
3. **Retry timer tests** — use `vi.advanceTimersByTimeAsync(60001)` (2 × 30000ms retry intervals) not `vi.runAllTimersAsync()` because the latter also runs the toast's 6-second removal timer, causing toast to vanish before assertion.
4. **TemporaryChatDeleteApi mock** — mock as global.TemporaryChatDeleteApi before importing temporary-chat-delete.js; the delete module references it by global name.
5. **initEnabledFlagFromStorage** — private in TemporaryChatToggle (not exported); test indirectly via init() or by setting cache via writeEnabledFlag().
6. **DSS_CHAT_COMPLETION_DETECTED** — censor-xhr-hook now also posts this message type when /api/v0/chat/completion is intercepted; any test counting total postedMessages for that endpoint must account for the extra message.
7. **__setState key names** — use `enabledFlagCache` (not `_enabledFlagCache`) in TemporaryChatDelete.__setState.
8. **history hook IIFE vm sandbox** — must include `URL` in the sandbox object (`URL,`) because the hook calls `new URL(url, baseHref)` internally; without it resolveAbsoluteUrl silently returns null and postMessage is never called. Also set `window.location.href` in the sandbox.
9. **handleHistoryNavMessage spy limitation** — the exported `handleHistoryNavMessage` calls `handleNavigationEvent` via internal closure; `vi.spyOn(TemporaryChatDelete, 'handleNavigationEvent')` will not see those calls. Use state side-effects: set `isPendingCreate=true, enabledFlagCache=true`, pass a chat URL, then assert `trackedTemporaryUuid` was set and `isPendingCreate` cleared.
10. **init() reorder tests (P5–P7)** — to test early-attach, replicate the init() logic inline in the test (loadTrackedUuid → if uuid attachListeners → capture isListening → await initEnabledFlagFromStorage → if cache && !listening attachListeners). For P7 (no-double-attach), spy on attachListeners and confirm it is called exactly once despite both conditions being true.
