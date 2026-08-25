---
name: temp-chat-delete-negative-assertions
description: In temporary-chat-delete specs, "does NOT delete" must assert the DSS_FIBER_DELETE_SESSION postMessage plus surviving tracked state, not just the retry API
metadata:
  type: project
---

The navigation delete path posts `DSS_FIBER_DELETE_SESSION` to the page world; `TemporaryChatDeleteApi.deleteChatSessionWithRetry` is only its fallback. Negative tests (J4-J6, K1/K2/K4, N6/N7) that asserted only `deleteChatSessionWithRetry).not.toHaveBeenCalled()` were therefore near-vacuous — a real delete on the primary channel would have passed them.

**Why:** T7 in `to-do/refactor-backlog-2026-08-22.md` flagged this file as the suite's tautology hot spot (~40 call-echo assertions).
**How to apply:** For any suppressed/no-op delete case, assert three things: no fiber `postMessage`, no API call, and that `trackedTemporaryUuid` (in memory AND in `sessionStorage['dss-temporary-chat-uuid']`) survives — a suppressed delete that dropped tracking would silently orphan a temporary conversation. Keep call assertions only for wire messages (`chrome.runtime.sendMessage`, `window.postMessage`) and the injected `TemporaryChatDeleteApi` boundary. See [[project_mutation_proof_method]].
