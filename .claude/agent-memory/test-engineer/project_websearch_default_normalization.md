---
name: websearch-default-normalization-two-read-paths
description: StorageManager has TWO read paths and only getSettings() normalizes the legacy dsWebSearchToggle "default" value; the DSS_GET_SETTINGS key route does not
metadata:
  type: project
---

Backlog B9 says to push the 'default' -> 'on' normalization down into StorageManager. Half of it already shipped: getSettings() normalizes (covered green by test/unit/storage-manager.websearch-toggle.spec.js). The key-based DSS_GET_SETTINGS route in background/settings-routes.js is a SEPARATE read path that returns raw storage values with a DEFAULTS fallback, so it still hands out 'default' verbatim. content/websearch-toggle.js compensates with its own _normalizeMode().

**Why:** the camelCase getSettings() surface and the raw-key message route look interchangeable but are not; assuming one implies the other turns a real red into a "pre-satisfied" false report.

**How to apply:** any "normalize on read" requirement needs an assertion on BOTH surfaces. Red for the route lives in test/unit/settings-routes.spec.js under the DSS_GET_SETTINGS describe. See [[messaging-spec-harness]].