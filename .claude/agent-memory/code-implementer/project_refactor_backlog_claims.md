---
name: refactor-backlog-claims
description: Findings in to-do/refactor-backlog-*.md carry unverified "zero callers / no test depends on it" claims — grep before acting on them
metadata:
  type: project
---

Dead-code and duplication findings in `to-do/refactor-backlog-*.md` state caller counts as fact, but at least one (B10, `custom-select.js` `setActive()`) claimed "no test depends on it" while `test/unit/popup-custom-select.spec.js` had a whole `describe('setActive()')` block plus an export-surface assertion.

**Why:** the backlog was produced by a review pass that surveyed source but not the spec suite, so test-side coupling is systematically under-reported.

**How to apply:** when a backlog item authorizes a deletion, grep the whole repo including `test/` first. A test caller means STOP and report to the orchestrator — test files are immutable to this agent, so the deletion needs adjudication (delete the spec block via `test-engineer`, or keep the code).
