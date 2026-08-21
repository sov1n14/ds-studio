---
name: content-script-broadcast-bootstrap
description: How a content-script.js spec waits for the bootstrap and delivers setting changes now that it listens to runtime.onMessage instead of storage.onChanged
metadata:
  type: project
---

`content/content-script.js` receives setting changes as a `chrome.runtime.onMessage` broadcast (`{type:'DSS_SETTINGS_CHANGED', area, changes}`, both `local` and `sync` accepted), not via `chrome.storage.onChanged`. Two consequences for its specs:

- Bootstrap-completion signal: poll `chrome.runtime.onMessage.listenerCount() >= 2` (helper added to `createMockEvent()` in `test/setup/vitest.setup.js`). The popup message router registers synchronously at module load; the settings-broadcast receiver is the LAST statement of the unawaited `initSettings()`. Count 1 means the bootstrap is still running. `getStorageOnChangedListenerCount()` never rises for content scripts.
- A storage write alone changes nothing observable: no background page runs in the suite, so the spec must seed storage AND then call `chrome.runtime.onMessage.callListeners({type:'DSS_SETTINGS_CHANGED', area:'local', changes}, {}, () => {})` itself.

**Why:** the 2026-08 rewiring silently turned every storage-mutation-driven content-script spec into a `beforeEach` timeout (7 in content-script.global-prompt-resolution.spec.js).

**How to apply:** copy the `waitForContentScriptBootstrap()` + `broadcastSettingsChanged()` helper pair from `test/unit/content-script.global-prompt-resolution.spec.js` or `test/unit/content-script.overlay-selection.spec.js`. Cheap non-vacuity proof for any such spec: `sed` the broadcast line out and re-run — it must fail. See [[pitfall-broadcast-specs]] and [[messaging-spec-harness]].
