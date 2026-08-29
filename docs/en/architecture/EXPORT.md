# Export Architecture

> 📂 [DS studio Documentation](../) › [Architecture Documentation](../ARCHITECTURE.md) › Export Architecture
>
> **Related specifications**: [Feature Specification](../spec/04-features.md) · [Data Storage Specification](../spec/05-data-storage.md)

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
  - Extracts the thinking process from `.ds-think-content` blocks if `includeThinking` is enabled. Captures search status lines (e.g. "Searched X web pages"), browsed pages with links, and all reasoning paragraphs.
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
- Overwrites other UI settings (global prompt content, includeThinking/References, sidebar auto-hide, chat width, input width, system time toggle, activePresetId, pinnedPresetId, chatWidthEnabled, inputWidthEnabled). **isEnabled** and the device-level **globalPromptEnabled** key are device-local toggles (v4.7.3) and are **NOT** overwritten by import — each device keeps its own enable state. (v4.20.0) The per-preset `globalPromptEnabled` field is a different thing: it lives inside each `PromptPreset`, so it travels with the preset through `mergePresets()` like `name` and `content` do, and IS carried by export/import.
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
- Incrementally scrolls the conversation container. Since v4.19.1 the step distance is **measured, not assumed**: each iteration measures the currently mounted window and asks `HarvestPolicy.computeScrollStep()` how far it may safely scroll. See the Adaptive Scroll Step section below.
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
| `HARVEST_STEP_TIMEOUT` | 8000 ms | Max wait per scroll step for DOM stability |
| `HARVEST_BOTTOM_CONFIRM_COUNT` | 3 | Consecutive bottom confirmations required |
| `HARVEST_SCROLL_JUMP_THRESHOLD_FACTOR` | 1.5 | Safety net: max deviation before abort |

Defined in `content/harvest.dom.js`:

| Constant | Value | Description |
|-|-|-|
| `HARVEST_STABLE_TICKS` | 3 | Consecutive stable checks before proceeding. Do not lower — see the History note above |
| `HARVEST_STABLE_INTERVAL` | 100 ms | Interval between stability checks (was 150 ms before v4.19.0) |
| `HARVEST_BOTTOM_TOLERANCE` | 4 px | Tolerance for bottom detection |

`HARVEST_TOTAL_TIMEOUT` (120000 ms) was **removed** in v4.19.0. Do not reintroduce a total-duration cap in any form — its absence is the bug fix.

`HARVEST_SCROLL_STEP_FACTOR` (0.9) was **removed** from `harvest.js` in v4.19.1. The step is now derived from a live measurement, and the fallback ratio lives in `harvest.policy.js` as `SCROLL_STEP_FALLBACK_FACTOR`. Keeping a second copy here would create two sources of truth for one value.

Defined in `content/harvest.policy.js`:

| Constant | Value | Description |
|-|-|-|
| `HARVEST_STALL_TIMEOUT_MS` | 20000 ms | Continuous no-progress time before the run stops as `'stalled'`. Boundary is inclusive |
| `SCROLL_STEP_SAFETY_FRACTION` | 0.7 | Fraction of the measured safe limit actually used as the step |
| `SCROLL_STEP_FALLBACK_FACTOR` | 0.9 | Fraction of viewport height used when the measurement is unavailable |
| `SCROLL_STEP_MIN_FACTOR` | 0.25 | Floor for the step, as a fraction of viewport height |

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

### `computeScrollStep(observation)`

Pure. Returns the integer pixel distance to scroll for the next step, derived from a live measurement instead of a fixed fraction of the viewport.

`observation` fields: `mountedBottomOffset` (px from the scroll container's visible top down to the bottom edge of the lowest mounted item node, or a non-usable value when the measurement failed) and `viewportHeight` (`window.innerHeight`).

| Case | Result |
|-|-|
| `viewportHeight` not a finite number > 0 | throws — the caller always has `window.innerHeight`, so this means the calling code is broken |
| `mountedBottomOffset` non-finite or `<= 0` | `round(viewportHeight × 0.9)` — the pre-v4.19.1 fixed behavior |
| Otherwise | `round(mountedBottomOffset × 0.7)`, floored at `round(viewportHeight × 0.25)` |

No upper clamp: the value is derived from the measured safe limit, so a large measurement legitimately produces a large step.

The asymmetry between the first two rows is deliberate. An invalid `viewportHeight` throws because it can only mean broken calling code; an unusable `mountedBottomOffset` degrades quietly because it legitimately happens when DeepSeek changes its markup and the selector matches nothing. Do not harmonize them.

The 0.25 floor is a deliberately marked corner: below it the measurement is far more likely faulty than real — 18 mounted nodes spanning under a quarter viewport would mean roughly 11 px per message — and bounded progress beats crawling through tens of thousands of pixels. If a real page ever legitimately produces spans that small, this floor is the thing to revisit.

## Adaptive Scroll Step

**Why the step is measured rather than assumed (v4.19.1).**

Live measurement of two real conversations, at different scroll positions, established the facts this design rests on:

| Quantity | Sample 1 | Sample 2 |
|-|-|-|
| Viewport height | 988 px | 988 px |
| Container `clientHeight` | 928 px | 928 px |
| Mounted item nodes | 18 | 18 |
| Nodes intersecting the viewport | 5 | 6 |
| Mounted extent above the visible top | 0 px | 0 px |
| Mounted extent below the visible bottom | 4244 px | 3406 px |
| Mounted span from visible top | 5172 px (5.2 viewports) | 4334 px (4.4 viewports) |

Three conclusions follow:

1. **The mount window is item-count-based, not height-based.** Both samples mounted exactly 18 nodes despite different conversations, different scroll positions, and different message lengths. A fixed pixel step is therefore a bet on message length: through a stretch of short messages, 18 nodes span far less height, and a step tuned for long messages would scroll past content that was never mounted. Because the scan is one-directional and never returns, that content is lost permanently and silently.
2. **Coverage comes from the downward overscan, not from upward overlap.** The mounted window does not extend above the visible top at all, so the old 0.9 step was never protected by its 10% "overlap" in any meaningful sense. What actually guaranteed coverage was that each capture reaches 4-5 viewports *below* the current position, so consecutive captures overlap enormously.
3. **The safe limit is therefore measurable.** Everything captured so far extends down to the bottom of the lowest mounted node. If the next step lands the new viewport top at or above that point, the new mount window necessarily overlaps the previous one and nothing can be skipped. That distance is exactly `mountedBottomOffset`.

So `harvest.dom.js` measures it each iteration and `HarvestPolicy.computeScrollStep()` converts it into a step at 70% of the limit. Where messages are long the step grows to 3-4 viewports; where they are short it shrinks automatically. The step factor stops being an assertion about the page and becomes a consequence of it.

Measured against the two samples, the step goes from 889 px (the old fixed 0.9) to 3620 px and 3034 px respectively — roughly 3.4-4.1x fewer scroll steps. Wall-clock gain is smaller than the step-count gain, because a larger step mounts more new content per step and so lengthens the settle.

**Rejected alternative — key-gap detection.** Detecting holes in the captured `data-virtual-list-item-key` sequence was considered as a completeness proof and abandoned after measurement: sample 1 returned `distinctDiffs: [1, 3]`, i.e. a naturally occurring hole, while sample 2 was contiguous. Since gaps occur without anything being missed, a gap cannot prove a miss. Do not revive this idea without new evidence that the numbering is dense.

**Residual risk, stated plainly.** Only two samples were taken, both from the same browser and window size. For the adaptive step to skip content, the measurement would have to overstate the mounted window, which the 0.7 fraction is there to absorb. The measurement runs after the previous step's settle, so it reflects the mount window at rest — which is the same state the capture sees.
