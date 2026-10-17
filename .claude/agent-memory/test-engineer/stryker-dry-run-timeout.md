---
name: stryker-dry-run-timeout
description: Stryker dry run times out at default 5min with 3000+ tests; needs --dryRunTimeoutMinutes 15
metadata:
  type: project
---

Stryker's initial dry run (which runs ALL tests for coverage analysis) times out at the default 5-minute limit when the suite has 3000+ tests. Fix: pass `--dryRunTimeoutMinutes 15`. The mutation phase itself is fast since it only runs tests covering the mutated file.

**Why:** The test suite grew past the default dry run budget. The 5-min default is hardcoded in @stryker-mutator/core.

**How to apply:** Always use `--dryRunTimeoutMinutes 15` when running Stryker on this project. Consider adding it to `test/stryker.config.json` as `"dryRunTimeoutMinutes": 15`.

Related: [[sw-test-harness]]
