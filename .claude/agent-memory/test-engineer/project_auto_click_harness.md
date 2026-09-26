---
name: auto-click-loop-test-harness
description: Auto-retry/auto-continue loop specs share test/helpers/auto-click-harness.js; fake timers before loadAutoClick; activation = guardButton (React isTrusted guard), not click events
metadata:
  type: project
---
`test/helpers/auto-click-harness.js` (created 2026-09-24) drives content/auto-retry.js through real feature-toggle.js + auto-click.delay.js, stubbing only chrome.runtime. Delay is controlled by stubbing Math.random (R_2500 = 0.81 -> 2500 ms). `settle()` drains microtasks without advancing fake timers, so `vi.useFakeTimers()` must precede `loadAutoClick()`.

**Why:** The loop schedules its first round while the initial GET_SETTINGS settles; a setTimeout-based flush would hang under fake timers or fire rounds early.

**How to apply:** Reuse this harness for any further auto-click loop test; see [[long-heredoc-bash-failure]] when writing files.

**2026-09-27 React-guard update:** success criterion is `guardButton(name)` (a `__reactProps$` onClick that counts only `nativeEvent.isTrusted === true && instanceof Event`), not `clickSpy` — live DeepSeek ignores untrusted `.click()`, which shipped broken under click-counting tests. `clickSpy` is kept only for no-React-props fallback and decoy "never touched" checks. `loadBridge()` loads `content/react-click-bridge.main.js` once per spec file via `import.meta.glob` (it listens on `document`, which outlives `vi.resetModules`). happy-dom Events have no `isTrusted` at all (undefined). Do not assert exact `dispatchEvent` call counts: pre-fix `.click()` dispatched several events per round.

- 2026-09-27: in auto-click.react-guard spec, an exception thrown by a React onClick inside the bridge's document listener propagated out of dispatchEvent synchronously (vitest showed 'Error: onClick failed'), despite watchListenerErrors' comment saying happy-dom reports it as a window ErrorEvent. Always wrap the dispatch in expect(...).not.toThrow() so the red message is descriptive; do not rely on the window 'error' spy alone.
