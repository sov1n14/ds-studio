---
name: integration-scroll-listener-harness
description: Programmatic scrollTop assignment does not fire scroll events; trigger _evaluateVisibility via DOM mutations instead for integration tests
metadata:
  type: feedback
---

`element.scrollTop = N` does NOT dispatch a `scroll` event. The content-script's passive scroll listener on `_scrollContainer` will never fire from programmatic assignment.

Additionally, `_scrollContainer` is resolved at `enable()` time. If the test injects a scroll fixture AFTER `enable()` ran, the listener is not attached to the injected element.

**How to apply:**
- Do not rely on `scrollTop` changes to trigger `_evaluateVisibility` in integration tests.
- Instead: append/remove a dummy DOM element to fire the MutationObserver, which debounces at 50ms and calls `_evaluateVisibility`.
- The hide path (`_isAtTop`) also requires the real anchor's `getBoundingClientRect()` to be in viewport — if real page selectors (e.g. `._9663006`) collide with fixture selectors, `_getAnchor()` returns the real page element, not the fixture's.
- For "show" condition: inject a first-message element (`div.ds-message._63c77b1`) with `position:fixed; top:-200px` to force `getBoundingClientRect().bottom < 0` regardless of page scroll.

See also: [[integration-isolated-world]]
