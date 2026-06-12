# 匯出架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › 匯出架構
>
> **相關規格**：[功能規格](../spec/04-features.md) · [資料儲存規格](../spec/05-data-storage.md)

## Markdown Export Strategy

Since v2.6.0, the export engine uses a scroll-and-harvest loop to capture the full conversation from DeepSeek's virtualized list, which only renders visible messages in the DOM.

**High-level flow:**

1. The popup sends `{ action: "EXPORT_MARKDOWN", includeThinking, includeReferences }` to the active tab via `chrome.tabs.sendMessage`.
2. The content script (`content-script.js`) receives the message and delegates to `Harvest.harvestAllMessages()`.
3. The harvest module coordinates with two other modules:
   - **PreventAutoScroll** — disables DeepSeek's auto-scroll-to-latest behavior, preventing the virtual list from jumping away from the controlled scroll.
   - **GoToTop** — calls `GoToTop.scrollToTopAndWait()` to anchor the virtual list at position 0.
4. A non-blocking floating progress toast is shown to the user (styled via `go-top.css`, `pointer-events: none` so it does not block interaction).
5. The harvest loop incrementally scrolls from top to bottom, waiting for DOM stability after each step via `MutationObserver` (see the Harvest Module section below for details).
6. Each message node is cloned as it enters the viewport, deduplicated by a composite key (turn index + role), and collected.
7. Bottom detection uses 3 consecutive confirmations that `scrollTop + clientHeight >= scrollHeight` to ensure the list is fully loaded.
8. A safety net detects external scroll jumps (e.g., React re-renders) and aborts with partial export.
9. On completion, the original scroll position is restored. On timeout (120s), partial content is exported with a warning footer.

**Node processing:**

The cloned nodes are processed through `convertMessageNodeToMarkdown()`:
- **AI responses** (containing `.ds-markdown`):
  - Extracts the thinking process from `.ds-think-content` blocks if `includeThinking` is enabled. Captures search status lines (e.g. "搜尋到 X 個網頁"), browsed pages with links, and all reasoning paragraphs.
  - Extracts the main response from `.ds-markdown` blocks outside the thinking container.
- **User messages**: Extracted as plain text from the user content wrapper (`.fbb737a4`).

HTML-to-Markdown conversion (`parseHtmlToMarkdown`) handles:
- **Headings**: `<h1>`–`<h6>` → `#`–`######`
- **Tables**: `<table>` → Markdown table format with header row and separator line
- **Blockquotes**: `<blockquote>` → `>` prefixed lines
- **Lists**: `<ul>` → `- ` items; `<ol>` → numbered items
- **Code**: `<div class="md-code-block">` → extracts `<pre><span>` content into fenced code blocks with language; standalone `<pre>` → fenced code blocks; inline `<code>` → backtick-wrapped
- **Inline formatting**: `<strong>`/`<b>` → `**bold**`; `<em>`/`<i>` → `*italic*`
- **Links**: `<a>` with `.ds-markdown-cite` children → `[[link-N]](url)` (gated by `includeReferences`); ordinary links → `[text](url)`
- **Text nodes**: Collapsed whitespace normalization

**File output:**

A Blob download is triggered via a dynamically created `<a>` element. The filename follows the pattern `deepseek-chat-YYYYMMDD-HHmmss.md`.

**Fallback:** The old single-pass DOM query (`.ds-virtual-list-visible-items .ds-message`) is kept as a fallback when the Harvest module is unavailable.

## JSON Backup & Restore

The popup includes a Backup & Restore card with four buttons:

**JSON Export**: Reads all settings via `StorageManager.getSettings()`, serializes to JSON, and triggers a Blob download with filename `ds-studio-backup-YYYYMMDD.json`.

**JSON Import**: Opens a file picker (`<input type="file" accept=".json">`). After parsing the JSON, calls `StorageManager.restoreSettings(importedSettings)` which:
- Merges `promptPresets` using `mergePresets()` (preserve newest by `updatedAt`, append new IDs).
- Merges `chatPresetMap` (spread merge: local base + imported additions).
- Overwrites other UI settings (global default prompt, isEnabled, includeThinking/References, sidebar auto-hide, chat width, input width, system time toggle).
- After successful restore, shows a toast and reloads the popup after 3 seconds.

**Censor-Restored Messages Backup/Restore/Clear**: The `restored_messages` dataset (stored in `chrome.storage.local` only) has dedicated buttons in the Backup & Restore card for exporting, importing, and clearing censored-message restoration data independently of general settings.

## Harvest Module

`content/harvest.js` is the scroll-and-harvest engine for full-conversation Markdown export. It operates purely in the content layer (no `chrome.storage` access), communicating via `window.DSstudio.Harvest`.

### `harvestAllMessages()`

The main export entry point. Returns an array of cloned DOM nodes (`Element[]`).

**Pre-harvest setup:**
1. Enables PreventAutoScroll to suppress DeepSeek's live-scroll behavior.
2. Calls `GoToTop.scrollToTopAndWait()` to anchor the virtual list at position 0.
3. Shows a non-blocking floating progress toast (`pointer-events: none`, styled by `go-top.css`).

**Scroll loop:**
- Incrementally scrolls the conversation container using `scrollBy(0, viewportHeight * 0.9)`.
- After each scroll step, a `MutationObserver` monitors the container for DOM changes (lazy-loaded messages). The step is considered "settled" after `HARVEST_STABLE_TICKS` (3) consecutive checks at `HARVEST_STABLE_INTERVAL` (150ms) intervals without mutations.
- Clones each `.ds-message` node as it enters the viewport.
- Deduplication via a `Map<string, Element>` keyed by `turnIndex-role` (a composite key derived from the message's position and type).

**Bottom detection:**
- Checks if `scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - HARVEST_BOTTOM_TOLERANCE` (4px).
- Requires `HARVEST_BOTTOM_CONFIRM_COUNT` (3) consecutive confirmations before declaring the end.

**Safety net:**
- Tracks the expected scroll position after each step. If the actual `scrollTop` deviates by more than `1.5 * viewportHeight` from the expected position, an external scroll jump (React re-render, user intervention) is detected. The harvest aborts and returns partial content with a warning.

**Cleanup:**
- On success: restores scroll position, disables PreventAutoScroll, hides the toast.
- On timeout (120s): exports partial content with a warning footer, cleans up.

**Fallback:** If `GoToTop` or `PreventAutoScroll` are unavailable, Harvest falls back to a single-pass DOM query of `.ds-virtual-list-visible-items .ds-message` (capturing only currently visible messages).

### Constants

| Constant | Value | Description |
|-|-|-|
| `HARVEST_SCROLL_STEP_FACTOR` | 0.9 | Scroll step as fraction of viewport height |
| `HARVEST_TOTAL_TIMEOUT` | 120000 ms | Total harvest timeout |
| `HARVEST_STEP_TIMEOUT` | 8000 ms | Max wait per scroll step for DOM stability |
| `HARVEST_STABLE_TICKS` | 3 | Consecutive stable checks before proceeding |
| `HARVEST_STABLE_INTERVAL` | 150 ms | Interval between stability checks |
| `HARVEST_BOTTOM_TOLERANCE` | 4 px | Tolerance for bottom detection |
| `HARVEST_BOTTOM_CONFIRM_COUNT` | 3 | Consecutive bottom confirmations required |
| `HARVEST_SCROLL_JUMP_THRESHOLD_FACTOR` | 1.5 | Safety net: max deviation before abort |

### Exported API

- `harvestAllMessages(options?)` — main harvest entry point
- Exposed on `window.DSstudio.Harvest`
