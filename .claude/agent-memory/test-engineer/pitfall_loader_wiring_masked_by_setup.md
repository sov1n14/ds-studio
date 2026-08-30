---
name: loader-wiring-masked-by-setup
description: vitest.setup.js preloads all globalThis dependencies, masking production loader wiring bugs where a script tag is missing from popup.html or editor.html
metadata:
  type: project
---

`utils/url-constants.js` was missing from `popup/popup.html` and `popup/editor/editor.html` script tags. `utils/tab-control.js` reads `DEEPSEEK_TAB_URL` (defined by `url-constants.js`) at parse time. In production the popup crashed with `ReferenceError: DEEPSEEK_TAB_URL is not defined`. All 2500+ unit tests passed. `editor-html.spec.js` asserted 28 script tags — encoding the broken state as the expected truth.

**Why:** `test/setup/vitest.setup.js` preloads every dependency file into globalThis before any test runs, including `url-constants.js`. In the test environment `DEEPSEEK_TAB_URL` is always available regardless of whether any production loader actually includes it. The existing `storage-manager.loader-contract.spec.js` only covers storage-manager bundle parts, not arbitrary cross-file globalThis dependencies.

**How to apply:** when adding a file to `vitest.setup.js` or introducing a new globalThis dependency consumed at parse time, verify the defining file appears before the consuming file in every production loader's script list (`popup/popup.html`, `popup/editor/editor.html`, `manifest.json` content_scripts, `background/service-worker.js`). When writing or updating a loader-structure test (e.g., `editor-html.spec.js`), cross-check that each parse-time dependency has a preceding script tag — never assert the current count/order without verifying correctness first.
