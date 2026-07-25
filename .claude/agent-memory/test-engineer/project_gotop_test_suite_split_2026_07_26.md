---
name: project_gotop_test_suite_split_2026_07_26
description: go-top.spec.js (2235 lines, 162 tests) retired 2026-07-26 and split verbatim into seven spec files plus one shared fixtures helper — current file map for the GoToTop test suite
metadata:
  type: project
---

`test/unit/go-top.spec.js` was retired 2026-07-26 (moved to Recycle Bin). Its 22 describe blocks were split verbatim into seven new files plus one shared helper — nothing was rewritten, every test kept its exact name, and the sorted set of full test names is byte-identical to the original. Any older memory entry citing `go-top.spec.js` or a line number inside it is stale; route by concern instead:

| File | Concern | Tests |
|-|-|-|
| `test/helpers/go-top-fixtures.js` | Shared fixtures: `createWrapperWithoutNativeButton`, `createNativeButton`, `createFullWrapperWithNativeButton`, plus `resetGoToTopState` (the old file-level `beforeEach` body) | — |
| `test/unit/go-top.locate.spec.js` | `_querySelectorWithFallback`, `_findScrollContainer`, `_getNativeButton`, `_locateWrapperElements`, `_locateWrapperDirect` | 28 |
| `test/unit/go-top.button.spec.js` | `constructor`/state, `_createButtonElement` | 23 |
| `test/unit/go-top.visibility.spec.js` | `_isAtTop`, `_evaluateVisibility`, `scrollToTopAndWait` | 31 |
| `test/unit/go-top.inject.spec.js` | `_injectIntoWrapperDirect`, `_applyStackedOffset`, `_injectIntoWrapper`, `_injectButton` | 27 |
| `test/unit/go-top.transitions.spec.js` | `_transitionToStacked`, `_transitionToSolo`, mode transitions | 22 |
| `test/unit/go-top.reconnect.spec.js` | `_tryConnectDom`, `_startWrapperObserver`/`_stopWrapperObserver`, `_onRouteChange` | 21 |
| `test/unit/go-top.enable.spec.js` | `enable`/`disable`, `setupStorageListener` | 10 |

**How to apply:** when a future task needs a specific go-top describe block, use the concern column above to pick the file directly instead of grepping a monolith that no longer exists. All seven files (plus the helper) share the pattern `beforeEach(resetGoToTopState); afterEach(() => vi.useRealTimers());` at their top-level describe — see [[project_happydom_environment_limits]] for why timer restoration matters here (fake-timer MutationObserver coalescing).
