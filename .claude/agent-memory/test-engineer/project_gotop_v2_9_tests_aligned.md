---
name: project_gotop_v2_9_tests_aligned
description: Tests already aligned with rebuilt content/go-top.js; only one index bug fix needed
metadata:
  type: project
---

GoToTop test file (`test/unit/go-top.spec.js`) was already in sync with the rebuilt `content/go-top.js` for v2.9. No describe blocks needed adding or removing. Only bug found: `_injectIntoWrapper > injects button into parent before nativeBtn` asserted `children[0]` for the injected button, but `createWrapperWithoutNativeButton()` adds a `div` (inputArea) as the first child, pushing the button to `children[1]`. This was a pre-existing test assertion error, not a production defect.

Coverage: 161 tests, all passing, covering:
- `_createButtonElement` clone+template paths
- `_getNativeButton` fallback chain with new post-validation (rejects primary/filled/disabled/non-floating buttons from fallbacks)
- `_iconSvg`
- `_transitionToStacked`/`_transitionToSolo` pure modifier swaps
- `_applyStackedOffset` 62px fallback

Changes made 2026-06-05:
- Added 2 new `_getNativeButton` test cases: (1) fallback rejects primary button — matches fallback via `ds-button--floating`+`ds-button--circle` but fails post-validation due to `ds-button--primary`; (2) fallback rejects non-floating button — no `ds-button--floating` means no fallback match.
- Fixed pre-existing breakage from `[GoToTop]` diagnostic log removal: removed `console.warn` spy+assertion from `_querySelectorWithFallback` degraded test (production no longer warns on degraded entry).
- The test file did not need a rewrite — see [[project_gotop_v2_8_6_tests]] for the prior test state.

**Note (2026-07-26):** `go-top.spec.js` referenced above no longer exists as a single file — it was split into seven spec files plus a shared helper. See [[project_gotop_test_suite_split_2026_07_26]] for the current layout.
