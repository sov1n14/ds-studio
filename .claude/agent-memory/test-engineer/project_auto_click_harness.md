---
name: auto-click-loop-test-harness
description: Auto-retry/auto-continue loop specs share test/helpers/auto-click-harness.js; fake timers must be on before loadAutoClick and flush uses microtasks only
metadata:
  type: project
---
`test/helpers/auto-click-harness.js` (created 2026-09-24) drives content/auto-retry.js through real feature-toggle.js + auto-click.delay.js, stubbing only chrome.runtime. Delay is controlled by stubbing Math.random (R_2500 = 0.81 -> 2500 ms). `settle()` drains microtasks without advancing fake timers, so `vi.useFakeTimers()` must precede `loadAutoClick()`.

**Why:** The loop schedules its first round while the initial GET_SETTINGS settles; a setTimeout-based flush would hang under fake timers or fire rounds early.

**How to apply:** Reuse this harness for any further auto-click loop test; see [[long-heredoc-bash-failure]] when writing files.
