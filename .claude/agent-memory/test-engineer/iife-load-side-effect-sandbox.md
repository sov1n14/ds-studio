---
name: iife-load-side-effect-sandbox
description: How to spec module-LOAD side effects of a utils/*.js classic IIFE without polluting the suite-wide globals that vitest.setup.js preloads
metadata:
  type: project
---

To assert what a `utils/*.js` IIFE does (or must stop doing) *at load time*, compile its source with `new Function` and pass `globalThis, window, chrome, localStorage, document, require` as PARAMETERS. The parameters shadow the free variables the IIFE reads, so the module gets a private instrumented environment, and its `globalThis.dsX = ...` export lands on the fake object instead of the real global.

**Why:** `test/setup/vitest.setup.js` side-loads i18n, storage-manager parts, logger etc. for the whole suite. A spec that re-evals one of those into the real global (the `eval()` trick in `test/unit/i18n.spec.js`) clobbers the shared instance for every other spec, and it also cannot observe load-time behavior at all — the module was already loaded by the setup file before the spec body runs.

**How to apply:** counters on the fake `localStorage.getItem` / `chrome.storage.sync.get` / `onChanged.addListener` are what proves "loading the module is inert". Note a declared-but-undefined `require` param makes `typeof require !== 'undefined'` false, which is what the Node-fallback branch expects. See `test/unit/i18n.lifecycle.spec.js` (backlog U2/U13 red phase) for the working loader. Related: [[pitfall_bash_heredoc_long_files]], [[vitest_harness_pitfalls]].
