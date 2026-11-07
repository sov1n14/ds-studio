---
name: happy-dom-has-descendant
description: happy-dom 16.8.1 mis-evaluates multi-compound :has() arguments (descendant or child chains); it matches on the first compound only
metadata:
  type: project
---

happy-dom 16.8.1 (test env) evaluates `:has(A B)` as `:has(A)` and `:has(> A > B > C)` as `:has(> A)`. Observed 2026-10-15 on SIDEBAR_OPEN_BUTTON_SELECTOR (`:has(svg path[d^="M9.67272"])`) and 2026-11-08 on FLOATING_BUTTON_BAR_SELECTOR (`div:has(> div > div > div > textarea[name="search"])` matches every div with a div child) and INPUT_COMPOSER_WRAPPER_SELECTOR. Chrome 156 (Playwright `channel: 'chrome'`, the installed browser; bundled chromium build is missing) matches exactly one element on the live snapshot. Single-compound `:has(> X)` and `:has(X)` evaluate correctly.

Consequences for the sidebar selectors (G6, 2026-11-08): querySelector(SIDEBAR_WRAPPER_SELECTOR) returns the first div with a div child, so mount the wrapper first in body or under a non-div host (main). wrapper.matches(SIDEBAR_WRAPPER_COLLAPSED_SELECTOR) is correct on the wrapper itself. sidebarEl.querySelector(SIDEBAR_NATIVE_COLLAPSED_SELECTOR) is true on ANY faithful expanded markup (the innermost scroll area is a div child of an over-matching div), so sidebar-auto-hide.spec.js uses a pruned skeleton of the captured chain with the innermost scroll area re-tagged div to section.

Consequences for go-top / input-width (G3, 2026-11-08): document.querySelector(FLOATING_BUTTON_BAR_SELECTOR) returns the message-list root, so go-top wrapper-locate tests on live markup stay red (kept failing, attributed); input-width CSS negatives fail and positives for bar/composer are vacuous.

**Why:** a selector can be right in Chrome and wrong under test, so a red selector test may be an environment bug, not a code bug. Over-matching also makes positive CSS-application assertions vacuous (an over-matching sibling rule styles the target anyway).

**How to apply:** when a `:has()` selector test over-matches, prove attribution with (1) a minimal happy-dom repro, (2) the same repro in Chrome via Playwright, (3) a scratch vitest config outside the repo whose setup file patches the owning prototype of document.querySelector (walk the prototype chain; Document.prototype patch has no effect) to evaluate that one selector Chrome-faithfully, then rerun the failing specs.
