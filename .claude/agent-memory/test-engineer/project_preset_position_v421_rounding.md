---
name: preset-position-v421-rounding
description: v4.2.1 Math.round in computePlacement; EXPECTED_CENTER_LEFT updated 373.5→374; idempotency regression test added.
metadata:
  type: project
---

In v4.2.1 `content/preset-dropdown.position.js` wraps all returned `left` and `width` values in `Math.round()` across all three branches (center, center-fallback, gap).

`getNaturalWidth()` in `content/preset-dropdown.component.js` switched from `arrow.getBoundingClientRect()` to a stable constant `16` for arrow width, guaranteeing idempotency.

**Changes to test/unit/preset-overlay.dom-resolvers.spec.js:**
- `EXPECTED_CENTER_LEFT` changed from `(767-20)/2 = 373.5` to `Math.round((767-20)/2) = 374`
- All 7 `toBeCloseTo(EXPECTED_CENTER_LEFT, 1)` assertions changed to `toBe(EXPECTED_CENTER_LEFT)`
- New Group 9 describe block added: "DOM resolvers — reposition() idempotency (Bug #2 regression)" with one test: "two consecutive reposition() calls with the same label yield identical integer left and width (no drift)"
  - Asserts `style.left` and `style.width` are identical on two consecutive calls
  - Asserts `parseFloat(left) % 1 === 0` (integer, no fractional part)

**Why:** `preset-position.spec.js` had no fractional issues — all center-mode left values happen to be integers with those test inputs.

**Final counts:** 54 files, 1136 tests, 0 failures (baseline was 7 failures in dom-resolvers.spec.js).
