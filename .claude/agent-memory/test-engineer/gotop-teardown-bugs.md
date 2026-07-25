---
name: gotop-teardown-bugs
description: Two confirmed GoToTop disable()/teardown bugs (2026-07-26), red tests authored and observed failing — for code-implementer follow-up context.
metadata:
  type: project
---

On 2026-07-26, team-lead asked for RED-phase tests (project's red-green protocol) for two confirmed GoToTop teardown bugs. Tests live in `test/unit/go-top.enable.spec.js`, new describe `disable — teardown correctness (regression)`. See [[project-test-harness]] for how to run them.

**Bug 1 — route-change debounce survives disable():** an SPA route change starts `_onRouteChange()`'s ~100ms settling window. If `disable()` is called inside that window (before the debounce fires), the pending timer still fires afterward and re-injects a `.dsw-gotop` button. Observed failure: `document.querySelector('.dsw-gotop')` was NOT null after disable + time advance — a real button was still in the DOM. Test: "an SPA route change immediately before disable must not resurrect the button".

**Bug 2 — in-flight scrollToTopAndWait not cancelled by disable():** calling `disable()` while a scroll-to-top poll loop is in flight does not stop the loop from continuing to call `container.scrollBy(...)`. Observed failure: `scrollBy` mock call count was 8 vs. an expected-unchanged 3 (i.e., 5 more calls happened after disable). Diagnostic note worth flagging to the implementer: the test's `settled` assertion (that the returned promise resolves/rejects promptly rather than waiting for its own timeout) DID pass — so whatever settles the promise near disable-time is decoupled from whatever drives the underlying poll/scroll loop. The fix likely needs to make disable() actually clear/cancel the scroll loop's interval/timeout, not just resolve the promise. Test: "disable aborts an in-flight scrollToTopAndWait before it reaches its own timeout".

Both tests were confirmed to fail on first run (genuine red, not tautological) and did not disturb the 8 pre-existing passing tests in the same file.
