---
name: pinned-default-dry-run-flake
description: content-script.pinned-default.spec.js test 1 can fail in the Stryker full-suite dry run under 10-way concurrency while passing alone; rerun before investigating
metadata:
  type: project
---

On 2026-09-26 a scoped Stryker run (--mutate content/chat-binding-controller.js) aborted in the initial dry run on "pinned default preset preselection 1. preselects the pinned group" (expected '' to be 'You are helpful.'). The spec passed alone and the immediate rerun of Stryker was clean. Unrelated to the new spec added in that task (separate module instance per file).

**Why:** load-sensitive timing in the content-script bootstrap it drives; not caused by the change under test.

**How to apply:** if a Stryker dry run fails on this test, rerun once before treating it as a regression; if it recurs, investigate its bootstrap wait.
