---
name: preset-position-v2-tests
description: computePlacement rewrite — windowWidth-driven branching, no minWidth floor, hidden flag, 40 tests passing.
metadata:
  type: project
---

Rewrote `test/unit/preset-position.spec.js` (40 tests) and updated `test/unit/preset-overlay.dom-resolvers.spec.js` (23 tests) for the self-adaptive positioning rewrite.

**Key contract changes in `preset-dropdown.position.js`:**
- New `windowWidth` input parameter (replaces geometry-based mode selection).
- `minWidth` parameter removed; no lower width clamp exists.
- Returns `hidden: boolean` field.
- `windowWidth >= 768` → always `mode='center'`, `hidden=false`.
- `windowWidth < 768` → `mode='gap'` when availableGap > 0; `mode='hidden'` when availableGap <= 0.
- `availableGap = buttonLeft - titleRight - 2*gapSafety`.

**Test harness patterns:**
- `place()` helper sets `windowWidth: 1024` (center branch default).
- `placeGap()` helper sets `windowWidth: 375` (gap branch default).
- For controller tests: set `window.innerWidth` via `Object.defineProperty(window, 'innerWidth', {value:N, writable:true, configurable:true})` before `reposition()`, restore in `afterEach`.
- `happy-dom` `getNaturalWidth()` returns ~20 (no DOM layout). With no minWidth floor, expected width=20 in center mode. Center left = `(containerWidth - 20) / 2`.
- `EXPECTED_CENTER_LEFT = (767 - 20) / 2 = 373.5` for the 767px container test fixture.

**`preset-overlay.resolvers.js` added to `vitest.setup.js`** so the global `__DS_PresetOverlayResolvers` is populated before controller loads.

**Why:** See [[preset-dropdown-tests]] for prior preset overlay test context.

**How to apply:** When editing computePlacement or reposition tests, always provide `windowWidth` explicitly to select the correct branch deterministically.
