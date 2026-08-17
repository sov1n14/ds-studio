---
name: vitest-fake-timers-pitfalls
description: Three non-obvious vi.useFakeTimers() pitfalls in this repo's vitest suite -- chrome.storage mock deadlock, MutationObserver flakiness across disable/enable churn, and MutationObserver delivery being silently dropped when another timer is pending
metadata:
  type: project
---

When authoring a spec that needs `vi.useFakeTimers()` (e.g. testing a setTimeout-based
deadline/give-up mechanism) in this repo, three pitfalls showed up while writing
`test/unit/websearch-toggle.spec.js`:

1. **chrome.storage mock deadlock.** `test/fixtures/chrome-storage-mock.js`
   resolves `get`/`set`/`remove`/`clear` via `new Promise(resolve => setTimeout(resolve, 0))`.
   Under fake timers, `await chrome.storage.local.set(...)` hangs forever unless
   a fake-timer advance happens before the `await` resolves. Fix: don't await the
   call directly -- fire it, then `await vi.advanceTimersByTimeAsync(0)`, then await
   the captured promise:
   ```js
   const setStorage = async (data) => {
       const p = chrome.storage.local.set(data);
       await vi.advanceTimersByTimeAsync(0);
       await p;
   };
   ```
   Note the mock's side effect (`_notify` firing `onChanged` listeners) happens
   SYNCHRONOUSLY inside the `set()` call itself, before the internal setTimeout --
   so listeners already fired before you even call `advanceTimersByTimeAsync`.

2. **MutationObserver + fake timers is flaky across disable()/enable() churn.**
   `vi.advanceTimersByTimeAsync(0)` reliably lets a MutationObserver callback
   fire when it's the SAME observer instance that's been live since the test's
   `start()` call (confirmed: observed a real, consistent warn signal from it
   across repeated runs). But when a code path disconnects the old observer and
   creates a brand-new `MutationObserver` instance in direct response to a
   storage change (e.g. this project's `_rearm()`: `disable()` disconnects,
   `enable()` reconnects), asserting on that NEW observer's callback firing via
   `advance(0)` is genuinely racy -- passed on one run, failed on the next, with
   no code change in between. Root cause is presumed microtask/fake-timer
   ordering ambiguity when zero timers are actually pending to advance.
   **Fix used:** avoid relying on the observer path for that scenario. Instead,
   insert the DOM node BEFORE triggering the storage change, so the code's own
   synchronous "locate-and-apply on enable" branch (not the observer) finds and
   applies it deterministically in the same synchronous tick as the storage
   mock's `_notify()` call. Reserve MutationObserver-driven assertions for cases
   using the original, never-recreated observer instance.

3. **MutationObserver microtask delivery can be silently DROPPED under fake
   timers when another timer is pending on the same clock (confirmed by direct
   experiment, 2026-08-17, in the 'give-up deadline' CORE test of
   websearch-toggle.spec.js).** Not merely delayed -- genuinely never delivered
   in some runs. Reproduced in isolation: with a MutationObserver armed and an
   unrelated setTimeout(fn, 15000) also pending, appending a DOM node then doing
   `await vi.advanceTimersByTimeAsync(14999); await vi.advanceTimersByTimeAsync(1);`
   sometimes delivers the MO callback (interleaved with the long timer firing)
   and sometimes drops it entirely -- across otherwise-identical runs with no
   code change. A bounded retry loop of `await vi.advanceTimersByTimeAsync(0)`
   (up to 20x) and a loop of plain `await Promise.resolve()` BOTH failed to
   reliably surface it either (still intermittently 0 fires after 20 attempts).
   `vi.runAllTimersAsync()` does reliably surface the MO callback, but it does
   so by running every pending timer to completion first -- so if a give-up
   deadline is also armed, runAllTimersAsync will fire ITS warning too as a side
   effect, which is unacceptable when the test's contract is zero warnings.
   **Fix that worked, verified 10/10 consecutive runs:** stop trying to coax the
   fake clock into delivering the observer callback at all. Drop to real timers
   just long enough for jsdom's genuine (non-faked) MutationObserver delivery to
   happen, then resume fake timers:
   ```js
   const waitForObserverToSettle = async () => {
       vi.useRealTimers();
       await new Promise((resolve) => setTimeout(resolve, 0));
       vi.useFakeTimers();
   };
   ```
   This is safe specifically because by the time control returns, the awaited
   button-insertion has already been applied (isSpent true) and the give-up
   timer -- whatever became of it across the clock swap -- is moot; nothing left
   to warn about. This is a stronger, more specific version of pitfall #2 above:
   pitfall #2's advice ('avoid the observer path, use the synchronous branch
   instead') is the safer default whenever the test can restructure to hit a
   synchronous code path; this fix is for when the whole point of the test is to
   prove the observer-driven path itself, so restructuring away from it is not
   an option -- swap timer engines around just the delivery step instead.

See also: [[test-engineer-workflow-notes]] if it exists for general repo test conventions.
