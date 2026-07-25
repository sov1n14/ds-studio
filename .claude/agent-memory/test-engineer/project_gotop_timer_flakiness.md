---
name: project-gotop-timer-flakiness
description: content/go-top.js leaves an uncancelled setTimeout DOM-polling loop that intermittently throws "document is not defined" after test-environment teardown — pre-existing, unrelated to chrome mocking, orthogonal to pass/fail counts.
metadata:
  type: project
---

Running `npx vitest run` from `test/` repeatedly on an otherwise-unchanged tree intermittently surfaces a Vitest "Unhandled Errors" / "Uncaught Exception" section (seen 0, 1, or 6 times across 4 back-to-back identical runs): `ReferenceError: document is not defined` at `content/go-top.js:253` inside `_tryConnectDom`, invoked from a `Timeout._onTimeout` — reported as caught *after* the test environment was torn down.

**Why it happens:** `go-top.js` has a `setTimeout`-based DOM-readiness polling loop (`_tryConnectDom`) that isn't cancelled when its owning test/file finishes, so it can fire into a later, already-torn-down happy-dom environment.

**Why it doesn't block anything:** it never changes `Test Files` / `Tests` / `Failures` counts — those stayed exactly 85/1725/0 across every run regardless of whether this fired. It's orthogonal to pass/fail, purely a stray-timer teardown issue.

**How to apply:** don't chase this down as a regression if you see it appear/disappear between runs of unrelated work — it's pre-existing flakiness in `go-top.js`'s timer cleanup, not caused by chrome-mock or storage-mock changes (confirmed: the stack trace has zero `chrome.*` involvement). If asked to fix it for real, the fix belongs in `content/go-top.js` (clear the timeout on teardown/disconnect), which is production code — out of test-engineer's authority to touch directly; report and let a code-implementer handle it. Discovered 2026-07-25 during [[project_jest_chrome_removal]] verification; go-top.spec.js/go-top.js were also under concurrent edit by another teammate at the time, so the exact trigger conditions weren't isolated further.
