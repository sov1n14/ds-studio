---
name: popup-permission-toggle-red
description: Red-phase method for a popup toggle gated by chrome.permissions (reply-notification, 2026-11-08) - markup-gated reds need an injected-markup oracle, onChanged write recorder catches transient saves
metadata:
  type: project
---

`test/unit/popup-reply-notification-toggle.spec.js` (2026-11-08) drives real popup.html DOM plus the real `utils/notification-permission.js` wrapper, mocking only `chrome.permissions` (absent from vitest.setup.js, install and delete per test).

**Why:** every behavior test fails first at the missing markup, so the red run alone proves nothing about the handler assertions. A scratch copy that injects the expected markup into popup.html showed the next-layer reds (no handler, no settings-view or live-sync wiring) and let wrong oracles (no revert, save-before-permission, request always, status on refusal, status before save, cross-wired live sync) each fail at least one test.

**How to apply:** for a refusal path, record every local write of the key through `chrome.storage.onChanged` (real event from the double) and assert true never appears; "stored value stays false or absent" alone lets a save-first-then-rollback implementation pass. `getSettings()` fills defaults, so an "absent setting" case must pass a settings object with the field deleted, or a `!== false` default-on mutant survives. See [[scratch-and-oracle-check]], [[reference-popup-html-real-dom]].
