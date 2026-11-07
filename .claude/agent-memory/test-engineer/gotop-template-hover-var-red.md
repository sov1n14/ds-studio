---
name: gotop-template-hover-var-red
description: GoToTop solo-template hover custom-property name bug (2026-11-08); oracle = snapshot native control inline style, not a literal
metadata:
  type: project
---

Red phase 2026-11-08: content/go-top.js template button style used --dsl-button-hover-color, but DeepSeek CSS reads only --dsl-button-color-hover. Old tests asserted the wrong name via toContain (mirror of implementation), and the toContain('--dsl-button-color') substring check also matches either name, so it can never catch a rename.

**Why:** inline custom-property names are invisible to jsdom rendering; the only independent oracle is the real native control in test/fixtures/ds-snapshots/conv2-finished-message-list.html (via createNativeButton()).

**How to apply:** for template/fallback styling tests, parse the native [role=button] inline style into declarations and compare the template against it (exact name + value), with a non-empty fixture guard so the loop is not vacuous. Tests live in test/unit/go-top.button.spec.js (parseInlineDeclarations, nativeFloatingHoverDeclarations). Related: [[project_gotop_native_wrapper_defect]].
