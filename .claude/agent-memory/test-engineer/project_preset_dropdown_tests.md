---
name: preset-dropdown-tests
description: Tests for preset-dropdown.position.js and preset-dropdown.component.js, plus vitest.setup.js overlay wiring fix.
metadata:
  type: project
---

Overlay refactor split content-script.overlay.js → 4 modules. Setup fix swaps the single import for 4 imports in dependency order: position → component → styles → controller.

happy-dom v20 limitation: `li.dataset.value` returns `undefined` when the data-value attribute is `''`. Assertions for empty-option values must use `getAttribute('data-value')` not `dataset.value`. The empty-option onClick test uses a lenient assertion (`calledWith === '' || calledWith === undefined`) because the source reads `li.dataset.value` internally.

ResizeObserver stub added to setup — happy-dom doesn't implement it; the controller feature-detects it and skips, but the stub prevents future crashes.

**How to apply:** When writing tests involving empty-string `data-*` attributes in happy-dom, use `getAttribute` over `dataset` for assertions.
