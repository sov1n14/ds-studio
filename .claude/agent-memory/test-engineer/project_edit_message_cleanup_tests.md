---
name: edit-message-cleanup-tests
description: 62 unit tests for content/edit-message-cleanup.js after max-height API refactor (computeDynamicMaxHeight + applyMaxHeightAdjustments replace removeMaxHeightConstraints).
metadata:
  type: project
---

62 tests in Groups A–F in `test/unit/edit-message-cleanup.spec.js`. All pass; suite-wide 969/969.

**UPDATE (2026-07-25):** file grew to 78 tests (Group G added, see [[project_edit_message_cleanup_tests]] MEMORY.md line), then dropped to 76 after constant-mirror redundancy cleanup — see [[project_constant_mirror_redundancy_test]]. Current count is 76; always verify with `npx vitest run unit/edit-message-cleanup.spec.js` rather than trusting this number, it has drifted twice already.

- Module loaded via `createRequire` (CJS guard pattern).
- Group A (14): `extractUserInput` + constants — asserts all new constants: `REMOVE_MAX_HEIGHT_SELECTOR` (`.cc852ac5`), `DYNAMIC_MAX_HEIGHT_SELECTOR` (`._646a522`), `HEIGHT_SOURCE_SELECTOR_A` (`._2be88ba`), `HEIGHT_SOURCE_SELECTOR_B` (`._871cbca`), `MAX_HEIGHT_OFFSET_PX` (32).
- Group B (9): `computeDynamicMaxHeight` — pure arithmetic; typical case, zero sources, negative result (no clamp), fractional, individual source contributions.
- Group C (13): `applyMaxHeightAdjustments` — DOM; `.cc852ac5` always cleared (even with missing sources); `._646a522` skipped when either source missing (critical new rule); computed px value set when both sources present; multiple targets all get same value; root scoping; null/omitted root fallback.
- Group D (11): `applyTextareaCleanup` — boolean return; input/change events; guard clauses.
- Group E (8): `waitForNewTextarea` — pre-existing set ignored, new textarea detected, fires once, hard timeout, guard clauses, synchronous pre-check, fast path.
- Group F (6): `handleEditButtonClick` — regression (F2), guard (F1/F3), F4: `.cc852ac5` cleared + `._646a522` untouched when sources absent, F5: `._646a522` computed when sources stubbed, F6: no-wrapper no-op.

**Key testing pattern for applyMaxHeightAdjustments:**
- Source elements appended directly to `document.body` (not `container`) because the source uses `document.querySelector`, not `root.querySelector`.
- Per-element `getBoundingClientRect` stub: assign `el.getBoundingClientRect = () => ({ height: N })`.
- `window.innerHeight` stub: `Object.defineProperty(window, 'innerHeight', { value: N, configurable: true })`.
- Restore `Element.prototype.getBoundingClientRect` in `afterEach` to avoid cross-test contamination.

**Removed:** Group B `removeMaxHeightConstraints` (7 tests) — function deleted from source.
**Added:** Group B `computeDynamicMaxHeight` (9 tests), Group C `applyMaxHeightAdjustments` (13 tests), Group F tests F4/F5 replacing old E4.

**Why:** Source refactored from a single `removeMaxHeightConstraints` (sets all targets to `none`) to `applyMaxHeightAdjustments` which always clears `.cc852ac5` but dynamically computes `._646a522` using window height and two source element heights, skipping entirely when either source is absent.
**How to apply:** `cd test && node_modules/.bin/vitest run unit/edit-message-cleanup.spec.js`
