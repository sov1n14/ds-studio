---
name: stryker-runs
description: How scoped Stryker runs behave in ds-studio (duration, report scope, crash when Playwright writes test/test-results concurrently)
metadata:
  type: project
---

Scoped run: `npx --prefix test stryker run test/stryker.config.json --mutate content/a.js,content/b.js` from the repo root takes about 7-8 minutes; the clear-text table still lists every file (incremental results from test/stryker-incremental.json), so read only the rows of the mutated files, and pair survivors with statuses by the `[Survived]` line printed just above each `content/x.js:line:col` line.

**Why:** a run crashed at sandbox copy with ENOENT on `test/test-results/.playwright-artifacts-*` because another agent was running Playwright E2E at the same time; `test-results` is not in ignorePatterns.

**How to apply:** if Stryker dies at startup with ENOENT copyfile under test/test-results, rerun it (or wait for the E2E run to end); report the transient crash, do not edit stryker.config.json (not a test file you own without a mandate).
