---
name: red-phase-loader-pattern
description: proven way to load a not-yet-existing classic-script module in a red-phase vitest spec in ds-studio
metadata:
  type: project
---

For a red-phase target outside `test/`, use `fs.existsSync(file)` then `Object.values(import.meta.glob('../../<path>'))[0]` (Vite-transformed, so Stryker can mutate it), with distinct errors for missing file, glob miss and missing published global. Prove the loader by sed-copying the spec to a temp spec pointed at an existing sibling file and confirming the failure moves past "does not exist".

**Why:** the `testing-pitfalls` red-for-the-right-reason lesson; runtime `import()` of files outside `test/` can fail for loader reasons. `createRequire` works but bypasses Vite transforms.

**How to apply:** every new-module red phase, followed by the oracle check in [[scratch-and-oracle-check]] (for a SW route, replace getListener with a hand-written listener switched by process.env.MUTANT); see `test/unit/notification-routes.spec.js` and `test/unit/reply-completion.spec.js`.
