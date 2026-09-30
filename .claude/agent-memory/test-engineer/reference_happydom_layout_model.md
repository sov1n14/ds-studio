---
name: happydom-layout-model
description: How to model browser layout (scrollWidth/flex stretch) in happy-dom specs; injected real CSS drives getComputedStyle correctly
metadata:
  type: reference
---

happy-dom v16 resolves getComputedStyle from a style tag holding the real content CSS file (flexGrow, flex shorthand, padding, border, display) and from inline styles (label.style.flex = 'none' gives flexGrow "0"). Gap shorthand: cs.columnGap is empty, read cs.gap.

**How to apply:** for width/measurement bugs, inject the real CSS in beforeAll and install geometry getters (scrollWidth/clientWidth/offsetWidth on HTMLElement.prototype, getBoundingClientRect on Element.prototype) that implement the CSS rule from computed style, restore in afterAll. Example: test/unit/preset-dropdown.width.spec.js (2026-09-26, overlay growth bug). Growth step observed = impl chrome minus model chrome, so the "any inline width" variant is the chrome-independent red.
