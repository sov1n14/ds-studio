---
name: stryker-scoped-run
description: How to run Stryker scoped to one module in ds-studio without CLI pitfalls or clobbering the shared incremental file
metadata:
  type: reference
---

Stryker CLI flags are unreliable from Git Bash: `--mutate "content/x*.js"` and `--incremental false` both error with "too many arguments for 'run'". Working approach: generate a scratch config with node from test/stryker.config.json (set mutate, incremental=false, delete incrementalFile, reporters ["json","clear-text"], jsonReporter.fileName, tempDirName unique), run `npx --prefix test stryker run <scratch>.json` from repo root, then recycle the scratch config + json report. One module with 5 parts (~250 mutants) takes ~6-7 min.

Common survivor class: part files `(function(root){...})(globalThis)` + `if (typeof module !== 'undefined' && module.exports)` survive because globals persist across vi.resetModules. Kill BlockStatement / `if(false)` / `===` variants by deleting the global, resetModules, importing the part and asserting both the global and `(mod.default ?? mod)` expose a method. The `true`, `||`, `!== ""` variants are equivalent under vitest.

Correction (2026-09-23): `test/node_modules/.bin/stryker run test/stryker.config.json --mutate "content/x*.js" --reporters json,clear-text --force` works from repo root; only `--incremental false` (space-separated boolean) triggers "too many arguments". The npx without `--prefix test` pulls the ancient `stryker` 0.x package and crashes. The json reporter writes to `reports/mutation/mutation.json` (gitignored), recycle it after.

Mutants are NOT active while a spec file's static imports load, so code that only runs at load (entry `init()` wiring, `const f = () => ...` wrappers) survives even when a test re-calls it. Kill by `vi.resetModules()` + dynamic `import()` of the entry (and its flag module) inside the test body, then call the fresh instance's exported functions directly: dispatched window events also reach the old static instance and can mask the mutant.

happy-dom `removeEventListener(type, fn, false)` removes a capture listener, so a `capture: true -> false` mutant on removal is unkillable here. A `Storage.prototype.getItem` spy does not intercept happy-dom sessionStorage; use `Object.defineProperty(globalThis, 'sessionStorage', ...)` and pre-store a value so the test is not vacuous.

Bash heredoc chunks containing a computed object key `{ [expr]: v }` failed with "unexpected EOF"; build such objects with assignment, or patch files through a `node - <<'X'` script.
