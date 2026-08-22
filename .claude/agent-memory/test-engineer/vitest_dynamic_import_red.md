---
name: vitest-dynamic-import-red
description: Vite/vitest resolves dynamic import() paths at transform time, so a red-phase test targeting a not-yet-created module fails the whole suite at collection, not inside the test body.
metadata:
  type: project
---

In this repo's vitest setup (test/vitest config using Vite), `await import('../../background/some-not-yet-created-file.js')` inside a `beforeAll` still gets statically resolved by vite:import-analysis at transform time, even though it's a dynamic import. The result is `Failed to resolve import "..."` thrown as a **Failed Suite** (0 tests run), not a normal per-test failure inside `beforeAll`.

**Why:** Vite's import-analysis plugin scans for import() calls syntactically to rewrite them, regardless of whether the path is a literal — it doesn't wait for runtime to discover the module is missing.

**How to apply:** This is still a valid, observable red for TDD purposes (module genuinely does not exist) — report it as such, quoting the "Failed to resolve import ... Does the file exist?" line. Don't mistake "no tests ran, 1 suite failed" for a broken spec; check whether the failure reason is exactly "module not found" for the target production file before treating it as a test-authoring defect.

See pattern used in [[editor-window-routes-spec]] (test/unit/editor-window-routes.spec.js), following test/unit/pending-store-routes.spec.js's capture-listener-via-addListener-spy idiom.
