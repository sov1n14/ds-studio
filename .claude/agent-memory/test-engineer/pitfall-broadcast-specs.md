---
name: pitfall-broadcast-specs
description: Flakiness trap when specing chrome.storage.onChanged broadcast code - the global beforeEach storage clear emits its own onChanged event
metadata:
  type: project
---

Specs that assert on a `chrome.storage.onChanged` listener (e.g. background broadcast to tabs) must drain and reset the tab spies at the START of each test.

**Why:** `test/setup/vitest.setup.js` has a global `beforeEach` that calls `storageMock.local.clear()`, and the in-memory mock's `clear()` fires `onChanged` with every previously-seeded key. Seeded keys are usually watched keys, so the listener under test broadcasts once per test before the test body runs, polluting `chrome.tabs.query` / `chrome.tabs.sendMessage` call records.

**How to apply:** in the spec's own `beforeEach`, set resolving defaults on `chrome.tabs.query` / `sendMessage`, `await` a few `setTimeout(0)` ticks to drain the stray broadcast, then `mockReset()` both and re-set the defaults. Also: `chrome.runtime.onMessage` listeners cannot be removed through the mock (no reset helper) - install the module under test ONCE in `beforeAll`, or every response fires N times. `chrome.storage.onChanged` DOES have `resetStorageOnChangedListeners()` exported from the setup file.
