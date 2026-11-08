---
name: scratch-and-oracle-check
description: Self-check a red-phase spec for a not-yet-existing module by running copies of it against a reference oracle and deliberately wrong oracles
metadata:
  type: feedback
---

Before reporting a red phase for a not-yet-existing module, copy the spec to a scratch `test/unit/zz-*.tmp.spec.js` whose loader is replaced by a hand-written reference oracle; confirm the oracle passes every test and that deliberately wrong oracles (no filter, wrong scope, text lookup, truthy-not-boolean) each fail at least one test. Also point the real loader at an existing file to prove it loads (testing-pitfalls "Red For the Right Reason").

**Why:** the red run alone (every test failing with "module does not exist") proves nothing about whether the assertions are correct or can fail; used for content/reply-completion.js on 2026-11-08.

**How to apply:** recycle the scratch specs afterwards per [[scratch-scripts-via-stdin]]. The `.claude/agent-memory/` directory is git-tracked here: append to MEMORY.md, never overwrite it.

When one test combines several behaviours (multi-node record plus a dedupe re-add), check the mutant against the whole test: a re-add of the second fragment node re-supplied exactly the toolbar the `slice(0, 1)` mutant dropped, so the test would have stayed green; re-add the first node instead (2026-11-08, reply-completion gap tests).

Efficient variant (2026-11-08, clipboard-offscreen): one oracle file switched by `process.env.MUTANT` plus one sed-copied spec, looped as `MUTANT=x npx vitest run ...`; strip ANSI (`sed 's/\x1b\[[0-9;]*m//g'`) BEFORE grepping the "Tests" summary line or the grep matches nothing. A reference oracle passing a vi.resetModules + import.meta.glob spec that requires exactly one load-time listener per test also proves the glob reloads the module fresh each test. Concurrent agents leave their own zz-* scratch files in test/unit; recycle only your own.
