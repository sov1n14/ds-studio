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
   - **PreventAutoScroll** — disables DeepSeek's auto-scroll-to-latest behavior, preventing the virtual list from jumping away from the controlled scroll. (v4.12.0) If the user has turned the `dsPreventAutoScroll` setting on, this protection is already permanently active and the export's own enable/disable pair becomes a no-op.
   - **GoToTop** — calls `GoToTop.scrollToTopAndWait()` to anchor the virtual list at position 0.
4. A non-blocking floating progress toast is shown to the user (styled via `go-top.css`, `pointer-events: none` so it does not block interaction). Since v4.19.0 the toast also carries a cancel button, which individually opts back into `pointer-events: auto` because the container deliberately lets clicks pass through to the page.
5. The harvest loop incrementally scrolls from top to bottom, waiting for DOM stability after each step via `MutationObserver` (see the Harvest Module section below for details).
6. Each message node is cloned as it enters the viewport, deduplicated by the numeric `data-virtual-list-item-key` DOM attribute, and collected.
7. Bottom detection uses 3 consecutive confirmations that `scrollTop + clientHeight >= scrollHeight` to ensure the list is fully loaded.
8. A safety net detects external scroll jumps (e.g., React re-renders) and aborts with partial export.
9. On completion, the original scroll position is restored. On an early stop, partial content is still exported — with a warning footer naming the real cause and an on-page warning toast (v4.19.0).

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
- **Links**: `<a>` with `.ds-markdown-cite` children → `[[link-N]](url)` (gated by `includeReferences`); ordinary links → `[text]` immediately followed by `(url)`
- **Text nodes**: Collapsed whitespace normalization

**File output:**

A Blob download is triggered via a dynamically created `<a>` element. The filename follows the pattern `deepseek-chat-YYYYMMDD-HHmmss.md`.

**Fallback:** The old single-pass DOM query (`.ds-virtual-list-visible-items .ds-message`) is kept as a fallback when the Harvest module is unavailable.

**Incomplete-export reporting (v4.19.0):**

When `harvestAllMessages()` returns `isComplete: false`, the export is never suppressed — the user keeps the partial file. Two signals are emitted instead:

1. A footer line appended to the Markdown body: `> ⚠️ Export may be incomplete (<N> messages captured): <clause>.` — where `<N>` is the actual harvested item count and `<clause>` comes from `HarvestPolicy.describeIncompleteReason(reason)`.
2. An on-page warning toast via `showHarvestToastIncomplete(capturedCount, clause)`, styled distinctly from the neutral progress toast and auto-dismissing after `HARVEST_INCOMPLETE_TOAST_AUTO_DISMISS_MS` (10000 ms).

Before v4.19.0 the footer hardcoded the words "scroll-harvest timed out before reaching the end" for **every** failure reason, so a stalled or cancelled export misreported its own cause. The clause is now derived from the actual reason, and an unrecognized reason still embeds the raw string verbatim so it stays diagnosable.

The on-page toast exists because the footer alone proved invisible in practice: in the reported truncation case it was line 12209 of a 12209-line file, and the user experienced the truncated export as no error at all.

Note the deliberate asymmetry in how the two layers treat a missing `HarvestPolicy`: `harvest.js` throws, because it cannot make loop decisions without it; `content-script.export.js` degrades to a generic clause and still downloads, because it can still deliver the user's data. Do not harmonize these.

## JSON Backup & Restore

The popup includes a Backup & Restore card with four buttons:

**JSON Export**: Reads all settings via `StorageManager.getSettings()`, serializes to JSON, and triggers a Blob download with filename `ds-studio-backup-YYYYMMDD.json`.

**JSON Import**: Opens a file picker (`<input type="file" accept=".json">`). After parsing the JSON, calls `StorageManager.restoreSettings(importedSettings)` which:
- Merges `promptPresets` using `mergePresets()` (preserve newest by `updatedAt`, append new IDs).
- Merges `chatPresetMap` (spread merge: local base + imported additions).
- Overwrites other UI settings (global default prompt, includeThinking/References, sidebar auto-hide, chat width, input width, system time toggle, activePresetId, pinnedPresetId, chatWidthEnabled, inputWidthEnabled). **isEnabled** and **globalPromptEnabled** are device-local toggles (v4.7.3) and are **NOT** overwritten by import — each device keeps its own enable state.
- `pinnedPresetId` (v4.18.0) travels with the backup alongside `activePresetId`: export picks it up automatically because `getSettings()` derives its key set reflectively from `StorageManager.KEYS`, while import needed an explicit entry in `restoreSettings()`'s per-key whitelist. The `!== undefined` guard means an older backup file that predates the key leaves the current device's pinned default untouched, and `mergePresetsOnly` mode skips it like every other UI setting.
- After successful restore, shows a toast and reloads the popup after 3 seconds.

**Censor-Restored Messages Backup/Restore/Clear**: The `restored_messages` dataset (stored in `chrome.storage.local` only) has dedicated buttons in the Backup & Restore card for exporting, importing, and clearing censored-message restoration data independently of general settings.

## Harvest Module

`content/harvest.js` is the scroll-and-harvest engine for full-conversation Markdown export. It operates purely in the content layer (no `chrome.storage` access), communicating via `window.DSstudio.Harvest`.

### `harvestAllMessages()`

The main export entry point. Returns `{ items: Element[], isComplete: boolean, reason?: string }` — an object containing the harvested DOM nodes, a completion flag, and a reason string. `isComplete` is true only when `reason === 'complete'`.

Possible reasons: `'complete'`, `'stalled'`, `'cancelled'`, `'scroll_interrupted'`, `'no_container'`, `'no_messages'`, plus any reason propagated up from `GoToTop.scrollToTopAndWait()`. The `'timeout'` reason was removed in v4.19.0 along with the total-duration cap that produced it.

**Pre-harvest setup:**
1. Enables PreventAutoScroll to suppress DeepSeek's live-scroll behavior. This call is unconditional, and so is the matching `disable()` in the teardown `finally` — which is why `disable()` is a no-op while persistent mode is on (v4.12.0), since the flag has no reference counting and an export would otherwise switch off a user-enabled permanent lock.
2. Calls `GoToTop.scrollToTopAndWait()` to anchor the virtual list at position 0.
3. Shows a non-blocking floating progress toast (`pointer-events: none`, styled by `go-top.css`).

**Scroll loop:**
- Incrementally scrolls the conversation container using `scrollBy(0, viewportHeight * 0.9)`.
- After each scroll step, a `MutationObserver` monitors the container for DOM changes (lazy-loaded messages). The step is considered "settled" after `HARVEST_STABLE_TICKS` (3) consecutive checks at `HARVEST_STABLE_INTERVAL` (100ms) intervals without mutations.
- Layout metrics (`scrollTop`, `clientHeight`, `scrollHeight`) are read once per iteration into locals and reused within it, rather than re-read at each decision point — repeated reads force layout reflow. They are deliberately not cached across iterations, since a scroll legitimately changes them.
- The two `_waitForDomStability()` call sites sit on mutually exclusive branches (at-bottom-confirming vs. scrolling), so a single iteration awaits exactly one of them. This was verified rather than assumed — it looks like a doubled per-step cost and is not one. Do not "consolidate" them.
- Clones each `.ds-message` node as it enters the viewport.
- Deduplication via a `Map<number, Element>` keyed by the numeric `data-virtual-list-item-key` attribute value — a stable key assigned by DeepSeek's virtual list renderer.

**Bottom detection:**
- Checks if `scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - HARVEST_BOTTOM_TOLERANCE` (4px).
- Requires `HARVEST_BOTTOM_CONFIRM_COUNT` (3) consecutive confirmations before declaring the end.

**Safety net:**
- Tracks the expected scroll position after each step. If the actual `scrollTop` deviates by more than `1.5 * viewportHeight` from the expected position, an external scroll jump (React re-render, user intervention) is detected. The harvest aborts and returns partial content with a warning.

**Termination (rewritten in v4.19.0):**

The loop no longer owns its own stop decisions. Each iteration gathers an observation and calls `HarvestPolicy.decideNextStep()`, then obeys the verdict. `nowMs` is supplied by `harvest.js` from `Date.now()` — the policy module never reads a clock itself, which is what makes it testable without fake timers.

There is deliberately **no total-duration cap**. A harvest that keeps making progress runs as long as it needs to; the only time-based stop is `HARVEST_STALL_TIMEOUT_MS` (20000 ms) of *continuous* no-progress, and the cancel button is the user's escape hatch. See the History note below for why.

**Cancellation (v4.19.0):**

A native `AbortController` is created inside `harvestAllMessages()`, so its lifetime is exactly one run and no module-scope mutable state is introduced. `() => abortController.abort()` is handed to the toast as its cancel callback, and `abortController.signal.aborted` feeds the observation's `isAborted` field. A cancelled run returns the messages captured **so far**, not an empty array — partial data is still the user's data.

**Cleanup:**
- On success: restores scroll position, disables PreventAutoScroll (a no-op if the user has persistent mode on, v4.12.0), hides the toast.
- On any early stop (`'stalled'`, `'cancelled'`, `'scroll_interrupted'`): exports the partial content with a reason-accurate warning footer and an on-page warning toast, then cleans up identically.

**History — why the total timeout was removed:**

Before v4.19.0 the loop aborted on a hard `HARVEST_TOTAL_TIMEOUT` of 120000 ms. That cap silently truncated long conversations: a reported export captured 500 messages and lost all of the newest ones, ending cleanly at a message boundary with only a buried footer to show for it.

The cap was exhausted by idling, not by loading. Every step awaited a stability check whose minimum cost was `HARVEST_STABLE_TICKS` (3) × `HARVEST_STABLE_INTERVAL` (150 ms) = 450 ms, paid even on steps where nothing had to load. That put a hard ceiling of roughly 120000 ÷ 450 ≈ 266 steps × 0.9 viewport ≈ 240 viewport-heights on the total reachable scroll, regardless of conversation length. Interruption and slowness were therefore one defect, not two.

The replacement is progress-based: stop only when nothing has changed for a continuous 20 s. Retuning the interval to 100 ms lowered the per-step floor to 300 ms as a side benefit, but the tick count stayed at 3 on purpose — resolving a stability wait early would scroll past content that has not rendered yet, and the scan never comes back up, so those messages would be lost permanently. Completeness outranks speed here.

**Fallback:** If `GoToTop` or `PreventAutoScroll` are unavailable, Harvest falls back to a single-pass DOM query of `.ds-virtual-list-visible-items .ds-message` (capturing only currently visible messages).

### Constants

Defined in `content/harvest.js`:

| Constant | Value | Description |
|-|-|-|
| `HARVEST_SCROLL_STEP_FACTOR` | 0.9 | Scroll step as fraction of viewport height. Calibrated against the live page — do not tune blind |
| `HARVEST_STEP_TIMEOUT` | 8000 ms | Max wait per scroll step for DOM stability |
| `HARVEST_STABLE_TICKS` | 3 | Consecutive stable checks before proceeding. Do not lower — see the History note above |
| `HARVEST_STABLE_INTERVAL` | 100 ms | Interval between stability checks (was 150 ms before v4.19.0) |
| `HARVEST_BOTTOM_TOLERANCE` | 4 px | Tolerance for bottom detection |
| `HARVEST_BOTTOM_CONFIRM_COUNT` | 3 | Consecutive bottom confirmations required |
| `HARVEST_SCROLL_JUMP_THRESHOLD_FACTOR` | 1.5 | Safety net: max deviation before abort |

`HARVEST_TOTAL_TIMEOUT` (120000 ms) was **removed** in v4.19.0. Do not reintroduce a total-duration cap in any form — its absence is the bug fix.

Defined in `content/harvest.policy.js`:

| Constant | Value | Description |
|-|-|-|
| `HARVEST_STALL_TIMEOUT_MS` | 20000 ms | Continuous no-progress time before the run stops as `'stalled'`. Boundary is inclusive |

Defined in `content/harvest.toast.js`:

| Constant | Value | Description |
|-|-|-|
| `HARVEST_INCOMPLETE_TOAST_AUTO_DISMISS_MS` | 10000 ms | Auto-dismiss delay for the incomplete-export warning toast — deliberately longer than a routine toast |

### Exported API

- `harvestAllMessages()` — main harvest entry point (no parameters)
- Exposed on `window.DSstudio.Harvest`

## Harvest Policy Module

`content/harvest.policy.js` (v4.19.0) holds the pure decision logic extracted out of the harvest loop. It has **zero** DOM references, no `chrome.*` calls, no timers, and no clock reads — that purity is the entire point, and compromising it for convenience would put this logic back out of reach of unit tests. It is registered in `manifest.json` immediately before `content/harvest.js`, which consumes it, and is exposed on `window.DSstudio.HarvestPolicy`.

Extracting it also satisfied the `coding-guidelines` §8 split obligation: `harvest.js` had reached 430 lines against the 450-line proactive threshold, so the logic that most needed testing was also the logic that most needed to leave the file.

### `createInitialState(observation)`

Returns the opaque starting state for a run, recording the baseline clock reading, captured count, and scroll height.

### `decideNextStep(observation, state)`

Pure. Returns `{ action: 'continue' | 'stop', reason, state }`. Mutates neither argument.

`observation` fields: `nowMs`, `capturedCount`, `scrollHeight`, `isAtBottomConfirmed`, `isAborted`, `isScrollJumpDetected`.

Decision rules, in strict precedence order — earlier rules win when several conditions hold at once:

| # | Condition | Result |
|-|-|-|
| 1 | `isAtBottomConfirmed` | stop, `'complete'` |
| 2 | `isAborted` | stop, `'cancelled'` |
| 3 | `isScrollJumpDetected` | stop, `'scroll_interrupted'` |
| 4 | Progress made | continue; last-progress clock resets to `nowMs` |
| 5 | No progress for `>= HARVEST_STALL_TIMEOUT_MS` | stop, `'stalled'` |
| 6 | Otherwise | continue; last-progress clock left unchanged so no-progress calls accumulate |

"Progress" means `capturedCount` increased **or** `scrollHeight` changed in *either* direction — a virtualized list can shrink, and treating a shrink as a stall would abort a healthy run.

Bottom-confirmation outranks cancellation on purpose: if the run has already reached the end, it is complete, and reporting it as cancelled would understate what the user actually got.

### `describeIncompleteReason(reason)`

Pure. Maps a stop reason to the English clause used in both the Markdown footer and the warning toast. Every clause starts lowercase and carries no terminal punctuation, so callers supply their own.

| Reason | Clause |
|-|-|
| `'stalled'` | the conversation stopped loading new messages before the end was reached |
| `'scroll_interrupted'` | the page was scrolled by something else during the export |
| `'cancelled'` | the export was cancelled |
| `'no_container'` | the conversation scroll container could not be found |
| `'no_messages'` | no messages were found in the conversation |

An unrecognized non-empty reason yields a fallback clause containing the raw reason verbatim, so an unmapped code stays diagnosable instead of vanishing. `null`, `undefined`, and `''` yield a generic clause that never leaks the literal words "null" or "undefined" into user-facing text.
