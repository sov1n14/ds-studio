---
name: project-mutation-proof-method
description: How to prove a migrated/ported test assertion is non-vacuous when the original code was never run under a failing case
metadata:
  type: project
---

When porting concrete test cases from a dead/orphaned test file (values and expected outputs already fixed by a prior author, not freshly authored from reading the implementation), the Red-Green Protocol's "observe it fail first" step doesn't apply the normal way — there is no pre-implementation state to be red against, and the production code already exists and passes. The requirement in this project's `test-engineer` contract is still to prove each ported assertion can fail before shipping it.

**Method that worked (2026-07-25, `test/unit/sse-parser.spec.js` migration):** write a throwaway Node script (`.cjs`, plain `assert`, no vitest) in the scratchpad directory that:
1. Reads the real production source file into a string.
2. For each migrated assertion, produces a mutated copy of that string via a single targeted `.replace()` on the exact line of logic the assertion exercises (e.g. `state.censored = true;` → `state.censored = false;`), never touching the file on disk.
3. Loads the mutated string via `vm.createContext` + `vm.runInContext` (same loading mechanism the real spec uses), runs the assertion against it, and confirms it throws `AssertionError`.
4. Re-runs the same assertion against the untouched original source string and confirms it passes.
5. Add a sanity check that `mutated !== originalSrc` per mutation, so a `.replace()` that silently didn't match (stale line text) can't produce a false "proof."

Print both outcomes for every case, then move the throwaway script to the Recycle Bin (per `code-testing-policy` cleanup) once the output has been captured into the report.

**Why:** This project was burned once by a 1,000+ test suite that never failed once because it was transcribed from the implementation. Ported tests from a dead file carry the same risk — if the original author's assertion happened to be tautological or mistyped, porting it verbatim just re-ships the tautology under a collected file name. Mutation-per-line is cheap and catches that: each of the 7 ported `sse-parser.spec.js` assertions was shown to independently detect a break in the exact branch it claims to cover.
**How to apply:** Use this method any time you migrate/port pre-existing concrete test cases (values already fixed by prior authorship) rather than author fresh assertions from a requirement description — it's the substitute for "observe red" when there is no red phase to observe. See [[project_orphan_test_cleanup_2026-07-25]] for the specific case this was developed for.
