---
name: pitfall-mutation-restore-git-checkout
description: Restore a mutation-check file from a byte copy, never git checkout — the working tree usually holds uncommitted spec edits that checkout destroys silently
metadata:
  type: feedback
---

When temporarily mutating a spec file to prove a check is non-vacuous, take a byte copy of the file first and restore from that copy. Never restore with `git checkout <file>`.

**Why:** on 2026-08-22 (debounce extraction repair) I mutated `test/unit/popup-custom-select.spec.js`, then restored it with `git checkout`. That reverted to HEAD and silently wiped uncommitted edits another agent had already made in the same working tree — three obsolete `setActive()` tests came back and failed, because production had dropped that API in the same uncommitted batch. Recovery cost a diagnosis round trip; the edits were unrecoverable from git and had to be re-derived.

**How to apply:** in a task where production changes are staged in the working tree but uncommitted (the normal state mid-pipeline in this repo), any `git checkout`, `git restore`, or `git stash` on a file is a destructive operation on someone else's unsaved work. Copy, mutate, copy back. Confirm the restore by re-running the file and matching the test count you recorded before mutating. See [[project_mutation_proof_method]].
