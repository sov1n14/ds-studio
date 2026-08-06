# Popup 與編輯器架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › Popup 與編輯器
>
> **相關規格**：[Popup UI 規格](../spec/02-popup-ui.md) · [提示詞系統](../spec/01-prompt-system.md)

## Preset Selector & Management

The popup includes a preset selector row composed of:
- A custom combobox component (`custom-select.js`) replacing the old native `<select id="presetList">`. See the Custom Preset Dropdown section below for detailed architecture.
- Inline action buttons: delete (`✕`) rendered inside each dropdown row, and a standalone `+` button for adding new presets. (v4.14.0 — the per-row rename pencil was removed; renaming now happens inside the standalone editor window.)

**Add flow**: Click `+` → `Modal.prompt('新增提示詞組')` with required-field validation → user enters name → preset created with empty content → auto-selected → if on a bound conversation, updates the binding → user edits content in textarea.

**Rename flow (v4.14.0)**: Renaming happens in the standalone editor window. Click `#editPresetBtn` → the editor opens with the preset name shown in a focused, selected name input (`#editorNameInput`) in the header → editing the name joins the same auto-save pipeline as the content (500 ms debounce + flush on blur/close). Duplicate names are rejected at save time (`DUPLICATE_NAME`) and surfaced as a red error in the save-status area; the save is blocked until the name is unique. The open popup's dropdown refreshes automatically via live-sync. (Pre-v4.14.0 the flow was: click `✎` in the dropdown row → `Modal.prompt('重新命名', { value: currentName })`.)

**Delete flow**: Click `✕` → `Modal.confirm('刪除提示詞組', { variant: 'danger' })` → confirmed → preset removed from array, any `chatPresetMap` bindings pointing to the deleted preset are cleaned up. If the deleted preset was the active one, `activePresetId` is cleared to `''` (empty state). Delete is disabled when the empty state is selected. The system allows deleting all custom presets, as the empty option always remains as a fallback. (v4.8.3) Deletion also records a tombstone in `dsPresetTombstones` (local + sync) so the deletion propagates correctly to other devices during conflict-resolution merge instead of being resurrected by a stale copy.

**Content editing (v3.0.0, timing updated v4.8.1, name editing v4.14.0)**: The popup no longer hosts a content textarea. A pencil button (`#editPresetBtn`, rightmost in the controls row, disabled when `activePresetId === ''`) opens the standalone editor window at `popup/editor/editor.html?target=preset&id=<activePresetId>` (1280×720, singleton focus-or-create). The editor auto-saves via dirty flag + debounced input (500 ms) + `blur`/`visibilitychange`/`pagehide`, and broadcasts `ACTIVE_PRESET_CHANGED` after each preset save. Since v4.14.0 the editor is also the rename surface: preset targets show a focused name input in the header (the `#editorTitle` h1 is hidden), wired into the same auto-save pipeline, with duplicate-name rejection (`isDuplicateName` check in `saveContent`, error surfaced in `#editorSaveStatus`). Global targets keep the read-only h1.

**Chat/input width sliders (debounced write, v4.8.1)**: `chatWidthSlider` and `inputWidthSlider` separate their `input` event (updates the live percentage label synchronously, no storage write) from their `change` event (calls a 500 ms debounced wrapper — `debouncedSaveChatWidth` / `debouncedSaveInputWidth` — that persists the value via `StorageManager.saveChatWidth()` / `saveInputWidth()`, then refreshes sync status). This aligns the slider write cadence with the editor's 500 ms auto-save debounce, reducing `chrome.storage` write pressure during drag. The corresponding toggle switches (`chatWidthToggle`, `inputWidthToggle`) remain synchronous/undebounced. `popup.js` carries its own local `debounce(fn, delayMs)` copy (same reasoning as `editor.js`: it is a classic script and cannot `import`).

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

`createPresetCustomSelect(options)` returns an object with six methods:

| Method | Description |
|-|-|
| `render()` | Re-renders the trigger text and the dropdown list from current state. Called after any preset list mutation (add, delete, reorder, active change); renames from the editor window arrive via live-sync. |
| `open()` | Opens the dropdown panel. Clears search input, resets filter, re-renders full list, focuses search input. Registers an outside-click listener. |
| `close()` | Closes the dropdown panel. Unregisters outside-click listener. |
| `isOpen()` | Returns `true` if the panel is currently open. |
| `setActive(presetId)` | Updates the trigger display text and re-highlights the active item in the list. Does not close the dropdown. |
| `destroy()` | Cleans up: removes outside-click listener and any drag artifacts. |

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
| `drag` | `Object|null` | Active drag session data, or `null` when not dragging. |
| `dragArmed` | `boolean` | Whether a pointer press is pending drag activation (used for the 5px threshold). |

### Key Internal Functions

- **`_updateTrigger()`**: Reads the active preset ID, finds its name in the presets list, and sets `valueEl.textContent`. Falls back to "(無提示詞組)" when no preset is active.

- **`_renderList()`**: Rebuilds the dropdown list DOM. Iterates presets, filters by `filteredIds`, and creates `div.ds-select__item` elements with three child regions:
  - Drag handle (`⠿` character, class `ds-select__drag-handle`)
  - Item name (class `ds-select__item-name`, HTML-escaped)
  - Inline action buttons (delete only since v4.14.0, class `ds-select__item-btn--delete`), carrying an i18n `title`/`aria-label` (delete: `刪除提示詞`; the per-row rename pencil was removed in v4.14.0 — renaming moved into the editor window)
  - Skips rendering when a drag is in progress (`state.drag !== null`) to avoid DOM churn during drag.
  - Calls `_bindDrag()` after populating the list to attach pointer event handlers to each drag handle.
  - Row markup is built by `buildPresetItemMarkup(preset)` in `popup/preset-item-renderer.js` (v4.10.0 — extracted from `custom-select.js` to stay under the 450-line proactive-split threshold). The delete button keeps the `✕` glyph.

- **`_applyFilter()`**: Reads the current search input value, iterates all presets with `_fuzzyMatch()`, updates `filteredIds`, and calls `_renderList()`. Called via a debounced wrapper `_debouncedFilter`.

- **`_bindDrag()`**: Iterates all `.ds-select__drag-handle` elements and attaches `pointerdown` listeners via `_onHandlePointerDown`.

- **`_registerOutsideClick()` / `_unregisterOutsideClick()`**: Manages a `pointerdown` listener on `document` that calls `close()` when the user clicks outside the trigger, panel, or add-preset button.

- **`_bindEvents()`**: Called once during construction. Sets up:
  - Trigger click → toggle open/close.
  - Search input `input` → `_debouncedFilter` (400ms debounce).
  - Panel click → routes clicks to blank option selection, edit button, delete button, or preset selection.
  - `pointerdown` stop-propagation on trigger, search input, and panel to prevent outside-click handler from closing immediately after opening.

- **`destroy()`**: Cleans up the outside-click listener and any residual drag DOM artifacts.

### Drag and Reorder Implementation

Drag uses the Pointer Events API for unified mouse+touch handling, bypassing the HTML Drag and Drop API for finer control and visual fidelity:

1. **Arming**: `_onHandlePointerDown` records the starting position and enters an armed state (`state.dragArmed = true`). Pointer capture is set on the handle element to receive events even outside the handle bounds.

2. **Activation**: `_onPointerMove` computes `Math.hypot(dx, dy)`. Once the cursor moves 5px from the start, `_activateDrag()` is called:
   - The source item gets `ds-select__item--dragging` (CSS opacity reduction).
   - A `div.ds-select__drag-ghost` is created, positioned absolutely at the cursor, following the pointer via `translate()`.
   - The ghost displays the preset name as plain text, serving as a lightweight drag preview.

3. **Insertion line**: `_updateInsertionLine()` iterates all non-dragging list items, finds the one closest to the cursor's Y position (bisected by each item's vertical midpoint), and places a `div.ds-select__insertion-line` at the appropriate position. This line is a thin visual indicator showing where the dragged preset will land.

4. **Completion**: `_onPointerUp` finalizes the drag:
   - If a ghost was created (meaning the 5px threshold was crossed), it calls the private `_reorderPresets()` helper and invokes the `onReorder` callback with the new array.
   - If no ghost was created (a tap rather than a drag), it treats the interaction as a selection click and calls `onSelect(drag.id)` + `close()`.
   - `_removeDragVisuals()` cleans up all drag artifacts.

5. **Cancel**: `_onPointerCancel` removes drag visuals and calls `_renderList()` to restore normal list state.

### Search and Debounce

- **`_fuzzyMatch(name, keyword)`**: A character-by-character sequential match (not true fuzzy / Levenshtein). Iterates characters in `name`; each character that matches the next unconsumed character of `keyword` advances the pointer. Returns `true` if all keyword characters are consumed. This handles substring matching and supports partial character skips in the name.

- **`_debounce(fn, delayMs)`**: Standard debounce wrapper. Returns a function that delays invocation until `delayMs` of inactivity. The search input uses a 400ms debounce, balancing responsiveness against filtering cost during typing.

Note: `custom-select.js` contains its own private copies of `_fuzzyMatch()` and `_debounce()` (prefixed with `_`). The former ES-module duplicates in `popup/popup-utils.js` were deleted in the v4.11.x audit — that file existed only to be imported by tests, never by production code, so the tests were retargeted onto the real `_`-prefixed implementations and the duplicate removed.

### Delete-All Button (blank item, v4.10.0)

The static "(無提示詞組)" blank item (`blankItemEl`) now also renders a `.ds-select__item-btn--delete-all` button (`✕` glyph, i18n title `刪除全部提示詞組`), positioned like the per-row delete buttons and revealed on hover via the same `.ds-select__item--empty:hover .ds-select__item-btn` rule in `popup-select.css`. The panel click handler in `_bindEvents()` checks for this button class before the blank-option selection branch, calls `onRequestDeleteAll()`, and returns early (stopping propagation) so the click never also fires `onSelect('')`. `popup.preset-manager.js`'s `requestDeleteAllPresets()` mirrors `requestDeletePreset(id)`: it confirms via `Modal.confirm({ title: '刪除全部提示詞組', message: '確定要刪除全部提示詞組嗎？此操作無法復原。', variant: 'danger' })`, then on confirm clears `presets` to `[]`, resets `activePresetId` to `''`, strips every `chatPresetMap` entry that referenced any previously-existing preset id (not just one, unlike the single-delete path), and calls `StorageManager.savePromptPresets([])` — reusing the existing tombstone/cleanup machinery in `storage-manager.presets.js`, since it diffs the old vs. new `PRESET_INDEX` to compute `deletedIds`.

### Module Loading Order

In `popup.html`, the script tags appear in this order:

```html
<script src="../utils/logger.js"></script>
<script src="../utils/storage-manager.chunk-lock.js"></script>
<script src="../utils/storage-manager.sync.js"></script>
<script src="../utils/storage-manager.presets.js"></script>
<script src="../utils/storage-manager.chatmap.js"></script>
<script src="../utils/storage-manager.local.js"></script>
<script src="../utils/storage-manager.init.js"></script>
<script src="../utils/storage-manager.js"></script>
<script src="../utils/messaging.js"></script>
<script src="../utils/i18n.locales.js"></script>
<script src="../utils/i18n.js"></script>
<script src="preset-item-renderer.js"></script>
<script src="custom-select.js"></script>
<script src="popup.modal.js"></script>
<script src="popup.toast.js"></script>
<script src="popup.preset-manager.js"></script>
<script src="popup.backup-manager.js"></script>
<script src="popup.live-sync.js"></script>
<script src="popup.editor-window.js"></script>
<script src="popup.width-sliders.js"></script>
<script src="popup.markdown-export.js"></script>
<script src="popup.js"></script>
<script src="popup.locale.js"></script>
```

- `utils/logger.js` loads first, providing structured logging. The six `storage-manager.*.js` bundles (chunk-lock, sync, presets, chatmap, local, init) load next; each attaches its method group to a `globalThis.__DS_StorageManager_*` key (v4.0.0 split; consolidated from nine bundles to six in v4.11.3).
- `storage-manager.js` (entry) loads next and runs `Object.assign(StorageManager, ...)` to merge the bundles before exposing `window.StorageManager`. Both custom-select.js users and popup.js depend on it at runtime.

**Load-order invariant (v4.11.3).** The only ordering constraint is that **every bundle must be loaded before the entry file**. The order *among* the bundles is irrelevant: no bundle executes anything at IIFE top level beyond assigning its own global, and every cross-bundle call goes through `this.<method>()` inside an `async` body, resolved at call time rather than load time.

This invariant is load-bearing and fails **silently** when violated. The entry file merges each bundle as `root.__DS_StorageManager_X || {}`, so a bundle that has not loaded yet mixes in as an empty object: every method it provides is simply absent for the lifetime of that context, with no error and no console warning. This is not hypothetical — before v4.11.3, `background/service-worker.js` omitted `storage-manager.tombstones.js` from its `importScripts` list while `resolveSyncConflict()` called `_mergeTombstones()`, so background sync retry threw `TypeError` into a deliberately swallowing `catch` and had been silently dead. See `docs/changelog/v4.md` (4.11.3).

Five loaders must therefore stay in agreement: `manifest.json` (`content_scripts[0].js`), `popup/popup.html`, `popup/editor/editor.html`, `background/service-worker.js` (`importScripts`), and `test/setup/vitest.setup.js`. `test/unit/storage-manager.loader-contract.spec.js` enforces this automatically — it discovers the bundle set from the entry file's `Object.assign` call and from the `utils/` directory listing, then asserts every loader lists every bundle and places it before the entry file. Adding or renaming a bundle without updating a loader fails that test rather than silently breaking a runtime context.
- `messaging.js` registers `window.DSVMessaging` (used by popup.js for the `ACTIVE_PRESET_CHANGED` broadcast).
- `utils/i18n.locales.js` (v4.11.14 split) holds the `zh_TW` and `en` translation dictionaries as pure data and registers `globalThis.__DS_I18N_Locales`. It carries no logic.
- `utils/i18n.js` (v4.3.3) registers `window.dsI18n`, the core i18n engine with `setLocale()` and `t(key)` lookup — see the Language / Locale Switcher section below. As of v4.11.14 the ~340 lines of locale string maps no longer live here; the engine reads them off `__DS_I18N_Locales` synchronously at the top of its IIFE, with a `require('./i18n.locales.js')` fallback guarded by `typeof require !== 'undefined'` for the Node/vitest path. **The browser has no such fallback**, so every loader must place `i18n.locales.js` immediately before `i18n.js` or `zh_TW`/`en` resolve to undefined and every translated string breaks silently. Four loaders must stay in agreement: `manifest.json` (`content_scripts[0].js`), `popup/popup.html`, `popup/editor/editor.html`, and `test/setup/vitest.setup.js`.
- `preset-item-renderer.js` (v4.10.0) registers `window.__DS_PresetItemRenderer` (`escapeHtml`, `buildPresetItemMarkup`) and must load before `custom-select.js`, which destructures it.
- `custom-select.js` registers `window.__DSSCustomSelect` on the global scope.
- `popup.modal.js`, `popup.preset-manager.js`, `popup.backup-manager.js` (v4.0.0 split) register `window.__DS_PopupModal` / `window.__DS_PopupPresetManager` / `window.__DS_PopupBackupManager`. The two manager bundles expose `createPresetManager(ctx)` / `createBackupManager(ctx)` factories so they can read and mutate popup.js's `DOMContentLoaded` closure state via live getter/setter callbacks.
- `popup.toast.js` (v4.11.10 split) registers the `Toast` key on that same `window.__DS_PopupModal` object. `popup.modal.js` previously held both `Modal` and `Toast` in one file — two unrelated components sharing a file, contrary to `coding-guidelines` §8. Both files now self-mount via `Object.assign(window.__DS_PopupModal || {}, { … })` rather than a single object literal, so neither clobbers the other's key and the two are order-independent. `popup.js:35` still destructures `const { Modal, Toast } = window.__DS_PopupModal;` unchanged. The manager bundles receive `Modal`/`Toast` through their `ctx` parameter, not the global, and were unaffected.
- `popup.live-sync.js` (v4.8.0) registers `window.__DS_PopupLiveSync`, exposing `createLiveSyncListener(ctx)` — see the Live Sync Listener section below.
- `popup.editor-window.js` / `popup.width-sliders.js` / `popup.markdown-export.js` (v4.11.16 split) expose `createEditorWindowManager(ctx)` / `createWidthSliderManager(ctx)` / `createMarkdownExportManager(ctx)`, following the same ctx-factory convention as the preset and backup managers. `popup.js` was 572 lines — 122 over the `coding-guidelines` §8 threshold — and these three were self-contained concerns bundled inside its `DOMContentLoaded` handler; extracting them brings the entry file to 441 lines. `popup.editor-window.js` owns `openEditorWindow` plus the two edit-button bindings and the `globalEditorWindowId`/`presetEditorWindowId` singleton state; `popup.width-sliders.js` owns the `debounce` helper and both width toggle/slider bindings (the DOM element `const`s stay in `popup.js`, since the live-sync wiring still references them); `popup.markdown-export.js` owns the export button binding.
- Two specs extract functions from raw source text with `readFileSync` + regex rather than importing them, so they had to follow the code: `test/unit/popup-slider-debounce.spec.js` now reads `popup.width-sliders.js`, and `test/unit/popup.spec.js` now reads `popup.editor-window.js`. Only the paths changed — every regex still matches, because the moves were verbatim including indentation. Anything moved out of `popup.js` in future must check these two specs.
- `popup.js` (entry) loads second-to-last, binding `Modal`/`Toast` and instantiating the manager factories, then calling `window.__DSSCustomSelect.createPresetCustomSelect({...})` inside its `DOMContentLoaded` handler.
- `popup.locale.js` (v4.3.3) loads last, wiring `#localeSwitcherBtn` click to panel toggle and radio change to `dsI18n.setLocale()` — see the Language / Locale Switcher section below.

The editor window (`popup/editor/editor.html`) loads `../../utils/logger.js`, the six `storage-manager.*.js` bundles, then `../../utils/storage-manager.js`, `../../utils/messaging.js`, `../../utils/i18n.locales.js`, `../../utils/i18n.js`, then `editor.js` — 12 classic scripts, no inline JS (MV3 CSP-safe). `test/unit/editor-html.spec.js` asserts this exact list and its exact order positionally. `editor.js` carries its own local `debounce` copy because it is a classic script and cannot `import`.

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
- `isEnabled` / `globalPromptEnabled` (local-only, v4.7.3) → toggle checkbox + `applyMasterSwitchUI()`.
- `includeThinking`, `includeReferences`, `dsSidebarAutoHide`, `dsHideThinking`, `dsPreventAutoScroll` (v4.12.0), `dsShowSystemTime` → matching toggle checkbox.
- `dsWebSearchToggle` (v4.13.0; two options since v4.17.0) → the radio group (`on`/`off`), checked only where `r.value === val`. A nullish stored value and the removed legacy `'default'` value both resolve to `'on'`.
- `dsChatWidth`/`dsChatWidthEnabled` and `dsInputWidth`/`dsInputWidthEnabled` → slider value, label text, and collapsed-container class.
- `dsPresetIndex` / preset order meta / any `dsPreset_<id>` key → re-fetches `StorageManager.getSettings()` and re-renders the custom select (preset add/rename/delete/reorder/content edit from elsewhere).
- ChatPresetMap chunk/meta keys → re-fetches `StorageManager.getChatPresetMap()`.
- `activePresetId` → re-renders only when the incoming value differs from the popup's own in-memory value (guards against a redundant re-render echo of the popup's own write).

**No feedback loop**: every DOM write is idempotent (`applyToggle`/`applySlider` only assign when the value actually differs), and the module never calls any `StorageManager.save*` itself — so a change the popup itself just wrote flows back through `onChanged` as a same-value no-op rather than a loop.

## Language / Locale Switcher (v4.3.3)

The popup includes a built-in language switcher that toggles between Traditional Chinese (zh_TW) and English (en).

**DOM Structure**: A globe-icon button (`#localeSwitcherBtn`) in the Features & Export card header, toggling a `#localePanel` with radio inputs for each locale.

**Implementation**:
- `utils/i18n.js` — Core i18n engine: defines a `dsI18n` object with locale string maps, `setLocale(locale)` method, and `t(key)` lookup. Processes `data-i18n` attributes on DOM elements. Persists the selected locale to `chrome.storage.local` as `dsLocale`.
- `popup/popup.locale.js` — Popup locale switcher UI: wires `#localeSwitcherBtn` click to panel toggle, radio change to `dsI18n.setLocale()` plus page reload.
- Content scripts also listen for `dsI18n-locale-changed` events to live-update UI text (e.g., Quote Reply button label, overlay preset text) without page reload.

The `popup.js` `DOMContentLoaded` handler initializes `dsI18n` early, before rendering any locale-dependent text.

## Standalone Prompt Editor Window (v3.0.0)

Prompt content editing lives in `popup/editor/` — an extension page opened as a separate OS window, replacing the popup's former inline textareas.

### Opening (popup side)

- Two pencil buttons in the popup: `#editGlobalPromptBtn` (Global Prompt card) and `#editPresetBtn` (Prompt Group card, disabled when `activePresetId === ''`).
- `openEditorWindow()` in `popup.js` builds the URL via `chrome.runtime.getURL('popup/editor/editor.html')` plus the query string, then creates the window with `chrome.windows.create({ url, type: 'popup', width: 1280, height: 720 })`.
- **Singleton per target**: module-level slots (`globalEditorWindowId` / `presetEditorWindowId`) track open windows. A repeat click tries `chrome.windows.update(id, { focused: true })` first; if that rejects (window closed), the slot is cleared and a new window is created. Since v4.14.0, after focusing an existing window its tab is also navigated to the requested URL via `chrome.tabs.query({ windowId })` + `chrome.tabs.update(tab.id, { url })` (same URL = reload, different URL = switch to the now-active preset). This makes the name input's focus-on-open fire on every pencil click and fixes the stale-preset trap where a window opened for preset A stayed on A after the user switched to preset B. No data loss: the editor's `pagehide` handler flushes dirty content before unload. `chrome.windows.create` requires no extra permission, and no `web_accessible_resources` entry is needed for extension-origin pages.

### Query-string contract

| Query | Target |
|-|-|
| `?target=global` | Global default prompt (`globalDefaultPrompt`) |
| `?target=preset&id=<presetId>` | That preset's `content` |

Invalid targets and presets that no longer exist (deleted while the link was stale) render a disabled textarea with an explanatory title — no uncaught errors.

### Auto-save pipeline (editor side)

A standalone window can be closed directly by the OS, so saving is defensive: `input` sets a dirty flag and schedules a 600 ms debounced save; `blur`, `visibilitychange` (hidden), and `pagehide` flush immediately (fire-and-forget). Saves only fire when dirty. Since v4.15.0, pressing `Esc` closes the window (window-level `keydown` listener → `window.close()`); the `pagehide` flush writes any dirty content first, so the shortcut never loses data. Routing: global → `StorageManager.saveGlobalDefaultPrompt()`; preset → re-fetch the preset, stamp `content` + `updatedAt` (+ `name` when the name input changed, v4.14.0), then `StorageManager.saveOnePromptPreset()` followed by `DSVMessaging.broadcastActivePreset()`. The name input (`#editorNameInput`) shares this pipeline: its `input`/`blur` handlers set the same dirty flag and call the same debounced/flush save, and `saveContent` rejects with `code: 'DUPLICATE_NAME'` when the new name collides with another preset (exact-match, case-sensitive, self-excluded) — the save-status area shows a red error and nothing is written. All persistence goes through `StorageManager` — the editor never touches `chrome.storage` directly.

### Propagation

```mermaid
sequenceDiagram
    participant Popup as Popup UI
    participant Editor as Editor Window (1280×720)
    participant Storage as chrome.storage sync+local
    participant Content as Content Script (chat.deepseek.com)

    Popup->>Editor: pencil click → chrome.windows.create / update(focused) + tabs.update(reload)
    Editor->>Storage: StorageManager.initialize() + load target content
    Editor->>Storage: auto-save (debounced input / blur / pagehide)
    Storage-->>Content: onChanged → globalDefaultPrompt / dsPreset_* updated
    Editor->>Content: DSVMessaging.broadcastActivePreset (preset target only)
    Storage-->>Popup: onChanged (if popup still open)
```

The content script needs no editor-specific code: its existing `chrome.storage.onChanged` listeners pick up every save, and the explicit `ACTIVE_PRESET_CHANGED` broadcast keeps parity with the popup's historical behavior for the actively-typed prefix.
