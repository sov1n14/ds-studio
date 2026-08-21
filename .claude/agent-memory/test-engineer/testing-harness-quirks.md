---
name: testing-harness-quirks
description: happy-dom supports history.pushState + PopStateEvent, so SPA route changes can be driven for real; GoToTop route detection has no observer field left to assert on
metadata:
  type: project
---

Confirmed by running, 2026-08-22: happy-dom supports `window.history.pushState` and `new PopStateEvent('popstate')`. SPA route changes can therefore be driven for real in unit tests instead of stubbing `window.location`.

**Why:** `content/go-top.js` route detection no longer exposes any observer field — it is a `_handlePathChange()` branch inside the debounced (50ms `OBSERVER_DEBOUNCE`) body-mutation callback plus a `popstate` listener. Specs that used to assert `_routeObserver !== null` had to be rewritten as behavior assertions (old button torn down, new one injected after the 100ms route-change debounce) driven through one of those two trigger paths.

**How to apply:** for the popstate path, fake timers are fine (the handler runs synchronously off the dispatched event). For the body-mutation path use REAL timers — see [[project_happydom_environment_limits]] for why fake timers do not deliver MutationObserver records. Proving such a post-hoc test non-vacuous: back up the production file with `cp`, disable the exact mechanism, re-run to observe failure, restore, confirm with `cmp` — a variant of [[project_mutation_proof_method]] that works when the production file has uncommitted changes and `git checkout --` would destroy them.
