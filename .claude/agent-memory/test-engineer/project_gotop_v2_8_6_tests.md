---
name: gotop-v2-8-6-tests
description: go-top.spec.js updated for v2.8.6 fixes — element reuse transitions, strict _isAtTop, flaky timeout fix.
metadata:
  type: project
---

v2.8.6 introduced three production fixes; tests updated accordingly.

**Fix 1 (CSS)**: No unit impact — base `.dsw-gotop` stripped of appearance props; `.dsw-gotop--fixed` is now self-sufficient. No test assertions on inline appearance styles needed.

**Fix 2 (flicker)**: `_transitionToStacked` / `_transitionToSolo` added. Reuse same element — no remove+recreate. Updated all mode-transition tests to assert `GoToTop._button === originalBtn` (same reference). Added dedicated `describe('_transitionToStacked')` and `describe('_transitionToSolo')` blocks (7 tests each) covering: element reuse, class swap, DOM position (insertBefore), offset applied/cleared, `_injectionMode` set, display preserved for both hidden and visible cases.

**Fix 3 (partial scroll)**: `_isAtTop()` now ONLY trusts `[data-virtual-list-item-key="1"]` (ANCHOR_SELECTOR_FALLBACK2) and `scrollTop <= 1`. Rewrote entire `_isAtTop` describe: old tests used `._9663006` anchor (which `_isAtTop` no longer queries). New tests use `data-virtual-list-item-key="1"` for verifiable anchor. Added explicit "loose selector NOT trusted" tests. Added scrollTop matrix: 0/1/2.

**Flaky fix**: `does NOT cache document-level fallback` pre-existing test timed out with fake timers. Rewrote to use real timers, assert `result.success` property exists, and assert `_scrollContainer !== docFallback`.

**No-op guard tests**: Added two tests asserting that when mode is already correct and button is connected, no transition helpers are called and no DOM moves occur.

**Suite result**: 148/148 go-top.spec.js; 731/731 full suite.

**Why**: align regression tests with v2.8.6 behavior.
**How to apply**: future go-top test changes must use `[data-virtual-list-item-key="1"]` for at-top assertions, and assert element identity (not just class) for transition tests.
