---
name: vitest-fake-timers-pitfalls
description: vi.useFakeTimers() clock base interacts with module Date.now()-derived state (e.g. click cooldowns) — reset it and advance the clock before first use
metadata:
  type: project
---

vitest `vi.useFakeTimers()` starts the fake clock at/near epoch 0, NOT at the real current time. Any module state derived from `Date.now()` in an earlier real-time test (e.g. `_lastClickAt` from a CLICK_COOLDOWN_MS guard) stays a huge real-epoch value, so the first `Date.now() - _lastClickAt` under fake timers is hugely negative and trips the cooldown as "recently clicked".

**Why:** hit in websearch-toggle.spec.js — first apply() click was suppressed by the module's own cooldown purely because of the clock-base mismatch; the implementation was correct.

**How to apply:** in `beforeEach`, reset the module's time-derived fields (`WebSearchToggle._lastClickAt = 0`); in the fake-timer test itself, call `vi.advanceTimersByTime(cooldown)` right after `vi.useFakeTimers()` so `Date.now() - 0 >= cooldown` holds under any clock base. Note the storage mock's `set()`/`get()` use real `setTimeout` — never await storage operations inside fake-timer tests.
