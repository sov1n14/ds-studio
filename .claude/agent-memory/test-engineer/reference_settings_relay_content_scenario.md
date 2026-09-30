---
name: reference-settings-relay-content-scenario
description: Content-script scenario specs - relay chrome.storage.onChanged to DSS_SETTINGS_CHANGED so activePresetId-driven isGlobalPromptEnabled is exercised; default sendMessage vi.fn() makes every client chat-map write fail
metadata:
  type: reference
---

In content-script scenario specs no SW runs, so a spec that only calls onSelectChange never sees the broadcast that makes `refreshGlobalPromptEnabled` read `activePresetId`. Add `chrome.storage.onChanged.addListener((changes, area) => chrome.runtime.onMessage.callListeners({ type: 'DSS_SETTINGS_CHANGED', area, changes }, {}, () => {}))` (remove in afterEach) to play settings-routes. Shared harness: test/helpers/overlay-consistency-harness.js (setUpOverlayScenario, openChat, injected, unrelatedPresetEditArrives); used by overlay-failed-bind-consistency and global-flag-follows-display specs. On 2026-09-24 code, navigating to a bound chat or a pinned new chat already rewrites activePresetId; only unbound / unpinned-new paths leave it stale.

Also: setup's `chrome.runtime.sendMessage` is a bare `vi.fn()` returning undefined, so every client bind/unbind rejects with ChatMapDispatchError unless the spec installs a success transport. The injected-prefix invariant has two parts: own content (chatPresetMap) and the global-prompt flag (activePresetId). Assert both. Related: [[sw-test-harness]].
