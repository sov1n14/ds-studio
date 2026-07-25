---
name: project-happydom-environment-limits
description: Known happy-dom 16.8.1 environment limitations that make certain browser behaviors unverifiable in this test suite — AbortController listener teardown, HTMLDialogElement, and MutationObserver under fake timers
metadata:
  type: project
---

Three separate happy-dom 16.8.1 gaps discovered while testing this project, all environment limitations rather than production bugs — do not chase these as regressions, and do not write a test asserting the missing behavior actually works.

**1. `AbortController`-based listener teardown is unverifiable.** happy-dom 16.8.1 ignores the `signal` option on `addEventListener` — a listener registered with `{ signal }` and later aborted via `controller.abort()` is never actually removed in this environment. Any test that tries to prove "the listener was torn down because the signal fired" will pass or fail independent of the real implementation; don't rely on this to validate `AbortController`-based cleanup code.

**2. `HTMLDialogElement` is a bare attribute-toggle shell.** In happy-dom 16.8.1, `showModal()` and `show()` behave identically (no true modal semantics), no `cancel` event is ever dispatched (so Escape-to-close cannot be simulated/verified), and `::backdrop` is not representable at all. Any `<dialog>`-based rewrite of existing overlay/modal UI is therefore untestable in this environment — such a change would need manual/DOM-adapter-layer verification against the real page, not a happy-dom unit test asserting dialog behavior.

**3. `MutationObserver` may never fire under `vi.useFakeTimers()` (UNRESOLVED).** Under `environment: 'happy-dom'` with fake timers active, a `MutationObserver` callback may simply never fire, making any test that both fake-times and relies on mutation-observer pickup unreliable. Candidate fixes, not yet validated: `vi.useFakeTimers({ shouldAdvanceTime: true })`, or switch to real timers plus `vi.waitFor()` around the observed effect. The confirmed suspicious case is `test/unit/go-top.spec.js`'s `'re-injects as solo when button removed and no native button'` test — both of its assertions may be holding trivially from pre-existing DOM/state rather than from the observer actually firing after the button removal. **Record as UNRESOLVED** — do not report this as fixed or as confirmed-passing-for-the-right-reason until someone re-verifies it isolates the observer firing, not stale state.
