---
name: go-top-test-rewrite
description: go-top.js was rewritten from position:fixed overlay to DOM injection; tests were updated to match new architecture
metadata:
  type: project
---

go-top.js was fully rewritten (v2.5.23) from a `position:fixed` overlay with JS coordinate computation to a DOM injection approach. The go-top button is now `insertBefore`d into the native button's parent container (`.aaff8b8f`) as a sibling above the native button, relying on the page's flexbox for positioning. Fallback path uses a `dsw-gotop--fixed` CSS modifier class for `position:fixed`.

## Test changes made

**Why:** The old tests asserted behavior of removed methods (`_renderButton`, `_repositionButton`, `_nativeBtnRect` caching). 23 of 69 unit tests failed. All 6 integration tests failed (wrong CSS class selector `dsv-go-top` vs `dsw-gotop`, missing fixture DOM structure).

**Unit test file** (`ds-studio/test/unit/go-top.spec.js`):
- Removed `_renderButton` describe block (12 tests) -- method deleted
- Removed `_repositionButton` describe block (7 tests) -- method deleted
- Updated constructor/state test: replaced `_nativeBtnRect` with `_injectionMode`, `_hasSeenDom`, `_wrapperObserver`, `_enableRetryTimer`, `_enableRetryCount`, `_lastPath`
- Added constants: `OBSERVER_DEBOUNCE` (50), `WRAPPER_OBSERVER_DEBOUNCE` (80)
- Updated `_querySelectorWithFallback` tests: added `_hasSeenDom` gate tests (misses not counted before first success)
- Updated `_isAtTop` tests: added `scrollTop === 0` fallback sub-describe (3 tests)
- Updated `_evaluateVisibility` tests: added `_masterEnabled` gate test
- **Added `_extractDsClasses` block** (4 tests): ds-* extraction, fallback, empty case, order preservation
- **Added `_createButtonElement` block** (9 tests): button creation, class copying, ARIA attrs, SVG structure, click/keyboard handlers
- **Added `_locateWrapperElements` block** (5 tests): correct nesting, null inputs, orphan handling, parent verification
- **Added `_injectIntoWrapper` block** (5 tests): sibling order, hidden state, dedup, observer start, failure case
- **Added `_injectAsFallback` block** (6 tests): modifier class, theme container, body fallback, hidden, idempotent, click handler
- **Added `_injectButton` block** (4 tests): wrapper path, fallback path, connected guard, orphan cleanup
- **Added `_startWrapperObserver / _stopWrapperObserver` block** (3 tests): creation, idempotent, disconnect
- Updated scrollToTopAndWait "aria-disabled" test: uses `_createButtonElement` instead of removed `_renderButton`
- Updated enable/disable beforeEach: added `_getAnchor` mock so `_tryConnectDom` proceeds synchronously
- Updated enable/disable assertions: added `_injectionMode`, `_hasSeenDom`, `_wrapperObserver` checks
- Updated `_onRouteChange` tests: replaced `_nativeBtnRect`/`_repositionButton` refs with `_hasSeenDom`/`_injectButton`

Net: 93 tests (was 69), all passing.

**Integration test file** (`ds-studio/test/integration/go-top.spec.js`):
- Added `setupGoTopDOM()` helper -- injects anchor (`._9663006._2c189bc`) and native button in wrapper structure (`.aaff8b8f` inside `._871cbca`)
- Added `waitForGoTopButton()` helper -- `waitForFunction` polling `.dsw-gotop` (handles 500ms retry cycle in `_tryConnectDom`)
- Test 1: Changed selector `.dsv-go-top` to `.dsw-gotop`; added `setupGoTopDOM` + wait
- Test 2 (Case A): Replaced inline-style positioning check with DOM structure verification (GoTop is sibling before nativeBtn in `.aaff8b8f`, same parent, `injectionMode === 'injected'`)
- Test 3 (Case C): Replaced 24px inline-style check with `dsw-gotop--fixed` modifier class verification; only injects anchor (no native button)
- Test 4 (scroll): Changed selector, added full DOM setup (scrollable ds-scroll-area + anchor + native button wrapper)
- Test 5 (visibility): Changed selector, added `setupGoTopDOM` + wait before visibility check
- Test 6 (route change): Changed selector, added `setupGoTopDOM` + wait

## Key architectural insights for future test work
- **CSS class changed**: `dsv-go-top` (v2.5.22) to `dsw-gotop` (v2.5.23)
- **Button location**: Inside `.aaff8b8f` (not on body), positioned by flexbox (not `position:fixed`)
- **Fallback indicator**: `dsw-gotop--fixed` class instead of inline `24px` styles
- **Injection timing**: `_tryConnectDom` polls at 500ms intervals; tests must wait for retry cycles or inject DOM before navigation
- **Required DOM for injection**: Anchor (`._9663006._2c189bc`) and native button with parent (for `_locateWrapperElements`)
