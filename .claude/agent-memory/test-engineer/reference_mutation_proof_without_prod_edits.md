---
name: mutation-proof-without-prod-edits
description: Prove a test kills a mutant without writing production files - scratch vitest config with a vite transform plugin plus an fs.readFileSync patch; also the load-environment new Function pattern and DEFAULTS survivor cause
metadata:
  type: reference
---

When a dispatch forbids touching production code, prove kills with a scratch config under test/ (vitest.config.js must be importable): mergeConfig(base, { plugins: [{ enforce: 'pre', transform(code, id) }], test: { setupFiles: [scratch setup] } }) where transform applies process.env.MUT = JSON {file, pairs:[[from,to]]} to vite-loaded modules, and the setup patches fs.readFileSync (default export object) then calls module.syncBuiltinESMExports() so named `import { readFileSync }` users (popup-script-loader) and new Function / fs readers also see the mutant. A node .cjs driver in %TEMP% loops mutants, runs `npx vitest run --config <scratch> <spec> --reporter=json --outputFile=...`, prints failed test titles. Handle CRLF files by converting '\n' in from/to. 2026-11-08: 64 auto-copy/popup mutants proven this way in ~6 min. Recycle the scratch files after.

**Why:** in-place mutation of production files is forbidden by some dispatches, and git checkout restore would destroy uncommitted work anyway ([[pitfall_mutation_restore_git_checkout]]).

**How to apply:** for load-time branches (typeof module/window/require, optional chaining on globals, auto-start calls) evaluate the source with `new Function('globalThis','window','module','require', src)` and a container object as globalThis holding the real fresh dependencies. Pitfall: a destructuring default `({ window = {} })` turns an explicit `window: undefined` back into {} - use `{ window: {}, ...bindings }` spread instead. Every `utils/storage-manager.keys.js` DEFAULTS literal survives Stryker because the only default assertions read the copy vitest.setup.js preloaded (static coverage, ignoreStatic hybrid planning skips them); kill by evaluating keys.js inside the test body. See [[stryker-scoped-run]], [[iife-load-side-effect-sandbox]].
