# 導航與介面模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › [內容腳本模組](CONTENT_SCRIPTS.md) › 導航與介面
>
> **相關規格**：[Popup UI 規格](../spec/02-popup-ui.md) · [提示詞系統規格](../spec/01-prompt-system.md)

## SPA Navigation Detection

DeepSeek's chat interface is a single-page application (SPA). When the user switches conversations or starts a new one, the URL path changes without a full page reload. A `MutationObserver` on `document.body` watches for DOM changes and compares `window.location.pathname` against the last known value. When a path change is detected, `handleChatChange()` is called to:

1. Extract the new UUID from the URL path (`/a/chat/s/{uuid}`).
2. Re-load `chatPresetMap` from storage.
3. If the UUID has a bound preset → set `promptPrefix` to that preset's content (verify the preset still exists via `StorageManager.getSettings()` using the new per-key schema; if stale, clean up the binding).
4. If the UUID is unknown but we transitioned from a no-UUID state **and** the per-tab `awaitingNewChatUuid` flag is set (indicating the user actually triggered a send on the new-conversation page) → auto-bind the per-tab `pendingPresetId` to the new UUID. Without the flag (e.g., user manually clicked an existing conversation from the new-chat page), the transition is treated as ordinary navigation and no binding is created. This ensures every conversation maintains an independent binding relationship.
5. For no-UUID pages: unconditionally clear `promptPrefix`, `pendingPresetId`, and `awaitingNewChatUuid` to prevent stale preset inheritance across tabs.
6. Back/forward browser navigation is additionally handled via the `popstate` event.

### `awaitingNewChatUuid` Flag Mechanism

To prevent unintended auto-binding (e.g., selecting a preset on a new conversation page then manually switching to an existing unbound conversation), auto-bind is gated by the `awaitingNewChatUuid` boolean:

- **Set**: Only by `markChatCreationAttempt()`, which is called when the user actually presses Enter or clicks the send button on a no-UUID page with non-empty input.
- **Consumed**: By `handleChatChange()` when transitioning from no-UUID to UUID — if `awaitingNewChatUuid` is true and `pendingPresetId` is non-empty, the binding is created.
- **Self-clears**: After 5 seconds via `setTimeout` to prevent stale-flag pollution after failed sends.
- **Also cleared**: On manual navigation away from the new-chat page, and in the no-UUID branch of `handleChatChange()`.

This ensures merely opening a popup on a new chat page and selecting a preset, then clicking on an existing conversation, will NOT auto-bind that conversation.

## Overlay Preset Selector

The `PresetOverlay` module (coordinated by `content/content-script.js` via factory, with UI logic split across `preset-overlay.controller.js`, `preset-overlay.resolvers.js`, `preset-overlay.styles.js`, `preset-viewport-sync.js`, `preset-id.resolver.js`, `preset-dropdown.component.js`, `preset-dropdown.position.js`, `preset-dropdown.menu-position.js`, `preset-dropdown.width.js`, `preset-dropdown.options.js`, `preset-dropdown.keyboard.js`, and `preset-settle.scheduler.js`) renders a floating dropdown centered on the chat title bar (`div._2be88ba`) on the DeepSeek page, enabling preset switching without opening the popup.

**DOM Structure**:
- A `<div id="dss-preset-overlay" role="combobox">` wrapper acts as the custom combobox container. Its positioning is dynamically computed per-frame by `content/preset-dropdown.position.js`'s `computePlacement()` (not static CSS) — see positioning modes below.
- Inside, a `<button class="dss-preset-trigger">` shows the currently selected preset name, and a `<ul id="dss-preset-menu" role="listbox">` dropdown lists available presets. The title bar gets `position: relative !important` via the selector `._2be88ba:not(._1551317)` to serve as the positioning anchor — the `:not(._1551317)` exclusion preserves DeepSeek's native `position: absolute` on new conversation pages, preventing layout breakage of the welcome screen (`_9a2f8e4`).
- CSS is injected via `injectOverlayStyles()` with a guard (`#dss-overlay-style`) to prevent duplicate injection, and can be removed entirely via `removeOverlayStyles()`.

#### Responsive Positioning (v4.2.0–v4.2.2)

The overlay uses three placement modes computed by `content/preset-dropdown.position.js`:

- **Center mode** (viewport ≥ 768px): Centered vertically (`top: 50%; transform: translateY(-50%)`) within the title bar container. Horizontal position is dynamically set via inline `left` and `width` by `computePlacement()`.
- **Gap mode** (< 768px): Positioned in the gap between the chat title's right edge and the new-chat button's left edge. A bounded settle retry loop (`preset-settle.scheduler.js`) polls the button's `left` position every animation frame until it stabilizes for 3 consecutive frames, preventing incorrect early measurements during page load.
- **Hidden mode**: Overlay hidden entirely when the gap is too small.

Supporting infrastructure includes a `ResizeObserver` on the target element and a window resize listener with rAF throttling. Both, plus the settle-loop wiring, live in `content/preset-viewport-sync.js` (v4.18.1) — the controller keeps ownership of the state fields and of the DOM writes themselves, and passes element refs and the apply callback in as explicit parameters, so no mutable state is shared at module level.

#### Trigger Width (v4.18.1)

The width the overlay occupies hugs the **widest** candidate label rather than the currently displayed one. `content/preset-dropdown.width.js` builds the candidate list from every option name plus the placeholder text, measures each by temporarily writing it into the real label span and reading `scrollWidth` (so the measurement carries the label's own computed font), restores the original text in a `finally`, and feeds the widths to the pure `pickNaturalWidth()` in `preset-dropdown.position.js`. That function returns `max(labelWidths) + arrowWidth + paddingLeft + paddingRight + gap`, floored at `minWidth` (80) and deliberately **uncapped** — capping to the available horizontal space stays with `computePlacement()`, which clamps to `maxWidth` (200) and, in gap mode, to the measured gap.

Because `getNaturalWidth()` sits on the placement path that the settle loop runs every animation frame, the measurer caches its result per dropdown instance and only recomputes when the inputs change: the cache is invalidated in `setOptions()` (option data rebuilt) and in `updateLocale()` (placeholder text changed). A per-frame remeasure would rewrite the label text N times and force N reflows every frame.

> Before v4.2.x this control was a native `<select>` sized by the browser to its widest `<option>` (`min-width: 80px; max-width: 200px`, no `width`). When it became a custom combobox that native content-hugging was lost and never reintroduced — the measurement only ever read the single visible label — so the width sat at the 200px cap. `pickNaturalWidth()` restores the original behavior explicitly.

**Lifecycle**:
1. `start(presets, activeId, enable)` — called from `initSettings()` after `setupNavigationDetection()`. Injects overlay styles, sets up the DOM observer, finds and mounts to the title bar, renders the preset list, and sets initial visibility based on the `enable` parameter (tied to the master switch `isEnabled`).
2. `findAndMount()` — queries `._2be88ba`. If found and different from the current target, calls `mountTo()` which builds the DOM and appends it to the title bar, then syncs visibility from `isEnabled` and reads storage to render the current state.
3. `mountTo()` applies placement **synchronously in the same task as the `appendChild`**, via `_applyPlacementSync()`, before the settle loop starts (v4.18.1). Appending first and waiting for an animation frame let the browser paint one frame at the element's unsized default geometry, and the jump from that frame to the first measured placement read as an "expand" animation on page load. There is no CSS transition on the overlay at all — the only transition in `preset-dropdown.css` is on `.dss-preset-arrow` for the open/close rotation — so the fix is purely one of ordering, not of masking. The settle loop still runs afterwards, because the DeepSeek host page's own layout genuinely keeps moving during load.
4. `setupDomObserver()` — a `MutationObserver` on `document.body` debounced at 150ms watches for DOM changes (SPA navigation) and re-triggers `findAndMount()` when the title bar is replaced.
5. `setVisible(enabled)` — toggles `display: none` on the wrapper. Called on master switch changes and on SPA remount to respect the current `isEnabled` state.

#### Which Preset Id the Overlay Displays (v4.18.1)

`findAndMount()` used to compute the id to render with a hardcoded ternary — `currentChatUuid ? (chatPresetMap[currentChatUuid] || '') : ''`. The `else` branch was a literal empty string, so it never consulted `pendingPresetId` or `pinnedPresetId`. Since React replaces the title bar when the user starts a new conversation by clicking inside the page, that remount deterministically overwrote whatever `handleChatChange()` had just pushed in through `updateActiveId()` — the pinned default only survived a full page refresh (where `initSettings()` seeds the render from the persisted `activePresetId` and the title bar is never replaced) or the first sent message (where a UUID now exists, so the ternary takes the correct branch).

That decision now lives in the pure module `content/preset-id.resolver.js`:

    resolveOverlayPresetId({ chatUuid, chatPresetMap, pendingPresetId, pinnedPresetId, presets })

- A non-empty `chatUuid` takes the id **only** from `chatPresetMap`, and `pendingPresetId` / `pinnedPresetId` can never influence it. This is what keeps an existing conversation's preset immune to the pinned default.
- With no chat id, the pending id is **three-valued**: a non-empty string whose preset still exists wins; the empty string `''` means the user explicitly chose the empty (no-op) preset and must **not** fall back to the pinned default; `null` / `undefined` means nothing has been chosen yet, so the pinned default applies (again only if that preset still exists).
- A stale id on either path — the preset was deleted — degrades to `''`.

The controller reads the live pending id through an optional `ctx.getPendingPresetId()` getter supplied by `content/content-script.js`, and takes `pinnedPresetId` and the presets array from the `getSettings()` call `findAndMount()` already performs — no second storage read. An absent getter degrades to `undefined`, which the resolver correctly reads as "nothing chosen yet".

> Preserving the three-valued signal requires `??`, not `||`. Both `onSelectChange()` in the controller and the `ACTIVE_PRESET_CHANGED` handler in `content-script.js` previously wrote `id || null`, and `'' || null` is `null` — which collapsed "the user explicitly chose empty" into "nothing chosen yet" and let the pinned default reappear over an explicit choice on the next remount.

**Bidirectional Sync**:
- **Overlay → Popup**: `onSelectChange(newId)` calls `StorageManager.saveActivePresetId(newId)` and, if a UUID is bound, `StorageManager.bindChatToPreset(uuid, newId)` to update `chatPresetMap`. The popup reads these values from storage on open.
- **Popup → Overlay**: The popup sends `ACTIVE_PRESET_CHANGED` messages — the content script handler calls `PresetOverlay.updateActiveId()`. Additionally, `chrome.storage.onChanged` for `ACTIVE_PRESET_ID` triggers `updateActiveId()` as a safety net.
- **Preset List Sync**: When `dsPresetIndex` or any `dsPreset_<id>` key changes, `StorageManager.getSettings()` is called and `PresetOverlay.render()` re-populates the dropdown.

**SPA Resilience**:
- The DOM observer detects title bar replacement during conversation switching.
- `handleChatChange()` calls `PresetOverlay.updateActiveId(resolvedId)` at both the early return (no-UUID → clear) and the main return (UUID → show bound preset).
- `findAndMount()` avoids redundant mounts by comparing `this.targetEl` with the found element.

**ARIA and Accessibility**:
The overlay dropdown follows ARIA authoring practices:
- The trigger (`<div id="dss-preset-overlay">`) has `role="combobox"`, `aria-haspopup="listbox"`, and `aria-expanded`.
- The menu (`<ul id="dss-preset-menu">`) has `role="listbox"` and `aria-label="提示詞組清單"`.
- Each preset item has `role="option"`.
- Keyboard navigation: Up/Down arrows cycle through options, Enter selects, Escape closes.
- (The popup's `custom-select.js` has its own ARIA attributes for edit/delete buttons and drag handles — separate from this overlay component.)

## Empty Preset (No-Op Mode)

The empty preset mode provides an explicit way to disable per-preset injection without disabling the entire extension:

- **Always visible**: An empty `<option value="">` is permanently present at the top of the preset dropdown in the popup, regardless of page context or UUID binding status. This ensures a consistent UI even when no custom presets exist.
- **Behavior when selected**: The prompt content textarea is disabled (grayed out, `cursor: not-allowed`) and the rename/delete buttons are disabled.
- **Auto-selection**: On new conversations (no UUID), `activePresetId` is cleared to `''`, so the empty option is selected by default — unless a pinned default preset exists (v4.18.0). When `pinnedPresetId` names a preset that still exists, `handleChatChange()`'s no-UUID branch instead seeds `pendingPresetId` with it, persists it as `activePresetId`, and updates the overlay, so a new conversation opens with that preset preselected. A stale pinned id (the preset was deleted) falls back to the empty-option behavior described above. This branch is reached only when the URL carries no chat id, which is what keeps existing conversations untouched — no extra guard is involved. On preset deletion, if the active preset was deleted, the system resets to the empty state.
- **Global prompt interaction**: The global default prompt (if set) is still injected even when the empty preset is selected — only per-preset injection is skipped.

## Toast Notification System & Save Status Indicator

The popup includes two distinct feedback mechanisms:

**Save Status Indicator**:
- **DOM**: A `<span id="saveStatus" class="status-hidden">已儲存</span>` element next to the title in the popup header.
- **API** (`popup.js`): `showSaveStatus()` — removes the `status-hidden` class (making the green text visible), clears any pending timer, then sets a 1000ms timer to re-add the class. Used for all auto-save confirmations (preset content, toggles, slider changes).

**Sync Status Indicator** (added v2.0.0):
- **DOM**: A `<span id="syncStatus">` element immediately after `#saveStatus` in the popup header.
- **API** (`popup.js`): `refreshSyncStatus()` — calls `StorageManager.isSyncedWithCloud()` and `StorageManager.hasOversizedItems()` (v4.8.2), toggles the `.synced` or `.unsynced` CSS class, and sets the text to `雲端同步` (green), `未同步` (red), or `內容過大，僅存本機` (red, oversized).

There are three sync states: `synced` (green), `unsynced` (red, transient), and `oversized` (red, permanent — keys exceed 8KB sync limit). Called after every storage write and on initialization. Errors are silently swallowed — the indicator is informational only.
- **CSS**: `#syncStatus.synced { color: var(--success-color) }` and `#syncStatus.unsynced { color: #dc2626 }`.

**Toast Notification**:
- **DOM**: A `<div id="toast" class="toast" hidden>` element at the bottom of `popup.html`, outside the main container for fixed positioning.
- **API** (`popup.js`): `Toast.show(message, durationMs?)` — unhides the toast, sets its text, applies `opacity: 1`, then after `durationMs` (default 2000ms) sets `opacity: 0` and hides it (400ms CSS transition delay). Used for:
  - **Export failure**: "匯出失敗，請重整頁面後再試" displayed for 2 seconds when `chrome.tabs.sendMessage` for Markdown export fails.
  - **JSON export success**: "設定已成功匯出" displayed for 2 seconds.
  - **JSON import success**: "設定已成功還原，請重新整理頁面。" displayed for 2 seconds (followed by page reload at 3s).
  - **Sync resolution success**: "資料已成功合併同步" displayed for 2 seconds (followed by page reload at 1s).
- **Backup/restore operations**: "設定已成功匯出", "匯出失敗", "設定已成功還原", "復原備份已匯出", "復原備份已匯入", "已清除所有已還原紀錄", "清除失敗" — all driven by `popup/popup.backup-manager.js`.
