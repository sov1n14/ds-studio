---
name: popup-refactor-v300-tests
description: v3.0.0 popup refactor test coverage — new files added, existing files fixed, migration-push defaults gotcha
metadata:
  type: project
---

v3.0.0 popup refactor added these new test files (all under ds-studio/test/unit/):
- `content-script.global-prompt-gating.spec.js` — 9 tests for isGlobalPromptEnabled gating in buildInjectionPrefix / injectPrefix
- `storage-manager.global-prompt-enabled.spec.js` — 6 tests for saveGlobalPromptEnabled / getSettings default / restoreSettings round-trip
- `messaging.spec.js` — 7 tests for broadcastActivePreset (DeepSeek-tab filter, rejection swallowing)
- `editor.spec.js` — ~25 tests for parseTarget, loadContent, saveContent, debounce, renderDisabledState, updateSaveStatus
- `popup-editor-window.spec.js` — 10 tests for openEditorWindow singleton (create/focus/recreate) and updateEditPresetBtnState

Fixed files:
- `popup.spec.js`: Replaced entire `initColumnLayout` suite with `updateEditPresetBtnState` and URL-construction tests (initColumnLayout deleted from source in v3.0.0)
- `storage-manager.migration-push.spec.js`: Added `GLOBAL_PROMPT_ENABLED: true` to `populateDefaults()` — the new key's default caused initialize() to fall into the defaults-fill path instead of migration-push path

**Why:** `populateDefaults()` must include ALL keys that StorageManager.DEFAULTS covers; any new DEFAULTS key breaks migration-push tests if missing from the helper.

**How to apply:** Whenever a new KEYS + DEFAULTS entry is added to storage-manager.js, also add that key to `populateDefaults()` in `storage-manager.migration-push.spec.js`.
