---
name: happy-dom-has-descendant
description: happy-dom 16.8.1 mis-evaluates :has() containing a descendant combinator; it matches on the first compound only
metadata:
  type: project
---

happy-dom 16.8.1 (test env) evaluates `:has(A B)` as `:has(A)`: `:has(svg .nonexistent)` matches any element containing an svg. Single-compound `:has(path[d^="..."])` works correctly. Observed 2026-10-15 on SIDEBAR_OPEN_BUTTON_SELECTOR (`:has(svg path[d^="M9.67272"])`), which matched all 3 rail buttons in tests but is correct in Chrome.

**Why:** a selector can be right in Chrome and wrong under test, so a red selector test may be an environment bug, not a code bug.

**How to apply:** when a `:has()` selector test over-matches, probe with a standalone happy-dom script before blaming production; recommend single-compound `:has()` arguments so tests and Chrome agree.
