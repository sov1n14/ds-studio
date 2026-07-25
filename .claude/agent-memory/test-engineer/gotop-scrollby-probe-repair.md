---
name: gotop-scrollby-probe-repair
description: Repair of 4 tests that broke when the go-top jump redesign actually landed (scrollTop=0 replacing scrollBy stepping) — probes were coupled to scrollBy, not to the guarantee.
metadata:
  type: project
---

When `content/go-top.scroll.js`'s poll loop switched from `scrollContainer.scrollBy(0, -delta)` to `scrollContainer.scrollTop = 0` (see [[gotop-scroll-engine-red]] for the red-phase test that drove this), 4 previously-green tests broke — not because their guarantee stopped holding, but because their PROBE was `container.scrollBy = vi.fn()`, which the new code simply never calls:
- `test/unit/go-top.prevent-auto-scroll.spec.js` — 3 tests sampled `pas.isEnabled()` inside a `scrollBy` mock to observe mid-flight PreventAutoScroll state.
- `test/unit/go-top.enable.spec.js:301` ("disable aborts an in-flight scrollToTopAndWait") — counted `scrollBy.mock.calls.length` to prove the poll loop was active/inactive.

**Fix — reuse the mechanism-agnostic container mock from [[gotop-scroll-engine-red]] verbatim, don't invent a new one:** give the fixture container a real get/set-backed `scrollTop`, and route `container.scrollBy = vi.fn((x,y) => { container.scrollTop = current + y; })` through that same setter. Then re-point the probe at the `scrollTop` SETTER instead of at `scrollBy`:
- PreventAutoScroll test: wrap the setter (`Object.defineProperty` grabbing the existing get/set descriptor, sampling `pas.isEnabled()` on first write) instead of wrapping `scrollBy`.
- enable.spec.js poll-count test: add a `scrollTopSetCount` counter property alongside the setter; assert on that instead of `scrollBy.mock.calls.length`. Preserves the exact original assertion strength (`toBeGreaterThan(0)` before disable, unchanged count after).

Verified in happy-dom source (`test/node_modules/happy-dom/lib/nodes/element/Element.js:937-947`) that the REAL `scrollBy` implementation internally does `this.scrollTop = ...` — so a setter probe is genuinely mechanism-agnostic, not just a mock convenience: it holds if production ever reverts to real scrollBy stepping too.

**Non-vacuousness proof technique for a probe repair (no source mutation needed here since content/ was off-limits):** temporarily override `pas.enable = () => {}` on the fake PreventAutoScroll object itself (simulating "production never enables") in a throwaway test, run it in isolation, confirm the probe reports `false` instead of `true`, then delete the throwaway test before finalizing. This proves the assertion isn't vacuously true without touching any file under `content/`.

**Team-session gotcha:** this repair ran inside a multi-agent team session sharing one git working tree. `git status` showed `content/go-top.scroll.js`, `manifest.json`, and `test/unit/go-top.visibility.spec.js` as modified, plus an untracked `go-top.scroll-engine.spec.js` — none of it this agent's work; other concurrent teammates (implementers/other test-engineers) were landing changes in parallel. Always run `git diff --stat -- <files you actually touched>` before reporting "modified no other file" — don't infer scope from a blanket `git status` in a shared tree.
