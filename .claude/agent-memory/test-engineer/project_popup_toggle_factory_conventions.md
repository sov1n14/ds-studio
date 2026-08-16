---
name: project-popup-toggle-factory-conventions
description: ds-studio popup/*.js factory modules (createToggleManager, createLiveSyncListener, createPresetManager) share one ctx accessor convention and one eval()-based test-loading pattern
metadata:
  type: project
---

`popup/popup.toggles.js`, `popup/popup.live-sync.js`, and `popup/popup.preset-manager.js`
are all standalone classic-script factories mounted on `window.__DS_Popup*`
(no ES module export - loaded via `<script>` tag in production, and via
`eval(readFileSync(...))` in Vitest specs - see `test/unit/popup-live-sync.spec.js`
and the new `test/unit/popup-global-prompt-toggle.spec.js`).

Every factory in this family takes a `ctx` object using the SAME accessor
naming convention for shared popup state, wired identically in
`popup/popup.js`'s `DOMContentLoaded` closure:
`getPresets`/`setPresets`, `getActivePresetId`/`setActivePresetId`,
`getPinnedPresetId`/`setPinnedPresetId`, `getChatPresetMap`/`setChatPresetMap`,
`getCustomSelect`. `StorageManager`, `refreshSyncStatus`, `showSaveStatus`,
`applyMasterSwitchUI` are also passed straight through from popup.js.

**Why:** popup.js's DOMContentLoaded closure is a single un-exported function
with heavy cross-module coupling - no spec runs it end-to-end. Every
sub-feature spec instead loads its OWN small factory module directly and
builds a `ctx` mock that mirrors the real wiring block in popup.js line-by-line
(copy the accessor names, not just "something similar").

**How to apply:** When writing a NEW test for a not-yet-implemented popup
factory function (TDD red phase), derive the ctx shape from this existing
convention rather than inventing a new one - it's the project's real
contract, and code-implementer is very likely to follow the same pattern
that every other factory already uses. See
`docs/requirements/global-prompt-per-preset-toggle.md` for the current
in-flight feature (branch `feat/prompt-group-global-prompt-toggle`): the
`#globalPromptToggle` toggle is being changed from a single global
device-local setting to a per-preset field, resolved via
`StorageManager.resolveGlobalPromptEnabled(activePreset, legacyGlobalFlag)`
(pure function: `activePreset.globalPromptEnabled ?? true` if a preset is
active, else the legacy flag) and written back via the existing
`StorageManager.saveOnePromptPreset(preset)` (must also bump `preset.updatedAt`)
when a preset is active, or the pre-existing `StorageManager.saveGlobalPromptEnabled(bool)`
(device-local only) when it is not.
