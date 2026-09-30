---
name: gotop-render-combined-equivalents
description: go-top.render.combined.js surviving mutants that are equivalent (229/236/238/77/132) and the deterministic wrapper-observer harness that killed the rest
metadata:
  type: project
---

As of 2026-09-27, go-top.render.combined.js Stryker: 213 killed, 5 survived, 4 NoCoverage (:11 loader). The 5 survivors are equivalent: :77 `btn.appendChild(icon)` removed (the defensive block at :89 re-creates an identical icon at the same position), :132 `if (!isNaN(nativeRight))`->true (CSSOM ignores `style.right='NaNpx'`, Chrome and happy-dom alike), :229/:236/:238 in `_injectButton` (only reached when `_button` is null/disconnected; `_injectIntoWrapper(null)` returns false; a document-found native button always has a parentElement).

**Why:** future mutant-kill dispatches for this file keep re-listing these; do not burn time forcing them.

**How to apply:** wrapper-observer tests live in test/unit/go-top.wrapper-observer.spec.js: fake timers + one real-macrotask yield + advance exactly one debounce (WRAPPER_OBSERVER_DEBOUNCE+10) so the callback's own follow-up mutation is not processed before asserting. Debounce proven with `vi.getTimerCount()` == baseline+1 after 3 yielded mutations. `_evaluateVisibility` is a no-op after resetGoToTopState (enabled=false), so a pass-through spy is safe.
