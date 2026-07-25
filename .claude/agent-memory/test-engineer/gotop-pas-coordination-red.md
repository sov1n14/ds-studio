---
name: gotop-pas-coordination-red
description: Red-phase tests for scrollToTopAndWait's required save-restore coordination with PreventAutoScroll (2026-07-26); documents when mutation-proof is needed because a no-op baseline trivially satisfies "restore prior state" assertions.
metadata:
  type: project
---

Tests live in `test/unit/go-top.prevent-auto-scroll.spec.js` (new file, new concern per [[project_gotop_test_suite_split_2026_07_26]]'s file-per-concern convention). Fixture reused: `resetGoToTopState` from `test/helpers/go-top-fixtures.js`. `createScrollContainer`/`makeAnchorAtTop` re-declared locally (matches existing per-file pattern in `go-top.visibility.spec.js` — not promoted to the shared fixture file since they're tiny and file-specific).

**Key insight — restoration assertions can be structurally unfalsifiable against a no-op baseline.** `scrollToTopAndWait` currently doesn't touch `PreventAutoScroll` at all. Any assertion of the shape "state X before the call equals state X after the call" (the entire point of save-restore) is trivially satisfied by code that does nothing — so 2 of 5 authored tests PASSED on first run:
- "already enabled before → still enabled after" (harvest-nesting case): no-op never disables, so it stays enabled — passes vacuously.
- "absent PreventAutoScroll → must not throw": no-op never references it, so nothing throws — passes vacuously.

Per the Anti-Tautology mandate ("if a new test passes on first run, treat it as a defect and investigate — never let it slide"), used [[project-mutation-proof-method]] adapted for "no existing implementation to mutate" (there's no real source to `.replace()` against yet, since the coordination code doesn't exist): built two small standalone async functions in a throwaway `.cjs` script reproducing the exact anticipated buggy shapes named in the task background — (a) naive blind `enable()`-then-unconditional-`disable()` (clobbers nesting), (b) naive unguarded `pas.enable()` call with no existence check (throws on absent module) — ran the SAME assertions against those synthetic buggy functions and confirmed they fail there, then sanity-checked they pass against a correct save-restore/guarded stand-in. Both proofs succeeded, confirming the two vacuous-on-baseline tests are not tautological — they just can't be red against literally nothing having been implemented yet.

The other 3 tests (happy path, timeout, second-call-abort) genuinely fail on the current no-op baseline, because each also asserts the mid-flight state via `container.scrollBy` wrapper sampling `isEnabled()` on the first call — that part IS observable-different from a no-op (no-op never flips it true), so those three don't need the mutation-proof workaround.

**Timing note confirmed empirically:** in the second-call-abort scenario, `vi.advanceTimersByTime(60)` between the first and second `scrollToTopAndWait()` calls was enough to let the first scroll-poll tick land (confirmed via the sampled-state assertion reaching a real `false` rather than `undefined`) — so the first poll step is NOT purely synchronous within the call, at least one timer tick is needed. Useful if a future test needs to observe the first in-flight scroll step under fake timers.

**How to apply:** when authoring "restore to prior state" assertions for save-restore patterns against a target that currently does nothing at all, expect roughly half the cases to pass vacuously on first run — don't paper over it, but also don't discard the test; prove it with a synthetic buggy stand-in when there's no real source to mutate yet. See [[project-mutation-proof-method]] for the original (real-source) variant of this technique.
