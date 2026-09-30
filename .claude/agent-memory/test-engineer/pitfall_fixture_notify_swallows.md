---
name: pitfall-fixture-notify-swallows
description: chrome-storage-mock _notify swallows listener exceptions; use setup onChanged.callListeners when a test asserts a listener throw does not escape
metadata:
  type: feedback
---

The shared fixture `test/fixtures/chrome-storage-mock.js` delivers onChanged via `_notify`, which wraps each listener in try/catch and swallows. A spec asserting "a throwing subscriber must not escape the storage listener" (`expect(() => fire()).not.toThrow()`) becomes vacuous if it fires through a real `set()`. Use `chrome.storage.onChanged.callListeners(changes, area)` from test/setup/vitest.setup.js instead (raw dispatch, exceptions propagate), plus the setup exports `getStorageOnChangedListenerCount` / `resetStorageOnChangedListeners` (reset in afterEach when each test registers its own listener).

**Why:** found 2026-09-24 while moving i18n.lifecycle.spec.js off its hand-rolled chrome fake onto the shared mock.
**How to apply:** any spec that migrates to the shared storage mock and asserts on listener exception propagation.
