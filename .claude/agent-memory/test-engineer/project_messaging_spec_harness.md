---
name: messaging-spec-harness
description: How to spec a content module that gets settings via DSS_GET_SETTINGS / DSS_SETTINGS_CHANGED instead of chrome.storage - fresh-module load per test, and the auto-start double-registration trap
metadata:
  type: project
---

Content modules migrated onto `content/feature-toggle.js` are driven in specs purely through `chrome.runtime`: a `sendMessage` stub answering each GET from `message.keys`, and a fireable `onMessage` stub whose `callListeners()` delivers `{type: SETTINGS_CHANGED, area:'local', changes}`. `test/unit/width-feature.spec.js` holds the canonical helper set (`createOnMessageStub` / `respondWith` / `broadcast`).

**Why:** feature-toggle keeps its feature registry AND its single shared onMessage listener in module scope, so a stale instance from a previous test keeps reacting to this test's broadcasts. Every test must `vi.resetModules()` and dynamically re-import feature-toggle + the module under test; also hand it a NEW onMessage stub in the same helper so orphaned listeners cannot see the new broadcasts.

**How to apply:**
- Modules that auto-start at load (`websearch-toggle.js`, `hide-thinking.js`, `auto-retry.js` all end with `X.start()`) must NOT have `start()` called again by the spec: websearch-toggle's `_setupSettingsListener` + `registerFeatureToggle` would arm twice and every "clicks exactly once" assertion double-fires. Instead build the pre-existing DOM FIRST, then call a `loadX(values)` helper that resets modules and re-imports — the load itself is the start.
- Load helper needs an `isFakeTimers` option: settling with a real `setTimeout(0)` deadlocks under `vi.useFakeTimers()`; use `await vi.advanceTimersByTimeAsync(0)` there. Fake-timer blocks must load the instance INSIDE the fake-timer window or the module's own timers (e.g. websearch-toggle's 15s give-up deadline) sit on the real clock and `advance()` never reaches them.
- Globals published at load (`window.StorageManager`, `window.DSstudio.Selectors`) survive `resetModules`, so a single static top-level import of `utils/storage-manager.js` / `content/ds-selectors.js` is enough for modules that read them at load time.
- Cheap proof the harness is not vacuously green: `sed` the `broadcast()` default area from `local` to `sync` and re-run — every broadcast-driven test must fail (14 did across the three specs on 2026-08-22), then restore.
- Once-only registration traps a re-called `init()`: `temporary-chat-toggle.js` guards `registerMasterToggle()` with a module-level flag AND auto-runs `init()` at import, so a spec's later `await Module.init()` can never re-seed master gating (the load-time GET_SETTINGS already failed against the bare `vi.fn()`). Master-gating tests must load a FRESH instance with the route seeded first (`loadToggle(values)`); only flag-cache tests can keep using the statically imported instance.
- Each fresh instance leaves a live `MutationObserver` on `document.body`; collect the instances in the load helper and `__setMasterEnabled(false)` them in a file-level `afterEach`, otherwise an old instance re-injects rows into later tests.
- feature-toggle treats `undefined` master as ON (`value !== false`), so a "master true injects" test cannot distinguish explicit `true` from an unseeded store — the load-bearing case is the `false` one. Proven by mutating the load helper to drop seeded values: L1/L6/L8 failed, L2 stayed green.
