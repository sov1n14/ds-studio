---
name: project-orphan-test-cleanup-2026-07-25
description: Method used to safely delete orphaned test-tree files without losing unique coverage; found one file that looked dead but wasn't fully
metadata:
  type: project
---

On 2026-07-25, dispatched to delete orphaned test artifacts (never-collected `.test.js`, unused fixtures, retired Playwright setup, empty results dirs). Confirmed `test/vitest.config.js` `include: ['unit/**/*.spec.js']` — anything not matching that glob or not imported by a collected spec is dead weight, but "not collected" does not automatically mean "safe to delete": it can still hold behavior coverage that needs migrating first.

**Gap-analysis method that worked:** before deleting a `.test.js`/legacy test file that duplicates a production module's tests elsewhere, grep the exact literal code patterns the orphan exercises (e.g. `joinPath`, the literal string `data: {"v":[` for a bare-array SSE branch) across every collected `.spec.js`. Don't just check "does a spec with a similar name exist" — check whether the *specific branch/edge case* has a matching assertion anywhere. In this repo, `test/unit/sse-parser.test.js` looked fully superseded by `censor-xhr-hook-edit-message.spec.js` (same production module `content/sse-parser.js`, same general scenarios), but grepping the literal patterns showed `SseParser.joinPath` and the bare-top-level-array CONTENT_FILTER branch had zero collected coverage anywhere. Kept the file and reported the gap instead of deleting it — matches the orchestrator's explicit instruction to not delete files with behavior no collected spec covers.

**Why:** A large green suite proves nothing if coverage gaps get silently deleted along with genuinely dead files — this project has already been burned once by tests that never exercised real behavior; the inverse mistake (deleting the only test that does) is just as bad.
**How to apply:** For any future "clean up the test tree" task, do the literal-pattern grep before deleting a suspected-duplicate test file, not just a describe-block-name comparison. See [[project_test_framework]] for the current 85-file/1729-test baseline this cleanup left unchanged.

Also corrected a stale line in [[project_test_framework]] that still described `test/integration/*.spec.js (playwright)` as a current test directory — it was already removed in an earlier cleanup batch (commits d2f0e99, 1495b9b) before this session.

**Follow-up (same day, second pass):** The `joinPath` (5 cases) and bare-array/absolute-BATCH CONTENT_FILTER gaps identified above were migrated into a new collected file `test/unit/sse-parser.spec.js` (7 tests total, loaded via the same `vm.createContext`+`runInContext` pattern as `censor-xhr-hook-edit-message.spec.js`'s `loadSseParser()`). Each of the 7 assertions was proven non-vacuous by mutating a throwaway in-memory copy of `content/sse-parser.js`'s source string (never touching the file on disk) and confirming the assertion goes red, then re-confirming green against the unmodified source — see [[project_mutation_proof_method]]. All 7 passed against real production code on first run (expected: these are ported known-good assertions, not fresh TDD red-phase tests). The orphan `test/unit/sse-parser.test.js` was then moved to the Recycle Bin. Full suite after: 86 files / 1736 tests / 0 failures (baseline 85/1729 + 7 new = exact match).
