---
name: pitfall-gotop-jsdom-migration
description: Traps hit moving go-top/width specs to jsdom (2026-11-08) - leaked wrapper-observer timer, computed margin 0px vs '', which specs opted in
metadata:
  type: project
---

G3 specs that mount the live message-list fixture run under `// @vitest-environment jsdom` (go-top button/enable/inject/locate/reconnect/mutant-killers/transitions/wrapper-observer, chat-width.css, input-width.css); harvest and the other go-top specs stay on happy-dom (simple selectors only).

- jsdom delivers MutationObserver callbacks by microtask, so the wrapper observer arms its real 80ms debounce during the test; resetGoToTopState used to null `_wrapperObserverTimer` without clearTimeout (disable() is a no-op when never enabled) -> "document is not defined" after teardown, exit code 1 with all tests green. Fixed: helper clears timers and the jsdom specs reset in afterEach too.
- jsdom reports an unstyled element's computed margin-bottom as `0px` (happy-dom `''`), so "unreadable geometry -> 62px" cases became 42px. Stub getComputedStyle + offsetHeight explicitly instead of relying on the environment.

**How to apply:** check the `Errors` line, not just Tests, after moving a spec to jsdom. Related: [[happy-dom-has-descendant]], [[project-gotop-native-wrapper-defect]].
