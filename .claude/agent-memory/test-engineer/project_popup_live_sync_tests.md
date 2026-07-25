---
name: project_popup_live_sync_tests
description: Unit tests for popup/popup.live-sync.js createLiveSyncListener() and its wiring block in popup.js
metadata:
  type: project
---

Added `test/unit/popup-live-sync.spec.js` (37 tests, all passing) covering `popup/popup.live-sync.js`'s `createLiveSyncListener(ctx)` — the popup's `chrome.storage.onChanged` listener that mirrors [[project_sync_order_meta_tests]]-style cross-device sync into the currently-open popup UI without a manual refresh.

**Why real StorageManager instead of stubs:** for the PRESET_INDEX/PRESET_ORDER_META/dsPreset_* and CHAT_PRESET_MAP_META/chatPresetMap_* branches, the module calls `StorageManager.getSettings()` / `StorageManager.getChatPresetMap()` internally (fire-and-forget, not awaited by the caller). Seeding via `StorageManager.savePromptPresets(...)` / `saveChatPresetMap(...)` and asserting on the ctx's `setPresets`/`setChatPresetMap` callbacks exercises the real reload path instead of re-describing it.

**Gotcha — flush delay must be ~500ms, not a few event-loop ticks.** `getSettings()`/`getChatPresetMap()` chain through `_get -> _safeGet -> per-key _get` plus an internal write-lock queue, each hop resolving via `setTimeout(0)` in `InMemoryStorageMock`. 2-3 chained `await new Promise(r=>setTimeout(r,0))` was NOT enough (state stayed empty); a single real `setTimeout(r, 500)` reliably drains it. Measured full round-trip (`savePromptPresets` + `getSettings`) at ~390-700ms real time in this test file — budget for it, don't assume storage-mock calls resolve within a tick or two.

**Gotcha — popup.js has CRLF line endings.** A regex like `/\n {4}\}\);/` to extract a source block will silently fail to match (returns null, no error) because the file uses `\r\n`. Use `\r?\n` in any regex that spans multiple lines when extracting snippets from `popup/popup.js` via `readFileSync` + `.match()` (pattern used across `popup.spec.js`, `popup.sync-write-quota.spec.js`).

**Mocking approach for the onChanged listener itself:** don't rely on `chrome.storage.onChanged`'s real dispatch — `test/fixtures/chrome-storage-mock.js`'s `local` and `sync` areas keep *independent* `_listeners` arrays, and `vitest.setup.js` aliases `chrome.storage.onChanged` to the `local` mock only, so a `sync`-area write's `_notify` never reaches a listener registered via `chrome.storage.onChanged.addListener`. Instead, `vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation(fn => captured = fn)` to capture the exact registered callback, then invoke `captured(changes, namespace)` directly with hand-built change objects. This is also the only way to test the `namespace !== 'local' && namespace !== 'sync'` guard clause, since that check lives in the anonymous wrapper `start()` registers, not in the internal `handleChanges()`.

No production bugs found in this pass.
