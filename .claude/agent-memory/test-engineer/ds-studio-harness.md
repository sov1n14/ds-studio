---
name: ds-studio-harness
description: ds-studio repo has no root package.json; vitest harness lives entirely under test/ with its own node_modules
metadata:
  type: project
---

The `ds-studio` Chrome extension repo (harvest/export feature area) has no root-level `package.json`. The vitest test harness and its `node_modules` live entirely inside `test/`.

**Why:** Running `npx vitest` from repo root fails to find the config/deps; must `cd test` first.

**How to apply:** Run specs as `cd test; npx vitest run unit/<spec-file>.js`. Specs access the module under test via a global surface, e.g. `window.DSstudio.HarvestPolicy = { createInitialState, decideNextStep, describeIncompleteReason, computeScrollStep }` for `content/harvest.policy.js` — extend this destructure line at the top of the spec when a new function is added to the same module surface, and add a guard test asserting all exposed members are functions (catches an implementer accidentally replacing the whole exported object instead of extending it). See [[bash-tool-quoting]] for how to safely append new `describe` blocks with the Bash tool without touching existing tests.

Harvest DOM caveats (learned while adding scroll-step tests to harvest.spec.js, 2026-08-08): happy-dom's `getBoundingClientRect()` returns all zeros, so `_measureMountedBottomOffset` always yields null in tests unless the container and `[data-virtual-list-item-key]` wrappers get their rects stubbed (`el.getBoundingClientRect = () => ({ top: 0, bottom: N })`). Any scrollBy mock that simulates scroll position MUST advance by its `y` argument (`vi.fn((x, y) => { scrollTop += y; })`), never a hardcoded constant — the harvest loop's exact displacement is now load-bearing. Deterministic loop termination: set `scrollHeight = clientHeight + expectedStep` so one scrollBy reaches the bottom (3 confirmations then complete); the stall clock (20000 ms of fake time) is the guaranteed fallback when the container never bottoms out.
