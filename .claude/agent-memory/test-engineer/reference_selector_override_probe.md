---
name: reference-selector-override-probe
description: Kill-check a structural DSSelectors constant without touching production — scratch vitest config plus setup that overrides globalThis.DSstudio.Selectors and re-evals the preloaded pure bundle
metadata:
  type: reference
---

Vitest 3.2 CLI has no `--setupFiles`; use a scratch `probe.config.mjs` outside the repo (`root` = test dir, import `defineConfig` from `test/node_modules/vitest/dist/config.js`, setupFiles = real `setup/vitest.setup.js` + probe setup). The probe setup sets `globalThis.DSstudio = {...DSstudio, Selectors: {...real, ...JSON.parse(process.env.PROBE_OVERRIDES)}}`.

**Why:** `vitest.setup.js` preloads `*.pure.js` bundles (e.g. `edit-message-cleanup.pure.js` → `globalThis.__DS_EditCleanup_pure`), which capture selector constants before any later setup runs; overriding alone is silently ignored (all mutants "pass").

**How to apply:** after the override, `delete globalThis.__DS_<X>_pure` and `(0, eval)(fs.readFileSync(purePath,'utf8'))`; include an identity run (M0) and expect the A1-style mirror to fail as proof the override took effect. Used 2026-11-08 for G4 edit-message-cleanup (all 5 weakened selectors killed). Related: [[reference-ds-locator-probe-snapshots]].
