---
name: project-loader-contract-bug
description: Real latent bug found via new loader-contract spec — background/service-worker.js omits storage-manager.tombstones.js from importScripts
metadata:
  type: project
---

`test/unit/storage-manager.loader-contract.spec.js` (added 2026-07-26) asserts that all five loaders of `utils/storage-manager.*.js` bundle files (manifest.json, popup/popup.html, popup/editor/editor.html, background/service-worker.js, test/setup/vitest.setup.js) load every bundle before the `utils/storage-manager.js` entry file.

**Confirmed real defect**: `background/service-worker.js`'s `importScripts(...)` call omits `utils/storage-manager.tombstones.js`, while the entry file mixes in `__DS_StorageManager_tombstones`. Background context silently gets `{}` for tombstone methods — `retryParkedSync()`'s `this._mergeTombstones` throws, swallowed by a bare `catch {}`.

**Why:** No test previously guarded this five-loader consistency contract; a refactor could silently drop a bundle from one loader and the suite stayed green.

**How to apply:** When fixing, code-implementer should add `'../utils/storage-manager.tombstones.js'` to the `importScripts()` list in `background/service-worker.js`, positioned before `'../utils/storage-manager.js'`. Do NOT touch the test file — it's correctly red. `test/setup/vitest.setup.js` is intentionally exempt from the "before entry" ordering check in R5 (it never imports the entry file itself — specs do), only presence-of-bundles is checked there.
