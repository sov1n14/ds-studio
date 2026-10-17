---
name: overlay-failed-bind-race
description: Overlay failed-bind prefix race only reproduces on an UNBOUND chat with an immediate failure; bound-chat, NO_RECEIVER-retry and timeout modes stay green on buggy code
metadata:
  type: project
---

2026-09-26: red tests for "label rolls back but injected prefix keeps B" live in test/unit/content-script.overlay-failed-bind-consistency.spec.js (unbound-chat block). Red modes: port-closed rejection, resolves-undefined, sync throw, `{ok:false}`. Green on buggy code: NO_RECEIVER rejection (client retries after 100 ms, so the optimistic getSettings wins first), 10 s timeout, and every bound-chat mode (rollback also awaits getSettings, FIFO keeps it last).

**Why:** the rollback clears the prefix synchronously when there is no binding, so any optimistic getSettings still in flight overwrites it; the storage fake's setTimeout(0)-per-read gives that order naturally without delaying storage.

**How to apply:** when a fix lands, the unbound immediate-failure cases are the ones that must go green; do not treat the green bound-chat or timeout cases as proof of the fix. Each test in this spec costs ~2 s (real-timer settle).
