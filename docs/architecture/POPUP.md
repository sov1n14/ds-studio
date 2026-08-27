# Popup 與編輯器架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › Popup 與編輯器
>
> **相關規格**：[Popup UI 規格](../spec/02-popup-ui.md) · [提示詞系統](../spec/01-prompt-system.md)

## Preset Selector & Management

The popup includes a preset selector row composed of:
- A custom combobox component (`custom-select.js`) replacing the old native `<select id="presetList">`. See the Custom Preset Dropdown section below for detailed architecture.
- Inline action buttons: a pin toggle and delete (`✕`), both rendered inside each dropdown row, plus a standalone `+` button for adding new presets. (v4.14.0 — the per-row rename pencil was removed; renaming now happens inside the standalone editor window. v4.18.0 — the pin toggle was added to the left of `✕`.)

**Add flow**: Click `+` → `Modal.prompt('新增提示詞組')` with required-field validation → user enters name → preset created with empty content → auto-selected → if on a bound conversation, updates the binding → user edits content in textarea.

**Rename flow (v4.14.0)**: Renaming happens in the standalone editor window. Click `#editPresetBtn` → the editor opens with the preset name shown in a focused, selected name input (`#editorNameInput`) in the header → editing the name joins the same auto-save pipeline as the content (500 ms debounce + flush on blur/close). Duplicate names are rejected at save time (`DUPLICATE_NAME`) and surfaced as a red error in the save-status area; the save is blocked until the name is unique. The open popup's dropdown refreshes automatically via live-sync. (Pre-v4.14.0 the flow was: click `✎` in the dropdown row → `Modal.prompt('重新命名', { value: currentName })`.)

**Pin (default preset) flow (v4.18.0)**: Click the per-row pin → `custom-select.js`'s delegated panel handler matches `.ds-select__item-btn--pin`, stops propagation (so the click neither selects the row nor closes the panel) and calls `onRequestTogglePin(presetId)` → `popup.js` delegates to `popup.pin-manager.js`'s `togglePin(id)`, which persists via `StorageManager.savePinnedPresetId(id)`, updates popup.js's cached `pinnedPresetId`, and fires `onPinChanged()` to re-render the dropdown with the new lit state. Clicking the already-pinned row's pin persists `''` instead (toggle-off). Because the pinned default is a single scalar key, pinning a second preset implicitly unpins the first — there is no uniqueness check to get wrong. The pin is read by the content script only when a new conversation is opened; see `docs/spec/01-prompt-system.md` §6.

**Delete flow**: Click `✕` → `Modal.confirm('刪除提示詞組', { variant: 'danger' })` → confirmed → preset removed from array, any `chatPresetMap` bindings pointing to the deleted preset are cleaned up. If the deleted preset was the active one, `activePresetId` is cleared to `''` (empty state). (v4.18.0) Both `requestDeletePreset(id)` and `requestDeleteAllPresets()` also call `ctx.pinManager?.clearPinIfDeleted([...ids])`, which clears `pinnedPresetId` only when the pinned preset is among the deleted ones and otherwise performs no storage write at all. Delete is disabled when the empty state is selected. The system allows deleting all custom presets, as the empty option always remains as a fallback. (v4.8.3) Deletion also records a tombstone in `dsPresetTombstones` (local + sync) so the deletion propagates correctly to other devices during conflict-resolution merge instead of being resurrected by a stale copy.

**Content editing (v3.0.0, timing updated v4.8.1, name editing v4.14.0)**: The popup no longer hosts a content textarea. A pencil button (`#editPresetBtn`, rightmost in the controls row, disabled when `activePresetId === ''`) opens the standalone editor window at `popup/editor/editor.html?target=preset&id=<activePresetId>` (1280×720, singleton focus-or-create). The editor auto-saves via dirty flag + debounced input (500 ms) + `blur`/`visibilitychange`/`pagehide`, and broadcasts `ACTIVE_PRESET_CHANGED` after each preset save. Since v4.14.0 the editor is also the rename surface: preset targets show a focused name input in the header (the `#editorTitle` h1 is hidden), wired into the same auto-save pipeline, with duplicate-name rejection (`isDuplicateName` check in `saveContent`, error surfaced in `#editorSaveStatus`). Global targets keep the read-only h1.

**Chat/input width sliders (debounced write, v4.8.1)**: `chatWidthSlider` and `inputWidthSlider` separate their `input` event (updates the live percentage label synchronously, no storage write) from their `change` event (calls a 500 ms debounced wrapper — `debouncedSaveChatWidth` / `debouncedSaveInputWidth` — that persists the value via `StorageManager.saveChatWidth()` / `saveInputWidth()`, then refreshes sync status). This aligns the slider write cadence with the editor's 500 ms auto-save debounce, reducing `chrome.storage` write pressure during drag. The corresponding toggle switches (`chatWidthToggle`, `inputWidthToggle`) remain synchronous/undebounced. The debounce wrapper itself comes from the shared `utils/debounce.js` module, which publishes `globalThis.DSSDebounce`; `popup.width-sliders.js` binds it as `const debounce = DSSDebounce;`.

## Custom Modal System

A custom inline modal controller (`Modal`) replaces browser-native `prompt()`, `confirm()`, and `alert()` dialogs, which cannot be styled or positioned within the popup.

**DOM structure**: A `position: fixed` overlay (with semi-transparent background) covers the entire popup area, centered vertically and horizontally. The dialog box contains a title, optional message, optional input field with a `* 必填` validation indicator, and action buttons.

**API**:
- `Modal.prompt({ title, value?, placeholder? })` → `Promise<string | null>` — Shows an input dialog. The confirm button is disabled when the input is empty, and a red `* 必填` indicator appears. Overlay click does NOT dismiss; only Cancel button or Escape key closes.
- `Modal.confirm({ title, message?, confirmText?, cancelText?, variant? })` → `Promise<boolean>` — Shows a confirmation dialog. Pass `cancelText: null` for single-button (alert) mode. Pass `variant: 'danger'` for a red-styled confirm button (used for destructive actions like delete).
- Name uniqueness validation is performed after submission; duplicate names trigger a follow-up `Modal.confirm` alert.

**Behavior**:
- Overlay click does NOT dismiss any modal (prevents accidental loss of input).
- Escape key dismisses with cancel/null result.
- Enter key in prompt mode confirms only when input is non-empty.
- All modal state (required indicator, input display) is fully cleaned up between calls.

## Custom Preset Dropdown (custom-select.js)

The preset selector in v1.6.x was a native `<select>` element (`#presetList`) with limited styling and no search or drag support. v1.9.0 replaces it with a fully custom combobox component implemented in `popup/custom-select.js`.

### Module Structure

`custom-select.js` is a standalone classic script (not an ES module) wrapped in an IIFE:

```javascript
(function (global) {
    'use strict';
    // ... private functions ...
    global.__DSSCustomSelect = { createPresetCustomSelect };
})(window);
```

This design allows the component to be loaded as a plain `<script>` tag in `popup.html` without requiring module bundling. It exposes a single factory function on `window.__DSSCustomSelect`.

### Public API

`createPresetCustomSelect(options)` returns an object with three methods:

| Method | Description |
|-|-|
| `render()` | Re-renders the trigger text and the dropdown list from current state. Called after any preset list mutation (add, delete, reorder, active change, pin change); renames from the editor window arrive via live-sync. |
| `open()` | Opens the dropdown panel. Clears search input, resets filter, re-renders full list, focuses search input. Registers an outside-click listener. |
| `close()` | Closes the dropdown panel. Unregisters outside-click listener. |

Open/closed state is tracked internally on `state.isOpen` and toggled by the trigger's own click handler; the active-preset display is a derived read inside `render()` (via the `getActivePresetId` callback), so callers re-render rather than pushing the active id in.

### Options (input contract)

The factory receives a configuration object with the following properties:

| Option | Type | Description |
|-|-|-|
| `triggerEl` | `Element` | The combobox trigger (`#presetSelect`, a `<div>` with `role="combobox"`). |
| `panelEl` | `Element` | The dropdown panel (`#presetSelectPanel`). |
| `valueEl` | `Element` | The trigger text span (`#presetSelectValue`). |
| `searchInputEl` | `Element` | The search input field (`#presetSearchInput`). |
| `listEl` | `Element` | The list container for preset items (`#presetSelectList`). |
| `blankItemEl` | `Element` | The static "(無提示詞組)" blank option element. |
| `emptyHintEl` | `Element` | The "無相符結果" empty-search hint element. |
| `getPresets` | `Function` | Returns the current `presets` array. |
| `getActivePresetId` | `Function` | Returns the current `activePresetId`. |
| `getPinnedPresetId` | `Function` (v4.18.0, optional) | Returns the currently pinned preset id (`''` when none). Read once per render; the row whose id matches is rendered with the lit pin. Omitting it renders every row unpinned rather than throwing, so callers that do not support pinning keep working. |
| `onRequestTogglePin` | `Function` (v4.18.0, optional) | Called with `(presetId)` when a row's pin button is clicked. The handler stops propagation before the row-selection branch and never closes the panel, mirroring `onRequestDelete`. Omitting it makes pin clicks a harmless no-op. |
| `onSelect` | `Function` | Called with `(presetId)` when a user clicks a preset item. The caller (popup.js) handles storage persistence and chat binding. |
| `onReorder` | `Function` | Called with `(newPresets)` after a drag-reorder completes. The caller persists the new order to storage. |
| `onRequestDelete` | `Function` | Called with `(presetId)` when the delete button is clicked. popup.js opens a delete confirmation modal. |
| `onRequestDeleteAll` | `Function` (v4.10.0) | Called with no arguments when the "delete all" button on the blank `(無提示詞組)` item is clicked. popup.js opens a "delete all presets" confirmation modal via `presetManager.requestDeleteAllPresets()`. The panel click handler stops propagation on this button before the blank-item `onSelect('')` branch runs, so a delete-all click never also selects the blank option. |

This "inversion of control" pattern keeps the component agnostic to storage logic: it only manages DOM and interaction state, while the caller (popup.js) owns persistence and business logic.

### Internal State Machine

The component maintains a single `state` object with the following fields:

| Field | Type | Description |
|-|-|-|
| `isOpen` | `boolean` | Whether the dropdown panel is visible. |
| `keyword` | `string` | The current search input value. |
| `filteredIds` | `Set<string>` | IDs of presets matching the current keyword. |

Drag session state (the active drag record and the pending-activation flag behind the 5px threshold) is not part of this object — it lives inside the `createDragReorder()` closure in `popup/custom-select.drag.js`, which `custom-select.js` consults only through `isDragging()`.

### Key Internal Functions

- **`_updateTrigger()`**: Reads the active preset ID, finds its name in the presets list, and sets `valueEl.textContent`. Falls back to "(無提示詞組)" when no preset is active.

- **`_renderList()`**: Rebuilds the dropdown list DOM. Iterates presets, filters by `filteredIds`, and creates `div.ds-select__item` elements with three child regions:
  - Drag handle (`⠿` character, class `ds-select__drag-handle`)
  - Item name (class `ds-select__item-name`, HTML-escaped)
  - Inline action buttons (delete only since v4.14.0, class `ds-select__item-btn--delete`), carrying an i18n `title`/`aria-label` (delete: `刪除提示詞`; the per-row rename pencil was removed in v4.14.0 — renaming moved into the editor window)
  - Skips rendering when a drag is in progress (`_dragReorder.isDragging()`) to avoid DOM churn during drag.
  - Calls `_dragReorder.bindHandles()` after populating the list to attach pointer event handlers to each drag handle.
  - Row markup is built by `buildPresetItemMarkup(preset)` in `popup/preset-item-renderer.js` (v4.10.0 — extracted from `custom-select.js` to stay under the 450-line proactive-split threshold). The delete button keeps the `✕` glyph.

- **`_applyFilter()`**: Reads the current search input value, iterates all presets with `_fuzzyMatch()`, updates `filteredIds`, and calls `_renderList()`. Called via a debounced wrapper `_debouncedFilter`.

- **`_registerOutsideClick()` / `_unregisterOutsideClick()`**: Manages a `pointerdown` listener on `document` that calls `close()` when the user clicks outside the trigger, panel, or add-preset button.

- **`_bindEvents()`**: Called once during construction. Sets up:
  - Trigger click → toggle open/close.
  - Search input `input` → `_debouncedFilter` (400ms debounce).
  - Panel click → routes clicks, in this order, to delete-all, blank-option selection, per-row delete, per-row pin, then preset selection.
  - `pointerdown` stop-propagation on trigger, search input, and panel to prevent outside-click handler from closing immediately after opening.

### Drag and Reorder Implementation (custom-select.drag.js)

Drag lives in its own module, `popup/custom-select.drag.js`, which registers `window.__DSSCustomSelectDrag = { createDragReorder, reorderPresets }` and must load before `custom-select.js` — the factory throws a named error if it is missing. `createDragReorder(deps)` takes `listEl`, `getPresets`, `getKeyword`, `onReorder`, `onSelect`, `closePanel`, and `renderList`, and returns only `{ bindHandles, isDragging }`, so the whole drag session stays private to that closure. `reorderPresets(presets, srcId, dstId, isInsertBefore)` is exported separately as a pure array transform.

Drag uses the Pointer Events API for unified mouse+touch handling, bypassing the HTML Drag and Drop API for finer control and visual fidelity:

1. **Arming**: `_onHandlePointerDown` records the starting position and enters an armed state (`state.dragArmed = true`). Pointer capture is set on the handle element to receive events even outside the handle bounds.

2. **Activation**: `_onPointerMove` computes `Math.hypot(dx, dy)`. Once the cursor moves 5px from the start, `_activateDrag()` is called:
   - The source item gets `ds-select__item--dragging` (CSS opacity reduction).
   - A `div.ds-select__drag-ghost` is created, positioned absolutely at the cursor, following the pointer via `translate()`.
   - The ghost displays the preset name as plain text, serving as a lightweight drag preview.

3. **Insertion line**: `_updateInsertionLine()` iterates all non-dragging list items, finds the one closest to the cursor's Y position (bisected by each item's vertical midpoint), and places a `div.ds-select__insertion-line` at the appropriate position. This line is a thin visual indicator showing where the dragged preset will land.

4. **Completion**: `_onPointerUp` finalizes the drag:
   - If a ghost was created (meaning the 5px threshold was crossed), it calls the pure `reorderPresets()` helper and invokes the `onReorder` callback with the new array.
   - If no ghost was created (a tap rather than a drag), it treats the interaction as a selection click and calls `onSelect(drag.id)` + `close()`.
   - `_removeDragVisuals()` cleans up all drag artifacts.

5. **Cancel**: `_onPointerCancel` removes drag visuals and calls `_renderList()` to restore normal list state.

### Search and Debounce

- **`_fuzzyMatch(name, keyword)`**: A character-by-character sequential match (not true fuzzy / Levenshtein). Iterates characters in `name`; each character that matches the next unconsumed character of `keyword` advances the pointer. Returns `true` if all keyword characters are consumed. This handles substring matching and supports partial character skips in the name.

- **Debounce**: The search input uses a 400ms debounce, balancing responsiveness against filtering cost during typing. The wrapper is the shared one — `custom-select.js` binds `const _debounce = DSSDebounce;` from `utils/debounce.js` and applies it as `_debounce(_applyFilter, 400)`.

Note: `_fuzzyMatch()` remains a private module-level function in `custom-select.js`. The former ES-module duplicates in `popup/popup-utils.js` were deleted in the v4.11.x audit — that file existed only to be imported by tests, never by production code, so the tests were retargeted onto the real implementations and the duplicate removed.

### Shared Debounce Module (utils/debounce.js)

`utils/debounce.js` is the single trailing-edge debounce implementation for the whole extension. It is a classic script whose only load-time effect is `globalThis.DSSDebounce = debounce;`, plus a `module.exports` line for the Vitest path. Every consumer binds it by reference rather than redefining it: `custom-select.js` (`_debounce`), `popup.width-sliders.js` (`debounce`), and `popup/editor/editor.js` (`debounce`). `popup.html` and `editor.html` both load it immediately after `logger.js`, before any consumer.

### Delete-All Button (blank item, v4.10.0)

The static "(無提示詞組)" blank item (`blankItemEl`) now also renders a `.ds-select__item-btn--delete-all` button (`✕` glyph, i18n title `刪除全部提示詞組`), positioned like the per-row delete buttons and revealed on hover via the same `.ds-select__item--empty:hover .ds-select__item-btn` rule in `popup-select.css`. The panel click handler in `_bindEvents()` checks for this button class before the blank-option selection branch, calls `onRequestDeleteAll()`, and returns early (stopping propagation) so the click never also fires `onSelect('')`. `popup.preset-manager.js`'s `requestDeleteAllPresets()` mirrors `requestDeletePreset(id)`: it confirms via `Modal.confirm({ title: '刪除全部提示詞組', message: '確定要刪除全部提示詞組嗎？此操作無法復原。', variant: 'danger' })`, then on confirm clears `presets` to `[]`, resets `activePresetId` to `''`, strips every `chatPresetMap` entry that referenced any previously-existing preset id (not just one, unlike the single-delete path), and calls `StorageManager.savePromptPresets([])` — reusing the existing tombstone/cleanup machinery in `storage-manager.presets.js`, since it diffs the old vs. new `PRESET_INDEX` to compute `deletedIds`.

### Module Loading Order

In `popup.html`, the script tags appear in this order:

```html
<script src="../utils/logger.js"></script>
<script src="../utils/debounce.js"></script>
<script src="../utils/tab-control.js"></script>
<script src="../utils/window-control.js"></script>
<script src="../utils/editor-window-constants.js"></script>
<script src="../utils/storage-manager.chunk-lock.js"></script>
<script src="../utils/storage-manager.sync.js"></script>
<script src="../utils/storage-manager.presets.js"></script>
<script src="../utils/storage-manager.chatmap.js"></script>
<script src="../utils/storage-manager.local.js"></script>
<script src="../utils/storage-manager.init.js"></script>
<script src="../utils/storage-manager.setters.js"></script>
<script src="../utils/storage-manager.settings-read.js"></script>
<script src="../utils/storage-manager.js"></script>
<script src="../utils/i18n.locales.js"></script>
<script src="../utils/i18n.js"></script>
<script src="popup.i18n-apply.js"></script>
<script src="preset-item-renderer.js"></script>
<script src="custom-select.drag.js"></script>
<script src="custom-select.js"></script>
<script src="popup.modal.js"></script>
<script src="popup.toast.js"></script>
<script src="popup.preset-domain.js"></script>
<script src="popup.preset-manager.js"></script>
<script src="popup.pin-manager.js"></script>
<script src="popup.backup-manager.js"></script>
<script src="popup.settings-view.js"></script>
<script src="popup.live-sync.js"></script>
<script src="popup.editor-window.js"></script>
<script src="popup.width-sliders.js"></script>
<script src="popup.markdown-export.js"></script>
<script src="popup.toggles.js"></script>
<script src="popup.locale.js"></script>
<script src="popup.js"></script>
```

- `utils/logger.js` loads first, providing structured logging, followed by the three layer-agnostic helpers `utils/debounce.js` (`DSSDebounce`), `utils/tab-control.js` (`DSSTabControl`), and `utils/window-control.js` (`DSSWindowControl`), then `utils/editor-window-constants.js` (`DSS_EDITOR_WINDOW`, v4.29.0). The eight `storage-manager.*.js` bundles (chunk-lock, sync, presets, chatmap, local, init, setters, settings-read) load next; each attaches its method group to a `globalThis.__DS_StorageManager_*` key (v4.0.0 split; consolidated from nine bundles to six in v4.11.3, back up to seven when `setters` was split out of the entry file, and to eight when the settings-read group followed).
- `utils/storage-manager.settings-read.js` registers `globalThis.__DS_StorageManager_settingsRead`, holding the read side of the settings API: `getSettings()` and `getActivePromptContent()`. `getSettings()` is allowlist-driven rather than key-space-driven — two module-level maps, `SYNCED_SETTINGS_KEYS` (17 entries: `presetIndex`, `activePresetId`, `pinnedPresetId`, `includeThinking`, `includeReferences`, `globalDefaultPrompt`, `sidebarAutoHide`, `hideThinking`, `preventAutoScroll`, `websearchToggle`, `showSystemTime`, `chatWidth`, `chatWidthEnabled`, `inputWidth`, `inputWidthEnabled`, `syncInitialized`, `syncConflictPending`) and `LOCAL_ONLY_SETTINGS_KEYS` (2 entries: `isEnabled`, `globalPromptEnabled`, read from `chrome.storage.local` without the sync merge path), name every key that may surface. Anything on `StorageManager.KEYS` that is absent from both maps — sync retry bookkeeping, chunk layout metadata, key-prefix constants — is internal detail and never appears in the returned object. `promptPresets` (hydrated from `PRESET_INDEX`) and `chatPresetMap` (chunked, fetched via `getChatPresetMap()`) are appended afterwards, so the returned object carries 21 fields. `websearchToggle` passes through the shared `normalizeWebsearchToggle()` so the legacy `'default'` value resolves consistently on every read path.
- `storage-manager.js` (entry) loads next and runs `Object.assign(StorageManager, ...)` to merge the bundles before exposing `window.StorageManager`. Both custom-select.js users and popup.js depend on it at runtime.

**Load-order invariant (v4.11.3).** The only ordering constraint is that **every bundle must be loaded before the entry file**. The order *among* the bundles is irrelevant: no bundle executes anything at IIFE top level beyond assigning its own global, and every cross-bundle call goes through `this.<method>()` inside an `async` body, resolved at call time rather than load time.

This invariant is load-bearing and fails **silently** when violated. The entry file merges each bundle as `root.__DS_StorageManager_X || {}`, so a bundle that has not loaded yet mixes in as an empty object: every method it provides is simply absent for the lifetime of that context, with no error and no console warning. This is not hypothetical — before v4.11.3, `background/service-worker.js` omitted `storage-manager.tombstones.js` from its `importScripts` list while `resolveSyncConflict()` called `_mergeTombstones()`, so background sync retry threw `TypeError` into a deliberately swallowing `catch` and had been silently dead. See `docs/changelog/v4.md` (4.11.3).

Five loaders must therefore stay in agreement: `manifest.json` (`content_scripts[0].js`), `popup/popup.html`, `popup/editor/editor.html`, `background/service-worker.js` (`importScripts`), and `test/setup/vitest.setup.js`. `test/unit/storage-manager.loader-contract.spec.js` enforces this automatically — it discovers the bundle set from the entry file's `Object.assign` call and from the `utils/` directory listing, then asserts every loader lists every bundle and places it before the entry file. Adding or renaming a bundle without updating a loader fails that test rather than silently breaking a runtime context.
- `messaging.js` registers `window.DSVMessaging` (used by popup.js and editor.js for the `ACTIVE_PRESET_CHANGED` broadcast). `broadcastActivePreset(presetId, presetContent)` is a true broadcast: it queries **every** open `chat.deepseek.com` tab and sends the message to all of them concurrently via `Promise.all`, rather than only the active tab. Tabs without an `id` are skipped, and each `sendMessage` rejection is swallowed per tab — a tab whose content script has not yet loaded (or is mid-navigation) cannot stop the remaining tabs from receiving the update, and the caller's `await` always resolves. The global attachment falls back to `globalThis` when `window` is absent, so the same file is loadable from the service worker via `importScripts`.
- `utils/i18n.locales.js` (v4.11.14 split) holds the `zh_TW` and `en` translation dictionaries as pure data and registers `globalThis.__DS_I18N_Locales`. It carries no logic.
- `utils/i18n.js` (v4.3.3) registers `window.dsI18n`, the core i18n engine with `setLocale()` and `t(key)` lookup — see the Language / Locale Switcher section below. As of v4.11.14 the ~340 lines of locale string maps no longer live here; the engine reads them off `__DS_I18N_Locales` synchronously at the top of its IIFE, with a `require('./i18n.locales.js')` fallback guarded by `typeof require !== 'undefined'` for the Node/vitest path. **The browser has no such fallback**, so every loader must place `i18n.locales.js` immediately before `i18n.js` or `zh_TW`/`en` resolve to undefined and every translated string breaks silently. Four loaders must stay in agreement: `manifest.json` (`content_scripts[0].js`), `popup/popup.html`, `popup/editor/editor.html`, and `test/setup/vitest.setup.js`.
- `popup/popup.i18n-apply.js` registers `window.__DS_PopupI18nApply` with a single `apply(root)` entry point: it walks `data-i18n` attributes under `root` and writes the translated text. It is the DOM applier for both the popup and the editor window (`editor.html` loads it as `../popup.i18n-apply.js`), called explicitly once each context has finished `await dsI18n.init()`. Keeping the applier out of `utils/i18n.js` is what lets the engine stay DOM-free — `utils/i18n.js` contains no `document` reference at all — see the Language / Locale Switcher section below.
- `preset-item-renderer.js` (v4.10.0) registers `window.__DS_PresetItemRenderer` (`escapeHtml`, `buildPresetItemMarkup`) and must load before `custom-select.js`, which destructures it.
- `custom-select.drag.js` registers `window.__DSSCustomSelectDrag` (`createDragReorder`, `reorderPresets`) and must load before `custom-select.js`, which reads it at factory time and throws a named error when it is absent.
- `custom-select.js` registers `window.__DSSCustomSelect` on the global scope.
- `popup.preset-domain.js` registers `globalThis.DSSPresetDomain` (`createPreset`, `validatePresetName`) — the pure preset-domain rules, free of DOM and storage access. `validatePresetName(name, existingPresets, options)` returns `{ ok: true }` or `{ ok: false, reason: 'empty' | 'duplicate' }`, with `options.selfId` excluding the preset being renamed from the duplicate scan. `editor.html` loads this same file, so the editor's rename validation and the popup's add validation run one implementation rather than two.
- `popup.settings-view.js` registers `window.__DS_PopupSettingsView` with `applySettingsToDom(dom, settings)` — a one-way presentation mapping from a `StorageManager.getSettings()` result onto the popup controls. It reads and writes nothing in `chrome.storage` and fires no `change` listeners, so first-load restore and any later bulk UI restore share one key-to-control table instead of repeating it.
- `popup.modal.js`, `popup.preset-manager.js`, `popup.backup-manager.js` (v4.0.0 split) register `window.__DS_PopupModal` / `window.__DS_PopupPresetManager` / `window.__DS_PopupBackupManager`. The two manager bundles expose `createPresetManager(ctx)` / `createBackupManager(ctx)` factories so they can read and mutate popup.js's `DOMContentLoaded` closure state via live getter/setter callbacks.
- `popup.toast.js` (v4.11.10 split) registers the `Toast` key on that same `window.__DS_PopupModal` object. `popup.modal.js` previously held both `Modal` and `Toast` in one file — two unrelated components sharing a file, contrary to `coding-guidelines` §8. Both files now self-mount via `Object.assign(window.__DS_PopupModal || {}, { … })` rather than a single object literal, so neither clobbers the other's key and the two are order-independent. `popup.js:35` still destructures `const { Modal, Toast } = window.__DS_PopupModal;` unchanged. The manager bundles receive `Modal`/`Toast` through their `ctx` parameter, not the global, and were unaffected.
- `popup.pin-manager.js` (v4.18.0) registers `window.__DS_PopupPinManager`, exposing `createPinManager(ctx)` → `{ togglePin, clearPinIfDeleted }`, following the same ctx-factory convention as the preset and backup managers. Its `ctx` takes `StorageManager`, `getPinnedPresetId`/`setPinnedPresetId` accessors into popup.js's closure state, and an optional `onPinChanged` re-render callback. It owns the entire pinned-default decision (toggle-on, toggle-off, and clear-on-delete) so that `popup.js` gains only wiring — the entry file was already over the `coding-guidelines` §8 threshold, so a new concern had to arrive as its own file. It was briefly written as an ES module and dynamically `import()`ed; that was corrected to a classic script because every other popup factory is one and `popup.html` has no `type="module"` tag.
- `popup.live-sync.js` (v4.8.0) registers `window.__DS_PopupLiveSync`, exposing `createLiveSyncListener(ctx)` — see the Live Sync Listener section below.
- `popup.editor-window.js` / `popup.width-sliders.js` / `popup.markdown-export.js` (v4.11.16 split) expose `createEditorWindowManager(ctx)` / `createWidthSliderManager(ctx)` / `createMarkdownExportManager(ctx)`, following the same ctx-factory convention as the preset and backup managers. `popup.js` was 572 lines — 122 over the `coding-guidelines` §8 threshold — and these three were self-contained concerns bundled inside its `DOMContentLoaded` handler; extracting them brought the entry file to 441 lines at the time. `popup.editor-window.js` owns `openEditorWindow` plus the two edit-button bindings and the `globalEditorWindowId`/`presetEditorWindowId` singleton state; `popup.width-sliders.js` owns the `debounce` helper and both width toggle/slider bindings (the DOM element `const`s stay in `popup.js`, since the live-sync wiring still references them); `popup.markdown-export.js` owns the export button binding.
- `popup.toggles.js` registers `window.__DS_PopupToggles`, exposing `createToggleManager(ctx)` → `{ bindToggles, renderGlobalPromptToggle }` (the second export added in v4.20.0), following the same ctx-factory convention. Its `ctx` takes `StorageManager`, `refreshSyncStatus`, `showSaveStatus`, `applyMasterSwitchUI`, and (v4.20.0) `getPresets`/`setPresets`/`getActivePresetId`/`setActivePresetId` accessors. `renderGlobalPromptToggle(el)` resolves the active preset via a private `resolveActivePreset()` helper and sets `el.checked` from `StorageManager.resolveGlobalPromptEnabled(activePreset, legacyFlag)`; the global-prompt `change` handler writes back to the active preset's `globalPromptEnabled` (bumping its `updatedAt` and persisting via `saveOnePromptPreset`) when one is active, and falls back to `saveGlobalPromptEnabled()` on the legacy device key when none is. All write paths for this toggle are centralized here. `bindToggles(elements)` receives the nine DOM refs (which stay declared in `popup.js`, since the live-sync wiring still references them) and attaches every feature-toggle `change` listener: global-prompt, master enable, include-thinking, include-references, sidebar-auto-hide, hide-thinking, show-system-time, prevent-auto-scroll, and the web-search radio group. `popup.js` was 484 lines — 34 over the `coding-guidelines` §8 threshold — before this extraction, which brought it to 428.
- Specs that extract functions from raw source text with `readFileSync` + regex rather than importing them have to follow the code whenever a block moves. So far: `test/unit/popup-slider-debounce.spec.js` reads `popup.width-sliders.js`, `test/unit/popup.spec.js` reads `popup.editor-window.js`, and `test/unit/popup-prevent-auto-scroll-toggle.spec.js` / `test/unit/popup-websearch-toggle.spec.js` read `popup.toggles.js` for their change-handler assertions while keeping their DOM-ref, load-restore, and `applyMasterSwitchUI` assertions pointed at `popup.js`. Only the paths changed — every regex still matches, because the moves were verbatim including indentation. Anything moved out of `popup.js` in future must check these specs.
- `popup.locale.js` (v4.3.3) registers `window.__DS_PopupLocale` with `bindLocaleSwitcher()` — see the Language / Locale Switcher section below.
- `popup.js` (entry) loads last, binding `Modal`/`Toast` and instantiating the manager factories, then calling `window.__DSSCustomSelect.createPresetCustomSelect({...})` inside its `DOMContentLoaded` handler.

The editor window (`popup/editor/editor.html`) loads `../../utils/logger.js`, `../../utils/debounce.js`, the eight `storage-manager.*.js` bundles, then `../../utils/storage-manager.js`, `../../utils/i18n.locales.js`, `../../utils/i18n.js`, `../popup.i18n-apply.js`, `../popup.preset-domain.js`, then `editor.js` — 17 classic scripts, no inline JS (MV3 CSP-safe). `test/unit/editor-html.spec.js` asserts this exact list and its exact order positionally. `editor.js` takes its debounce from the shared `DSSDebounce` global rather than defining one.

### Data Flow Integration

The component sits between the DOM and popup.js's storage layer:

```
popup.html (DOM elements)
    ↓  reads/writes DOM
custom-select.js (interaction state, rendering)
    ↓  callbacks (onSelect, onReorder, onRequestDelete)
popup.js (business logic, storage calls)
    ↓  async storage API
storage-manager.js (chrome.storage wrapper)
```

1. User interacts with the dropdown (click, search, drag).
2. `custom-select.js` handles the interaction, updates its internal state, re-renders the DOM.
3. For actions that require persistence (select, reorder, delete), it calls the appropriate callback.
4. popup.js executes the storage operation, then calls `customSelect.render()` to sync the UI to the new state.

This one-way data flow (DOM → component → callback → storage → re-render) keeps state management predictable and testable.

## Live Sync Listener (popup.live-sync.js, v4.8.0)

The popup previously only read storage once at open time (via `StorageManager.syncNow()`, v4.7.0) — changes made from another device, tab, or the standalone editor window while the popup stayed open were not reflected until the popup was closed and reopened. `popup.live-sync.js` closes this gap by registering a single `chrome.storage.onChanged` listener, modeled on the equivalent listener already used by `content/content-script.js`.

**Factory pattern**: `createLiveSyncListener(ctx)` returns `{ start() }`. `ctx` carries the `StorageManager` reference, a `dom` map of the elements to keep in sync, `applyMasterSwitchUI`/`updateEditPresetBtnState` callbacks, and getter/setter pairs for `presets`, `activePresetId`, and `chatPresetMap` (mirroring the ctx-factory pattern already used by `popup.preset-manager.js`/`popup.backup-manager.js`). `popup.js` constructs this context and calls `.start()` once, right after the custom-select is created.

**Coverage**:
- `isEnabled` / `globalPromptEnabled` (local-only, v4.7.3) → toggle checkbox + `applyMasterSwitchUI()`. (v4.20.0) The device-level `globalPromptEnabled` key is now only the fallback; the value actually shown by `#globalPromptToggle` is produced by `popup.toggles.js`'s `renderGlobalPromptToggle()`, which prefers the active preset's own flag.
- `includeThinking`, `includeReferences`, `dsSidebarAutoHide`, `dsHideThinking`, `dsPreventAutoScroll` (v4.12.0), `dsShowSystemTime` → matching toggle checkbox.
- `dsWebSearchToggle` (v4.13.0; two options since v4.17.0) → the radio group (`on`/`off`), checked only where `r.value === val`. A nullish stored value and the removed legacy `'default'` value both resolve to `'on'`.
- `dsChatWidth`/`dsChatWidthEnabled` and `dsInputWidth`/`dsInputWidthEnabled` → slider value, label text, and collapsed-container class.
- `dsPresetIndex` / preset order meta / any `dsPreset_<id>` key → re-fetches `StorageManager.getSettings()` and re-renders the custom select (preset add/rename/delete/reorder/content edit from elsewhere).
- ChatPresetMap chunk/meta keys → re-fetches `StorageManager.getChatPresetMap()`.
- `activePresetId` → re-renders only when the incoming value differs from the popup's own in-memory value (guards against a redundant re-render echo of the popup's own write).

**No feedback loop**: every DOM write is idempotent (`applyToggle`/`applySlider` only assign when the value actually differs), and the module never calls any `StorageManager.save*` itself — so a change the popup itself just wrote flows back through `onChanged` as a same-value no-op rather than a loop.

## Language / Locale Switcher (v4.3.3)

The popup includes a built-in language switcher that toggles between Traditional Chinese (zh_TW) and English (en).

**DOM Structure**: A globe-icon button (`#localeSwitcherBtn`) in the Export card header, toggling a `#localePanel` with radio inputs for each locale.

**Implementation**:
- `utils/i18n.js` — Core i18n engine: defines a `dsI18n` object with `setLocale(locale)`, `t(key)` lookup, and `onLocaleChanged(callback)` subscription. It holds no DOM code; locale strings come from `utils/i18n.locales.js`. Persists the selected locale to `chrome.storage.local` as `dsLocale`.
- `popup/popup.i18n-apply.js` — The DOM applier, split out of the engine: `window.__DS_PopupI18nApply.apply(root)` processes `data-i18n` attributes under `root`. Loaded by both `popup.html` and `editor.html`; the editor calls it directly in `editor.js` right after `await dsI18n.init()`, the popup reaches it through `bindLocaleSwitcher()`.
- `popup/popup.locale.js` — Popup locale switcher UI. It exports `bindLocaleSwitcher()` on `window.__DS_PopupLocale` and does nothing at load time; `popup.js` calls it immediately after `await dsI18n.init()`. The function first runs `window.__DS_PopupI18nApply.apply()` to paint the initial strings, then wires `#localeSwitcherBtn` click to panel toggle, an outside-click handler to close the panel, and radio change to `dsI18n.setLocale()` plus `window.location.reload()`. The reload is why the popup needs no `onLocaleChanged` subscription of its own — a fresh document re-runs the applier. Content scripts, which cannot reload, take the subscription route instead.
- Content scripts subscribe via `dsI18n.onLocaleChanged(cb)` to live-update UI text without a page reload — `content/quote-reply.js` re-renders the Quote Reply button label, `content/preset-overlay.controller.js` calls the dropdown's `updateLocale()`. A direct callback registry is what keeps the engine DOM-free: it needs no event target, no bubbling assumptions, and no `document` in scope. It carries no unsubscribe, so subscribers register once and guard inside the callback — `quote-reply.js` keeps a `hasLocaleSubscription` flag and subscribes only on its first enable, relying on `btnEl === null` to make the callback a no-op while the feature is off.

The `popup.js` `DOMContentLoaded` handler initializes `dsI18n` early, before rendering any locale-dependent text.

## Standalone Prompt Editor Window (v3.0.0)

Prompt content editing lives in `popup/editor/` — an extension page opened as a separate OS window, replacing the popup's former inline textareas.

### Opening (popup side)

- Two pencil buttons in the popup: `#editGlobalPromptBtn` (Global Prompt card) and `#editPresetBtn` (Prompt Group card, disabled when `activePresetId === ''`).
- `openEditorWindow(target, presetId)` in `popup/popup.editor-window.js` builds the URL via `chrome.runtime.getURL('popup/editor/editor.html')` plus the query string, then delegates window handling to `DSSWindowControl.openSingletonWindow({ url, createOptions, storageKey })` with `createOptions = { type: 'popup', width: 1280, height: 720 }`.
- **True singleton per target**: the open window's id no longer lives in a popup-closure slot — `utils/window-control.js` persists it in `chrome.storage.session` under `dss-editor-window-id-global` / `dss-editor-window-id-preset` (`EDITOR_WINDOW_STORAGE_KEYS`). Because the id outlives the popup's page context, closing the popup and clicking the pencil again focuses the window that is already open instead of spawning a second one.
- **Shared key definition (v4.29.0)**: `EDITOR_WINDOW_STORAGE_KEYS` is read from `globalThis.DSS_EDITOR_WINDOW.STORAGE_KEYS`, published by `utils/editor-window-constants.js` — the same file `background/editor-window-routes.js` loads, so the popup that writes the id and the worker that clears it share one definition of both keys. `popup.html` loads it before `popup.editor-window.js`; if it is missing, `popup.editor-window.js` throws at load with a message naming the file to add rather than falling back to a literal.
- **Focus / navigate / recreate**: `openSingletonWindow()` reads the stored id; when one exists it calls `chrome.windows.get(id, { populate: true })` + `chrome.windows.update(id, { focused: true })`. If `get` rejects (the user closed the window), it falls through and creates a fresh one, persisting the new id. On a successful focus it compares the existing tab's `url` against the requested URL and issues `chrome.tabs.update(tab.id, { url })` **only when they differ** — so switching prompt groups swaps the editor's content in place, while re-clicking the same group focuses without reloading. No data loss on the swap: the editor's `pagehide` handler flushes dirty content before unload.
- Failures degrade toward availability rather than deduplication: a `chrome.storage.session` read error is logged and treated as "no window recorded", so the user still gets an editor. `chrome.windows.create` requires no extra permission, and no `web_accessible_resources` entry is needed for extension-origin pages.

### Query-string contract

| Query | Target |
|-|-|
| `?target=global` | Global prompt (`globalDefaultPrompt`) |
| `?target=preset&id=<presetId>` | That preset's `content` |

Invalid targets and presets that no longer exist (deleted while the link was stale) render a disabled textarea with an explanatory title — no uncaught errors.

### Auto-save pipeline (editor side)

A standalone window can be closed directly by the OS, so saving is defensive: `input` sets a dirty flag and schedules a 500 ms debounced save (`debounce(performSave, 500)`, the wrapper taken from `DSSDebounce`); `blur`, `visibilitychange` (hidden), and `pagehide` flush immediately (fire-and-forget). Saves only fire when dirty. Since v4.15.0, pressing `Esc` closes the window (window-level `keydown` listener → `window.close()`); the `pagehide` flush writes any dirty content first, so the shortcut never loses data. Routing: global → `StorageManager.saveGlobalDefaultPrompt()`; preset → re-fetch the preset, stamp `content` + `updatedAt` (+ `name` when the name input changed, v4.14.0), then `StorageManager.saveOnePromptPreset()` followed by `DSVMessaging.broadcastActivePreset()`. The name input (`#editorNameInput`) shares this pipeline: its `input`/`blur` handlers set the same dirty flag and call the same debounced/flush save, and `saveContent` rejects with `code: 'DUPLICATE_NAME'` when `DSSPresetDomain.validatePresetName(nextName, settings.promptPresets, { selfId: target.id })` reports `reason: 'duplicate'` (exact-match, case-sensitive, self-excluded) — the save-status area shows a red error and nothing is written. All persistence goes through `StorageManager` — the editor never touches `chrome.storage` directly.

**Auto-close on page focus (v4.29.0).** Three ways to close the editor now coexist: `Esc` inside the editor, the OS window controls, and returning focus to the DeepSeek page. The third is driven from the content side — `content/editor-window-autoclose.js` sends `DSS_CLOSE_EDITOR_WINDOWS` on the page's `focus` event and `background/editor-window-routes.js` removes whichever editor windows are still tracked in `chrome.storage.session`, clearing their keys so the next pencil click creates a fresh window. The auto-save pipeline above is what makes this safe: the `pagehide` / `visibilitychange` flush writes dirty content before the window goes away, exactly as it does for the `Esc` shortcut. See the Editor Window Auto-Close section in [ARCHITECTURE.md](../ARCHITECTURE.md#editor-window-auto-close-v4290) for the message contract.

### Propagation

```mermaid
sequenceDiagram
    participant Popup as Popup UI
    participant Editor as Editor Window (1280×720)
    participant Storage as chrome.storage sync+local
    participant Content as Content Script (chat.deepseek.com)

    Popup->>Editor: pencil click → DSSWindowControl.openSingletonWindow (session-stored id → focus, or create)
    Editor->>Storage: StorageManager.initialize() + load target content
    Editor->>Storage: auto-save (debounced input / blur / pagehide)
    Storage-->>Content: onChanged → globalDefaultPrompt / dsPreset_* updated
    Editor->>Content: DSVMessaging.broadcastActivePreset (preset target only)
    Storage-->>Popup: onChanged (if popup still open)
```

The content script needs no editor-specific code: its existing `chrome.storage.onChanged` listeners pick up every save, and the explicit `ACTIVE_PRESET_CHANGED` broadcast keeps parity with the popup's historical behavior for the actively-typed prefix.
