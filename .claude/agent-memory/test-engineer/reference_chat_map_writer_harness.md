---
name: reference-chat-map-writer-harness
description: test/helpers/chat-map-writer-harness.js recipe — fresh StorageManager instances, fs.existsSync + createRequire load of a not-yet-existing module, sendMessage double; plus which chat-map scenarios discriminate old direct-write code
metadata:
  type: reference
---

- A not-yet-existing module outside test/ MUST be loaded with fs.existsSync (throw "<file> does not exist") then Node createRequire(import.meta.url); a runtime import() of any file outside test/ fails with "Cannot find module" even for existing files under this Vite root (see testing-pitfalls red-for-the-right-reason). Prove the loader by pointing it at background/pending-store-routes.js once. test/unit/chat-map-routes.spec.js uses the same pattern (verified 2026-09-24).
- For truly independent StorageManager instances: `vi.resetModules()`, then re-import every `utils/storage-manager.*` part (via `import.meta.glob`, in the order parsed from test/setup/vitest.setup.js), then the entry. The parts DO get re-evaluated (confirmed 2026-09-24: new `__DS_StorageManager_chatmap` identity each time).
- Diagnostic run against old direct-write code (routes stubbed out), 2026-09-24: when clients are NOT initialized, A (lost update), B, D, G (stale meta cache) and I really fail. E, F, H and dispatch success / undelivered-once pass on old code, so for those tests only the missing router makes them fail.

**How to apply:** reuse the harness for any SW-single-writer chat-map spec; to see how well a test discriminates, stub loadRoutes temporarily, run the tests, then revert.

**Discrimination check without touching production (2026-09-24):** in a throwaway `test/unit/zz-tmp-*.spec.js`, load a fresh writer SM, wrap `sm._applyChatPresetMapDiff` with a hand-written mutant selected by `process.env.MUTANT`, paste the new tests in, run once per mutant, then Recycle-Bin the file. Used to prove the duplicate-key-delete and stale-meta-placement tests in storage-manager.chatmap.mutant-killers.spec.js fail on their mutants.

**Cost note:** the cache-free engine re-reads every chunk per mutation; the 80-bind cases in storage-manager.chunking.spec.js take 8-12 s each on real timers (file ~57 s). Use fake timers + `vi.runAllTimersAsync()` (as write-queue.spec does) if they start timing out.

**Scratch-mutant of a utils part (2026-09-24):** test/ has `"type": "module"`, so a scratch copy loaded with createRequire MUST be named `.cjs`; as `.js`, Node require(esm) returns an empty namespace and the mutant silently never applies (it looked like a surviving mutant). Probe with `String(sm.initialize).includes(<guard text>)` before trusting a mutant run. Apply by `Object.assign(clientSM, require(scratch))` (parts set module.exports = bundle). SW-side mutants: override `h.sw.applyChatMapOp` for one message type.

**Specs that must keep the global chrome.* (2026-09-24):** content-script / popup specs whose load-time listeners (onMessage broadcast, onChanged) must survive cannot use createChatMapWriterHarness (it swaps chrome.storage and onMessage). Seed stored chat-map state with the exported `writeChatMapLayout([chrome.storage.sync, chrome.storage.local], StorageManager.KEYS, [map])` instead. For the controller-only specs, `window.StorageManager = h.clients[0]` works because content code resolves the bare global at call time; restore it in afterEach. The SW rejects MERGE with null/undefined entries, so guard-mutant tests can assert "restoreSettings resolves + map unchanged".

**Proving a content-script startup test (2026-09-24):** load a scratch `.cjs` copy of content/content-script.js via createRequire, with its `require('./x')` rewritten to `require('../content/x')`; run it both unfixed (must fail identically) and with the fix applied (must pass). Test files are CRLF in the working tree (autocrlf): normalize before string-replacing in node edits.
