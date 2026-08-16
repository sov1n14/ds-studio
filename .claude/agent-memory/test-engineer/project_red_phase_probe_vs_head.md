---
name: red-phase-probe-vs-head
description: When the working tree already contains the fix, observe the TDD red phase against HEAD via a temp probe spec importing a git-shown copy of the old implementation
metadata:
  type: project
---

Rule: If a brand-new test passes on first run because the working tree already contains the implementation fix (uncommitted `code-implementer` changes), do NOT contort the fixture and do NOT touch the implementation file. Observe the red phase against the true pre-fix code with a temporary probe: `git show HEAD:content/<file>.js > test/unit/__probe_impl_tmp.js`, write `test/unit/__probe_tmp.spec.js` that imports the probe copy (CJS `module.exports` interop works under vitest; mirror the real spec's imports, e.g. storage-manager first) and replicates the new assertions verbatim with identical fixtures, run only that file, then recycle-bin both probe files via the file-deletion-policy PowerShell command.

**Why:** The red-green protocol requires an observed failure, but the orchestrator's dispatch premise ("code is unfixed") can be stale — the implementer may have already landed the fix while the test-engineer directive was written. A probe proves the assertions are discriminative (red on old code) without any risk to the working tree. Contorting a spec-correct fixture to force a red against fixed code would corrupt the test.

**How to apply:** Probe assertions must be byte-identical to the real spec's (same constants, same makeToggle args). Expect the red to fail exactly as the directive predicted (label-based code returns null; no warn call). The probe run output is the legit red deliverable; report both facts to the orchestrator (red observed vs HEAD, green present in working tree) so its two-sided verification stays honest. See [[ds-studio-harness]] for the run command and [[session-tooling-quirks]] for file-editing constraints.
