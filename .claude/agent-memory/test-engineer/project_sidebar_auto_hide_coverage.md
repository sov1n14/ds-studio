---
name: project-sidebar-auto-hide-coverage
description: Test coverage status for ds-studio sidebar-auto-hide.js — zero automated tests exist as of 2026-06-01; BDD scenarios documented in test_case.md Feature 6 but not implemented.
metadata:
  type: project
---

Sidebar auto-hide (`content/sidebar-auto-hide.js`) has **zero automated unit or integration test files** as of 2026-06-01.

**Why:** Feature was shipped (v1.5.2) without corresponding test coverage. BDD scenarios are defined in `ds-studio/test/test_case.md` Feature 6 (Scenarios 6.1.1–6.5.1), including the dropdown-hover behavior (6.2.1, 6.2.2), but none are implemented as spec files.

**How to apply:** When any sidebar-auto-hide change is requested, a new unit spec must be created at `ds-studio/test/unit/sidebar-auto-hide.spec.js` using Vitest + happy-dom. See [[project-test-framework]] for setup patterns.

Key behavior to cover for dropdown hover:
- `setupHoverZone()` listens to `document` `mouseover` (capture) and cancels `leaveTimer` when `el.classList` contains `ds-elevated` or `el.closest('.ds-floating-position-wrapper')` is truthy.
- Sets `_activeDropdownEl` and attaches `mouseleave` handler on that element.
- On `mouseleave`, defers `collapse()` via `requestAnimationFrame`; skips if `enterTimer` is set.
- Entire hover-zone listener is removed on `disable()`.
