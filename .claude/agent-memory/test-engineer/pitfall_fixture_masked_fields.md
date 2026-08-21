---
name: fixture-reset-masks-removed-fields
description: A shared reset helper that assigns module fields can keep a spec assertion green after the production field is deleted - grep helpers when a refactor removes state
metadata:
  type: project
---

When a refactor deletes a state field, a shared reset helper that still assigns it silently recreates it on the module object, so any spec asserting that field's default keeps passing against a field that no longer exists. Hit on 2026-08-22: `test/helpers/go-top-fixtures.js` `resetGoToTopState()` set `_enableRetryTimer` / `_enableRetryCount` after `content/go-top.js` had replaced them with the `DSSRetryUntil` cancel handle (`_cancelConnectRetry`); `go-top.button.spec.js`'s "has default state values" test was green on resurrected fields and only failed once the helper was cleaned.

**Why:** the 28 reported failures were the visible half; this one was invisible because the helper wrote the field back. Test-count parity is not proof the re-point is complete.

**How to apply:** after removing references to a deleted field from specs, grep the WHOLE `test/` tree (helpers and fixtures included) for the identifier and expect zero hits. Then run every spec that imports the shared helper, not only the specs named in the directive. Also check the helper still tears down whatever replaced the field — `resetGoToTopState()` needed an explicit `_stopConnectRetry()` because `disable()` no-ops when `enabled` is already false, leaking a live poll into the next test.
