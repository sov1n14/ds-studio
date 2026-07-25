---
name: preset-delete-all-tests
description: Tests added for preset-item-renderer.js, custom-select.js delete-all wiring, requestDeleteAllPresets(), and new i18n keys
metadata:
  type: project
---

Added/extended for the "delete all presets" feature (hover tooltips, icon fix, delete-all button + confirm dialog):
- `test/unit/preset-item-renderer.spec.js` (new) — escapeHtml (no `'` escaping — implementation only handles `& < > "`) and buildPresetItemMarkup structure/i18n checks.
- `test/unit/popup-custom-select.spec.js` (extended) — added `.ds-select__item-btn--delete-all` to the blank-item test fixture markup, added `onRequestDeleteAll` to the `createSelect()` test harness, added a describe block covering: click invokes callback, does not also fire `onSelect('')`, omitted callback doesn't throw, per-item edit/delete still work (regression).
- `test/unit/popup-preset-manager.spec.js` (new) — `createPresetManager(ctx).requestDeleteAllPresets()`: no-op when empty, cancel path (no mutation/no storage calls), confirm path (presets→[], activePresetId→'', StorageManager.savePromptPresets/saveActivePresetId called, chatPresetMap entries for ALL previously-existing preset ids pruned — unlike single-delete which only clears one id), post-confirm UI refresh calls.
- `test/unit/i18n.spec.js` (extended) — new keys (`editPresetNameTooltip`, `deletePresetTooltip`, `deleteAllPresetsTooltip`, `deleteAllPresetsTitle`, `deleteAllPresetsMessage`) resolve non-empty in both locales.

**Gap found in existing test harness (fixed, not feature code):** `popup-custom-select.spec.js`'s `beforeAll` only evaluated `custom-select.js`, but that file now destructures `global.__DS_PresetItemRenderer` at call time (from the code-implementer's new `preset-item-renderer.js`) — every existing test in that file broke with "Cannot destructure property 'buildPresetItemMarkup' of undefined" until `preset-item-renderer.js` (and `utils/i18n.js`, since the renderer calls `dsI18n.t()`) were loaded first, mirroring the real `<script>` order in `popup/popup.html`. Watch for this pattern whenever a classic-script module gains a new same-layer dependency — existing specs that `eval()` the file in isolation will need their `beforeAll` load order updated too.

**i18n gotcha:** `deleteAllPresetsTitle` and `deleteAllPresetsTooltip` intentionally have identical zh_TW/en copy — don't assert cross-key distinctness across all new i18n keys in the same locale.

All 70 scoped tests pass (`npx vitest run unit/preset-item-renderer.spec.js unit/popup-custom-select.spec.js unit/popup-preset-manager.spec.js unit/i18n.spec.js --config vitest.config.js` from `test/`).

No wiring test added for `popup.js`/`popup.html` script load order or the `onRequestDeleteAll` callback plumbing — confirmed via grep that sibling callbacks (`onRequestEdit`/`onRequestDelete`) also have no such wiring test in `popup.spec.js`, so this stays consistent with existing convention.
