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

The `PresetOverlay` module (coordinated by `content/content-script.js` via factory, with UI logic split across `preset-overlay.controller.js`, `preset-overlay.resolvers.js`, `preset-overlay.styles.js`, `preset-dropdown.component.js`, `preset-dropdown.position.js`, and `preset-settle.scheduler.js`) renders a floating dropdown centered on the chat title bar (`div._2be88ba`) on the DeepSeek page, enabling preset switching without opening the popup.

**DOM Structure**:
- A `<div id="dss-preset-overlay" role="combobox">` wrapper acts as the custom combobox container. Its positioning is dynamically computed per-frame by `content/preset-dropdown.position.js`'s `computePlacement()` (not static CSS) — see positioning modes below.
- Inside, a `<button class="dss-preset-trigger">` shows the currently selected preset name, and a `<ul id="dss-preset-menu" role="listbox">` dropdown lists available presets. The title bar gets `position: relative !important` via the selector `._2be88ba:not(._1551317)` to serve as the positioning anchor — the `:not(._1551317)` exclusion preserves DeepSeek's native `position: absolute` on new conversation pages, preventing layout breakage of the welcome screen (`_9a2f8e4`).
- CSS is injected via `injectOverlayStyles()` with a guard (`#dss-overlay-style`) to prevent duplicate injection, and can be removed entirely via `removeOverlayStyles()`.

#### Responsive Positioning (v4.2.0–v4.2.2)

The overlay uses three placement modes computed by `content/preset-dropdown.position.js`:

- **Center mode** (viewport ≥ 768px): Centered vertically (`top: 50%; transform: translateY(-50%)`) within the title bar container. Horizontal position is dynamically set via inline `left` and `width` by `computePlacement()`.
- **Gap mode** (< 768px): Positioned in the gap between the chat title's right edge and the new-chat button's left edge. A bounded settle retry loop (`preset-settle.scheduler.js`) polls the button's `left` position every animation frame until it stabilizes for 3 consecutive frames, preventing incorrect early measurements during page load.
- **Hidden mode**: Overlay hidden entirely when the gap is too small.

Supporting infrastructure includes a `ResizeObserver` on the target element and a window resize listener with rAF throttling.

**Lifecycle**:
1. `start(presets, activeId, enable)` — called from `initSettings()` after `setupNavigationDetection()`. Injects overlay styles, sets up the DOM observer, finds and mounts to the title bar, renders the preset list, and sets initial visibility based on the `enable` parameter (tied to the master switch `isEnabled`).
2. `findAndMount()` — queries `._2be88ba`. If found and different from the current target, calls `mountTo()` which builds the DOM and appends it to the title bar, then syncs visibility from `isEnabled` and reads storage to render the current state.
3. `setupDomObserver()` — a `MutationObserver` on `document.body` debounced at 150ms watches for DOM changes (SPA navigation) and re-triggers `findAndMount()` when the title bar is replaced.
4. `setVisible(enabled)` — toggles `display: none` on the wrapper. Called on master switch changes and on SPA remount to respect the current `isEnabled` state.

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
- **Auto-selection**: On new conversations (no UUID), `activePresetId` is cleared to `''`, so the empty option is selected by default. On preset deletion, if the active preset was deleted, the system resets to the empty state.
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
