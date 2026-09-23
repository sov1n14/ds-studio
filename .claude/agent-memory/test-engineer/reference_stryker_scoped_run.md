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

Parallel agents (2026-09-23): other agents' red-phase specs in the working tree fail Stryker's dry run ("There were failed tests in the initial test run"). Work around with a scratch vitest config whose `test.include` lists only specs that load the target module (grep for the module name / its loader), and point the scratch Stryker config at it. A failed dry run leaves `.stryker-tmp/sandbox-*` behind; recycle it. A preset-overlay.controller run on the ~21 related specs takes ~75s.

Overlay reposition is observable: stub the header `getBoundingClientRect` (layout trust boundary), clear `wrapperEl.style.left/width/transform`, stub rAF with a capture queue and flush only the frames the action queued (a synchronous rAF recurses forever through the settle loop), then assert centred `left`. Mutant `setVisible: if (enabled) -> if (true)` is DOM-equivalent (reposition bails on display:none), so it needs the call-spy test.

Pitfall (2026-09-24): vitest `mergeConfig` CONCATENATES `test.include` with the base `unit/**/*.spec.js`, so a scratch config built by mergeConfig still runs every spec (and dies on unrelated red specs). After merging, filter the base glob out: `merged.test.include = merged.test.include.filter((x) => x !== 'unit/**/*.spec.js')`. To prove an async catch handler does not reject (e.g. `?.show()` -> `.show()` mutants), register `process.on('unhandledRejection')` in the test and settle with `await new Promise(r => setImmediate(r))` (setImmediate is not faked); confirmed to capture the mutant TypeError under Stryker.

Per-mutant kill proof without Stryker (2026-09-24): a node `.cjs` driver in %TEMP% holding `[id, file, startLine, endLine, from, to]` rows edits the line range in place, runs `npx vitest run <spec> --reporter=json --outputFile=<tmp>`, restores the original Buffer in `finally` and asserts `equals(orig)`; sha256sum the prod files before/after. 38 mutants take ~2 min. Works because every vitest run re-reads sources from disk (setup preload + createRequire routes loader). Validate mutant `if (!x)`-to-`false` on a load-order guard: the mutant usually still throws (TypeError), so assert `not.toBeInstanceOf(TypeError)` plus the message naming the dependency. `typeof msg !== 'object'`-to-false is only observable with a function carrying a valid payload (strings fall through to the unknown-type error).

Correction (2026-09-24): under `vi.useFakeTimers()` (vitest 3 defaults) setImmediate IS faked, so `await new Promise(r => setImmediate(r))` hangs until the 5 s test timeout. The setImmediate settle trick only works on real timers. Timer-leak mutants (`() => clearTimeout(t)` -> `() => undefined`) die on `vi.getTimerCount()` returning to its pre-call baseline. `?.warn(..., { error: err?.message })` catch paths need two cases: logger absent (kills `?.warn` -> `.warn`) and logger present with an `undefined` rejection (optional chaining short-circuits the argument list, so only then is `err.message` evaluated).
