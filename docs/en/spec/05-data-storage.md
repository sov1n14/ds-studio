# Data Storage, Sync, and Backup Specifications

> 📂 [DS studio Documentation](../../) (Chinese) › [Feature Specifications](../../SPEC.md) (Chinese) › Data Storage and Sync
>
> **Related Architecture**: [Storage Architecture](../../architecture/STORAGE.md) (Chinese)

## 8. Data Migration

- On first run after upgrading from v1.2.x, if `promptPrefix` (old key) contains content but `promptPresets` (new key) does not exist, the old content is migrated into a prompt group named "My Prompts" and set as active.
- If `promptPrefix` is empty or does not exist, `promptPresets` starts with an empty array and `activePresetId` is set to an empty string.

## 12. Toast Notification System and Storage State

- **Storage State Indicator**: The `<span id="saveStatus">` next to the popup menu title. `showSaveStatus()` displays green "Saved" text for 1 second. Used for all auto-save confirmations (toggles, prompt groups, sliders).
- **Toast Notifications**: The `<div id="toast" class="toast" hidden>` at the bottom of the popup menu. `Toast.show(message, durationMs?)` unhides, sets the text with `opacity: 1`, then fades out (400ms CSS transition) after `durationMs` (default 2000ms). Used for:
  - Export failure: "Export failed, please refresh the page and try again" (2 seconds)
  - JSON export success: "Settings exported successfully" (2 seconds)
  - JSON import success: "Settings restored successfully. Please refresh the page." (2 seconds, page reloads after 3 seconds)
  - Sync conflict resolution success: "Data has been merged and synced successfully" (~1 second, page reloads after 1 second)

## 13. JSON Backup and Restore

- **Export**: The "Backup Settings (Export JSON)" button reads all settings via `StorageManager.getSettings()`, serializes to JSON, and triggers a download with the filename `ds-studio-backup-YYYYMMDD.json`.
- **Import**: The "Restore Settings (Import JSON)" button opens a file picker. After file selection and user confirmation:
  - Prompt groups use `mergePresets()` to **merge** — same ID retains the newer `updatedAt`, new IDs are appended.
  - `chatPresetMap` is merged via spread (local base + imported additions).
  - UI settings (globalDefaultPrompt, includeThinking, includeReferences, sidebar auto-hide, widths) are **overwritten** by the import values.
  - On success, a toast is shown and the popup menu reloads after 3 seconds.
  - (v4.7.3) `isEnabled` / `globalPromptEnabled` are device-level local-only toggles; importing a backup **must not overwrite** the current device's toggle state, preventing a disabled extension from being accidentally enabled by an import. (v4.20.0) This refers to the device-level `globalPromptEnabled` key; each prompt group's own `globalPromptEnabled` field belongs to the prompt group data and is exported/imported along with `mergePresets()`.
  - (v4.10.1) After import, `clearPresetTombstones()` is called to precisely clear `dsPresetTombstones` records corresponding to each prompt group ID in `importedSettings.promptPresets` (skipped if nonexistent). This fixes the defect where deleting all prompt groups then importing a backup caused them to be re-deleted on the next cross-device sync because old tombstones had not yet expired.
- Additionally, the Backup & Restore card contains three buttons — "Export Restore Records", "Import Restore Records", and "Clear All Restored Records" — dedicated to managing `restored_messages` (censor reply restore records), independent of general settings backup.

## 14. Cloud Sync and Conflict Handling

- **Sync Target**: Uses `chrome.storage.sync` as the primary cross-device sync storage target. If the sync quota is exceeded, automatically falls back to `chrome.storage.local`.
- **Auto Sync**: All write operations (`_set()`) write to both sync and local storage as a safety measure.
- **Conflict Detection**: On first run (or upgrade), the local and sync `promptPresets` are compared. If they differ and sync has data, `syncConflictPending = true` is set and reading from sync data is blocked (only local data is returned).
- **Conflict Resolution UI**: When `syncConflictPending` is true, opening the popup menu displays a "Cloud Sync Conflict" dialog with a "Merge Sync" button.
- **Resolution Logic**: `StorageManager.resolveSyncConflict()` reads from both storage areas, merges prompt groups via `mergePresets()`, overwrites UI settings with the cloud version (except `isEnabled` / device-level `globalPromptEnabled` — both are device-level local toggles and do not participate in sync conflict resolution; each prompt group's own `globalPromptEnabled` field merges normally with the prompt group, v4.20.0), and clears the conflict flag.
- **Smart Merge**: `mergePresets()` uses a Map keyed by prompt group `id`. For each ID, the prompt group with the newer `updatedAt` is retained. New IDs are appended. This prevents data loss when both sides independently modify prompt groups.
- **Sort Arbitration (v4.11.19)**: `mergePresets()` also determines the **order** of the returned array, based on both sides' `dsPresetOrderMeta`. The local order is adopted only when the local `orderUpdatedAt` is **strictly greater than** the cloud's; in all other cases (**including exactly equal timestamps**), the cloud's `order` array is used. This rule and the read path's `_pickPresetOrderByRecency()` are two independent mechanisms; `mergePresets()` does not call the latter.
  - Equal timestamps are **the norm, not an edge case**: a single `_set()` writes to `chrome.storage.sync` first, then mirrors the same object to `chrome.storage.local`, so after any successful save, both sides' `orderUpdatedAt` are necessarily bit-identical.
  - Choosing cloud on a tie instead of local is because only cloud winning **converges** — the read path never writes merge decisions back to cloud (`_get()` only writes back to local), so choosing local would leave two devices permanently retaining different orders. The responsibility for protecting "local is genuinely newer" belongs to the `dsLocalAuth` retry queue.
  - Before v4.11.19, on a tie `chosen` remained undefined, falling back to the Map's insertion order (locally cached groups first, then remaining ones in cloud order). This made the visible order depend on "**which prompt group objects happened to be cached in `chrome.storage.local`**" rather than the saved order array, causing drag-to-reorder to be silently discarded on the next merge.
- **Retry Guard (v4.11.18)**: When `retrySync()` pushes keys from the `dsLocalAuth` queue, `dsPresetOrderMeta` and `dsPresetTombstones` previously fell in the unconditional push path, and stale local values would overwrite newer cloud values. Guards with comparison and per-id union merge have now been added; see the `dsLocalAuth` description above for details.
- **Deletion Tombstones (v4.8.3)**: Deleting a prompt group records a tombstone with a deletion timestamp in `dsPresetTombstones` (both local and sync). `resolveSyncConflict()` first merges tombstones from both sides (retaining the entry with the newer `ts`) and cleans up tombstones older than the 30-day retention period, then hands off to `mergePresets()` for judgment: any side's data whose `updatedAt` is not later than its tombstone time is excluded, preventing a deleted prompt group from being resurrected by stale data on another device (or in a sync backup).
- **Tombstone Merge Algorithm Fix (v4.10.2)**: Fixes the defect where "clearing tombstones" (`clearPresetTombstones()` called during JSON import restore) previously deleted the tombstone key outright, leaving no timestamp for merge arbitration; if either side still held the old tombstone, already-cleared records would be resurrected. The tombstone entry shape is now `{ ts, deleted }`: actual deletion writes `{ ts, deleted: true }`, clearing (restoring) writes `{ ts, deleted: false }` instead of deleting the key; on merge, the side with the newer `ts` wins entirely, making "clear" and "delete" two ordinary writes on the same timeline where the newer one always prevails. Legacy bare-number tombstones are automatically normalized to `{ ts: <that number>, deleted: true }` for compatibility.

## Technical Specifications

### Target Environment

- **Domain**: `chat.deepseek.com`
- **Platform**: Chrome Extension Manifest V3
- **Permissions**: `storage`, `activeTab`, `alarms` (for background service worker scheduled retries and sync)

### DOM Selectors

- **Input Area**: The `textarea` element in the DeepSeek chat interface.
- **Send Button**: A `div` element with CSS class `div.ds-icon-button[role="button"]` (desktop) or `div.ds-button[role="button"]` (mobile), containing an SVG with a path starting with `M8.3125`.
- **Message Container**: `.ds-virtual-list-visible-items .ds-message`, for enumerating conversation turns.
- **Markdown Content**: `.ds-markdown`, for AI response content.
- **Thinking Process**: `.ds-think-content`, for AI reasoning content.
- **Sidebar Container**: `div.dc04ec1d` — the sidebar container targeted by the auto-hide module.
- **Sidebar Inner Content**: `div.b8812f16.a2f3d50e` — inner content offset via negative `margin-left` when collapsed.
- **Message List Area**: `.ds-virtual-list-items._6f2c522` — target for conversation area width CSS injection.
- **Input/Container Area**: `._871cbca` — target for both conversation area width (centering) and input box width (max-width) CSS injection.
- **Main Application Area**: `._765a5cd` — MutationObserver monitoring target for SPA reapplication of UI adjustments.
- **Conversation Title Bar**: `._2be88ba` — positioning anchor for the overlay prompt group menu.
- **Go Down Native Button**: `._0706cde` (with `ds-button--floating ds-button--circle` and other classes) — GoToTop's detection target and positioning reference.
- **Floating Button Wrapper Container**: `.aaff8b8f` (`position: relative`) — GoToTop button's injection target container; outer sticky container `._871cbca`.
- **Conversation Start Anchor**: `._9663006._2c189bc` / `[data-virtual-list-item-key="1"]` — GoToTop hide condition and "reached top" determination anchor.

### Storage Structure

| Key | Type | Default | Description |
|-|-|-|-|
| `dsPresetIndex` | `string[]` | `[]` | Ordered array of prompt group IDs (v1.7.0 new format). |
| `dsPreset_<id>` | `PromptPreset` | — | Each prompt group stored independently under this key, bypassing the sync per-item 8KB limit. Each group: `{ id, name, content, createdAt, updatedAt, globalPromptEnabled }`. `globalPromptEnabled` (v4.20.0) is the per-group global prompt injection toggle; explicitly set to `true` on creation; existing data without this field is treated as `true`; synced across devices with the prompt group. |
| `activePresetId` | string | `""` | ID of the currently active prompt group. |
| `pinnedPresetId` | string | `""` | ID of the prompt group pinned as "default"; empty string means no default (v4.18.0). Single scalar value, so only one group can be pinned at a time. Read only when opening a new conversation (URL has no chat id) to preselect; existing conversations are unaffected. Follows the same write path as `activePresetId` (sync primary, local fallback), and is included in settings backup export and import. |
| `isEnabled` | boolean | `false` | Whether prompt injection is enabled (master switch). |
| `includeThinking` | boolean | `true` | Whether to include the AI thinking process in exported Markdown. |
| `includeReferences` | boolean | `true` | Whether to include citation reference links in exported Markdown. |
| `globalDefaultPrompt` | string | `''` | Global prompt prepended to all prompt groups across all conversations. |
| `globalPromptEnabled` | boolean | `true` | Whether the global prompt is injected (v3.0.0). The master switch has higher priority. Since v4.20.0, demoted to a **legacy fallback key** — used only when no active prompt group exists; when an active prompt group exists, that group's own `globalPromptEnabled` field takes precedence (resolution logic in `StorageManager.resolveGlobalPromptEnabled()`). |
| `chatPresetMap` | object | `{}` | *Migrated to chunked storage in v2.4.0*: old flat key, read only during migration, cleaned up after migration. |
| `chatPresetMapMeta` | `{ version, chunkCount, chunkSizes[] }` | `{ version:0, ... }` | (v2.4.0+) Chunk index: version number (optimistic concurrency token), chunk count, per-chunk byte sizes. |
| `chatPresetMap_0`, `chatPresetMap_1`, ... | `{ [uuid]: presetId }` | — | (v2.4.0+) Actual data chunks, each ≤ 7168 bytes; when merged, they form the complete chatPresetMap. |
| `dsSidebarAutoHide` | boolean | `false` | Whether the sidebar auto-hide feature is enabled. |
| `dsChatWidth` | number | `70` | Conversation area width percentage (30–100). |
| `dsChatWidthEnabled` | boolean | `false` | Whether conversation area width adjustment is enabled. |
| `dsInputWidth` | number | `70` | Input box width percentage (30–100). |
| `dsInputWidthEnabled` | boolean | `false` | Whether input box width adjustment is enabled. |
| `dsHideThinking` | boolean | `false` | Whether the hide thinking process feature is enabled. |
| `dsAutoExpandMessages` | boolean | `false` | (v4.32.0) Whether auto expand messages is enabled. When on, a MutationObserver automatically clicks collapsed expand buttons so all messages are expanded by default. Linked to the master switch. |
| `dsPreventAutoScroll` | boolean | `false` | (v4.12.0) Whether prevent auto-scroll is persistently enabled. When on, `PreventAutoScroll` suppresses downward auto-scrolling at all times, not just during "Back to Top" and Markdown export. |
| `dsShowSystemTime` | boolean | `false` | Whether to inject the current system time at the start of messages. |
| `dsWebSearchToggle` | string | `'on'` | (v4.13.0, v4.17.0 changed to two-state) Web search button **default value**: `'on'` sets the page's smart search button to `aria-pressed="true"`, `'off'` to `"false"`. Applied only once per activation event — entry, this key changing, or master switch turning on (v4.17.1) — then the user's manual toggle is preserved until the next activation event; clicks only on state mismatch. The old `'default'` value has been removed; residual values are treated as `'on'` (not written back). Linked to the master switch. |
| `dsLocalAuth` | `string[]` | `[]` | Retry queue (local only). Records key names that failed to write to sync and were written to local instead, for `retrySync()` to later push to cloud. **Since v4.7.2, the `_get()` read path no longer pins local values based on this list** — this key is purely a retry queue and does not affect read priority. (v4.11.18) `retrySync()` applies different guards per key when pushing, not unconditionally retrying all; see the *Sync Write Quota Strategy* in the architecture documentation for details. |
| `syncInitialized` | boolean | `false` | Whether initial sync has completed (local only). |
| `syncConflictPending` | boolean | `false` | Whether there is a sync conflict pending user resolution (local only). |
| `dsPresetTombstones` | `Object<id, { ts: number, deleted: boolean }>` | `{}` | (v4.8.3) Prompt group deletion tombstones, synced on both local and cloud. Used during merge to determine if an id has been deleted, preventing stale data from resurrecting it. (v4.10.1) `clearPresetTombstones()` is called after JSON import to clear tombstones for imported IDs, preventing re-deletion on the next sync. (v4.10.2) Entry shape changed from bare number to `{ ts, deleted }`: `deleted: true` means deleted, `deleted: false` means cleared (restored). On merge, the side with the newer `ts` wins entirely. Legacy bare-number entries are auto-normalized to `{ ts, deleted: true }` on read. |
| `dsOversizedKeys` | `string[]` | `[]` | (v4.8.2) List of keys permanently exceeding the 8KB sync quota (local only). Self-healing: automatically removed when the next write's size falls below the limit. |
| `dsPresetOrderMeta` | `{ order: string[], orderUpdatedAt: number }` | `{ order:[], orderUpdatedAt:0 }` | (v4.6.2) Authoritative timestamp for prompt group ordering, used to determine which side's order is newer during cross-device merge. |
| `promptPresets` | `PromptPreset[]` | — | *Retired in v1.7.0*: previously used to store all prompt groups as an array; replaced by `dsPresetIndex` + `dsPreset_<id>`. |
| `restored_messages` | object | {} | Restored censor reply records, containing message_id, fragments, etc. (local only, max 200 entries). |

### Implementation Details

- **Content Script**: Derives the injection prefix from the conversation's UUID binding via `updatePromptPrefixFromBinding()`. Monitors `chrome.storage.onChanged` for `dsPresetIndex`, `dsPreset_*` (new independent keys), and `CHAT_PRESET_MAP` changes, no longer depending on the retired `promptPresets` key. `handleChatChange()` validates binding validity using `StorageManager.getSettings()` rather than reading raw storage keys directly, ensuring correct parsing through the new schema. Also listens for `ACTIVE_PRESET_CHANGED` messages from the popup for per-tab prompt group tracking. Each tab independently tracks `pendingPresetId` to avoid cross-tab contamination. The `awaitingNewChatUuid` flag with a 5-second timeout controls the auto-binding mechanism. Includes a built-in `PresetOverlay` module that presents a floating prompt group menu on the conversation page title bar, supporting bidirectional sync and automatic remounting on SPA navigation.
- **Storage API**: Uses `chrome.storage.sync` as primary storage, with automatic fallback to `chrome.storage.local` on quota errors. Reads merge sync and local data (except during conflicts, when only local is returned).
- **Retry Queue (`dsLocalAuth`)**: When sync writes fail, affected key names are added to the `dsLocalAuth` list; values are still written to local to prevent data loss, and `retrySync()` later attempts to push them to cloud. Keys are removed from `dsLocalAuth` after a successful sync write. **This list does not affect read priority** — since v4.7.2, `_get()` no longer pins local values based on it. (v4.11.18) Each key has its own guard during retry: `dsPresetIndex` and `dsPresetOrderMeta` are only pushed when the local timestamp is not older than the cloud's; `dsPreset_<id>` is only pushed when the local copy is newer; `dsPresetTombstones` is always pushed as a per-id union merge, never overwriting cloud wholesale.
- **Event Handling**: Intercepts input events at the capture phase to ensure injection completes before the original send logic executes. Uses the native HTMLTextAreaElement value setter to bypass React's synthetic value tracking. Re-dispatches suppressed events via `requestAnimationFrame`.
- **Dialog System**: The `Modal` controller object presents inline dialogs as `position: fixed` overlays. `Modal.prompt()` enforces required input validation. `Modal.confirm()` supports dangerous variants and single-button (alert) mode.
- **Sidebar Auto-Hide Module**: The `SidebarAutoHide` object in `content/sidebar-auto-hide.js`. Manages sidebar collapse/expand through CSS classes, inline styles, and CSS transitions. Uses two `MutationObserver` instances (one for SPA DOM replacement, one for native collapse/expand cycles). Includes dropdown hover detection via capture-phase `mouseover` on `document`.
- **Conversation Area Width Module**: The `ChatWidth` object in `content/chat-width.js`. Injects dynamic `<style>` elements with `vw`-based `!important` overrides. Reapplies via `MutationObserver` on SPA DOM changes.
- **Input Box Width Module**: The `InputWidth` object in `content/input-width.js`. Same architecture as `ChatWidth` but with input-specific selectors, using independent storage keys and `getEffectivePercent()` for conversation area width clamping.
- **Storage State and Toast**: `showSaveStatus()` toggles the `#saveStatus` header span. The `Toast` object in `popup.js` manages the `#toast` div with opacity transitions.
- **Auto-Start Pattern**: Each content module (`SidebarAutoHide`, `ChatWidth`, `InputWidth`) follows the same startup pattern: `start()` reads storage → enables if conditions are met → registers a `chrome.storage.onChanged` listener for instant toggling, with master switch awareness.
