# UI 調整模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › [內容腳本模組](CONTENT_SCRIPTS.md) › UI 調整
>
> **相關規格**：[UI 調整規格](../spec/03-ui-adjustments.md)

## Sidebar Auto-Hide

The `SidebarAutoHide` module in `content/sidebar-auto-hide.js` manages the sidebar collapse/expand behavior:

- **Collapse**: When enabled, the sidebar (`div.dc04ec1d`) is collapsed to 60px width. The inner content (`div.b8812f16.a2f3d50e`) is shifted via negative `margin-left` to hide behind the collapsed wrapper, leaving only a thin strip visible.
- **Expand**: On `mouseenter`, after a 150ms delay, the sidebar expands to its original stored width and the inner margin is cleared.
- **Hover zone expansion**: A capture-phase `mouseover` listener on `document` monitors the cursor position when the sidebar has a pending collapse timer (`leaveTimer`). If the mouse enters a floating/dropdown element (detected by class `ds-elevated` or elements inside `.ds-floating-position-wrapper`), the collapse timer is cancelled and the sidebar remains expanded until the mouse leaves the floating element. This ensures dropdown menus rendered via React portals (outside the sidebar's DOM tree) are properly handled.
- **Collapse trigger**: On `mouseleave`, after a 400ms delay, the sidebar collapses back to 60px (unless the mouse entered a dropdown menu). Resizing the window also triggers re-collapse via a debounced (200ms) resize handler.
- **CSS transitions**: A `<style>` element with `transition: width 0.22s cubic-bezier(...)` and `transition: margin-left 0.22s cubic-bezier(...)` is injected for smooth animation.
- **Overflow handling**: The wrapper gets `overflow: hidden` (except when DeepSeek's native collapse is active, where the thin bar should remain visible).
- **SPA resilience**: A `MutationObserver` on `document.body` detects when the sidebar DOM node is replaced (SPA navigation), re-binds events, and re-collapses. A sidebar-specific `MutationObserver` watches for DeepSeek's native collapse/expand cycles and reapplies the custom collapse state when needed.
- **Master switch awareness**: When `isEnabled` (master switch) changes to `false`, the module disables regardless of its own toggle. When it changes to `true`, the module re-reads its own toggle and enables if true.
- **Storage listener**: Registers a `chrome.storage.onChanged` listener for `dsSidebarAutoHide` and `isEnabled` to enable/disable in real time.
- **Startup**: On `start()`, reads `dsSidebarAutoHide` and `isEnabled` from storage, enables if both are true.

## Chat Width Adjuster

The `ChatWidth` module in `content/chat-width.js` controls the conversation area width:

- **CSS injection**: Injects a `<style>` element that sets:
  - `max-width: Xvw !important` on `.ds-virtual-list-items._6f2c522` (message list container)
  - `margin-left: auto !important; margin-right: auto !important; padding-left: 0 !important; padding-right: 0 !important` on `._871cbca` (input/container area for centering)
  - Uses a CSS custom property `--message-list-max-width: ${vw}vw !important` on the message list.
- **Range**: 30% to 100% viewport width, clamped via `Math.min(Math.max(...))`.
- **SPA resilience**: A `MutationObserver` on `._765a5cd` (or `document.body` fallback) re-injects styles after DOM changes, debounced at 200ms.
- **Master switch awareness**: When `isEnabled` changes to `false`, disables. When changed to `true`, re-reads own toggle and enables if true.
- **Storage listener**: Listens for `dsChatWidth` and `dsChatWidthEnabled` changes, and `isEnabled` for master switch, applying/reverting styles in real time.
- **Startup**: Reads `dsChatWidth`, `dsChatWidthEnabled`, and `isEnabled` from storage, enables if both toggles are true.

## Input Width Adjuster

The `InputWidth` module in `content/input-width.js` is structurally similar to `ChatWidth` but targets only the edit input area:

- **CSS injection**: Sets `max-width: Xvw !important` and `width: min(100%, Xvw) !important` on `._871cbca`, `._871cbca .aaff8b8f`, `.aaff8b8f` (standalone for new chat pages), and `._871cbca ._77cefa5._3d616d3` (the input area container and textarea), independently of the chat width setting.
- **Range**: 30% to 100% viewport width.
- **Chat width clamping**: The effective input width is capped by the chat width when chat width adjustment is enabled (`getEffectivePercent()`). If chat width is 70% and input width is set to 100%, the actual applied width is 70%. This clamping is enforced in both `enable()` and during SPA re-application via `getEffectivePercent()`. The module also listens for `dsChatWidth` and `dsChatWidthEnabled` changes to re-clamp in real time.
- **SPA resilience**: Same `MutationObserver` pattern with 200ms debounce, observes `._765a5cd` for attribute changes (`class`).
- **Master switch awareness**: Same pattern as ChatWidth — disables when `isEnabled` is turned off, re-reads own toggle when turned back on.
- **Storage listener**: Listens for `dsInputWidth`, `dsInputWidthEnabled`, `dsChatWidth`, `dsChatWidthEnabled`, and `isEnabled`.
- **Independence**: Chat width and input width can be toggled and set independently. Input width only affects the edit area, while chat width affects both the message list and input container.

## Hide Thinking Module

The `HideThinking` module in `content/hide-thinking.js` auto-collapses DeepSeek's "thinking process" blocks on first DOM appearance, keeping the chat view uncluttered.

### DOM Targeting

- **Container selector**: `._74c0879` — the wrapper element for each thinking block.
- **Header selector**: `._245c867` — the clickable toggle header inside the container. (Note: `._5ab5d64` does NOT exist as a fallback in `hide-thinking.js`; that class is used only in the unrelated `censor-reply-restore.dom.js`.)
- **Expanded indicator**: Presence of a `.ds-think-content` child inside the container. Blocks without `.ds-think-content` are already collapsed and are skipped.
- **Collapse marker**: `data-ht-collapsed="1"` is written to the container element after the collapse click. Guards against re-processing blocks that were already collapsed in the current session.

### Collapse Strategy

The module simulates a native user click on the thinking block's header to collapse it — rather than injecting CSS — so that DeepSeek's internal React component state remains consistent with the visual state. Direct CSS manipulation would desync the toggle button's internal state and prevent the user from re-expanding the block.

### Observer Configuration

`MutationObserver` is started with `{ childList: true, subtree: true }`. Crucially, **`attributes` is not observed**. DeepSeek's virtual list may toggle CSS classes on thinking blocks when the user manually expands them; observing attribute mutations would re-trigger the collapse logic on those manual interactions. By observing `childList` only, the module reacts exclusively to new DOM nodes being added.

### Two-Layer Node Search (`scanRoot`)

The `MutationObserver` callback calls `scanRoot(node)` for each added `Element`:

1. **Direct match**: If the added node itself has the container class (`._74c0879`), `tryCollapseButton()` is called on it directly.
2. **Descendant search**: `querySelectorAll('._74c0879')` is run on the added node to catch containers nested inside a larger inserted subtree.

This handles both cases: DeepSeek inserting a thinking block directly, and inserting it inside a message wrapper.

### Safety Guards (`tryCollapseButton`)

Before clicking, three conditions are checked:
1. **`isConnected`**: Skips stale node references that were removed from the DOM between mutation callback and processing.
2. **`data-ht-collapsed`**: Skips blocks already processed in the current session to prevent double-clicks.
3. **`isExpanded()`**: Skips blocks that lack `.ds-think-content` (already collapsed), avoiding redundant re-collapse attempts.

### Enable / Disable

- **`enable()`**: Calls `applyToExisting()` to collapse all currently-expanded blocks on the page, then starts the `MutationObserver` for subsequent additions. Idempotent — returns early if already enabled.
- **`disable()`**: Calls `restoreAll()` to re-expand all blocks marked with `data-ht-collapsed` (removes the attribute and clicks the header), then stops the observer. Idempotent — returns early if already disabled.

### Master Switch Awareness

The module reads both `dsHideThinking` and `isEnabled` (master switch) from storage at startup. `setupStorageListener()` registers a `chrome.storage.onChanged` listener that:
- When `isEnabled` changes to `false` → calls `disable()` regardless of `dsHideThinking`.
- When `isEnabled` changes to `true` → re-reads `dsHideThinking` and calls `enable()` if true.
- When `dsHideThinking` changes → only acts if `isEnabled` is already `true`.

### Known Limitation

DeepSeek uses virtual list rendering; when the user scrolls away and back, previously unmounted nodes are re-inserted as new DOM additions. This means a thinking block that was auto-collapsed and then scrolled off-screen may be auto-collapsed again when scrolled back into view — even if the user had manually re-expanded it.

## GoToTop Module

`content/go-top.js` + `content/go-top.css` implement a floating "回到頂部" button that appears alongside DeepSeek's native go-bottom button.

### Injection Strategy

Two injection modes (stacked / solo) are selected by anchor availability. Injection is gated: `_tryConnectDom()` only injects once the input-area wrapper `.aaff8b8f` (`INJECT_PARENT_SELECTOR`) OR the native button (`_getNativeButton()`) is present, retrying every 500ms up to 120 times (≈60s). If neither anchor appears within the cap, the module gives up and injects NOTHING — there is deliberately no floating-overlay fallback (a previous `position: fixed` last-resort mode was removed because, when the proper anchor was still rendering, it attached the button to the first `.ds-theme` element — a notification overlay — in the wrong place). The native go-bottom button is the new ds-button design-system element — `<div role="button" class="ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ds-button--m ds-button--icon-relative-m ds-button--floating _0706cde">` with inline CSS variables (`--dsl-button-height: 34px`, `--dsl-button-icon-size: 14px`, floating fill/hover colors) and three child layers (`.ds-button__background`, `.ds-button__border`, `.ds-button__icon`). `_createButtonElement()` builds the GoToTop button clone-first: when the native button is present it is `cloneNode(true)`-copied (stripping the site's positioning hash class `_0706cde` so the site's own `querySelector('._0706cde')` calls never capture our node); when absent, a hardcoded template (`NATIVE_BTN_TAG` / `NATIVE_BTN_CLASSES` / `NATIVE_BTN_INLINE_STYLE` constants, matching `to-fix/gotop-fix/samples/go-bottom.html`) reproduces the same markup. Both paths add the `dsw-gotop` marker class, accessibility attributes, and replace the icon with `_iconSvg()` (the native 14×14 down-arrow flipped via `transform: scaleY(-1)`, `fill="currentColor"`). Appearance (34×34 circle, background, border, shadow, hover) is rendered entirely by the site stylesheet through the copied classes and inline variables. The extension's base `.dsw-gotop` CSS rule deliberately declares NO appearance properties (no border/background/color/display) so it never shadows the site's component styling; positioning is supplied exclusively by the extension's own modifier classes (`--stacked` / `--solo`):

- **Stacked mode (`_injectionMode = 'injected'`)**: When the native go-bottom button is present, the go-top button is injected via `insertBefore` as its sibling inside `aaff8b8f` and given the `dsw-gotop--stacked` class (`position: absolute; bottom: 100%; right: 12px`). `_applyStackedOffset()` computes the inline `margin-bottom` at runtime as native `margin-bottom` + native `offsetHeight` + 8px gap (CSS fallback: 62px = 20 + 34 + 8), so the button always sits 8px above the native button without overlapping. Native-button detection uses `._0706cde:not(.dsw-gotop)` with structural fallbacks scoped to the `.aaff8b8f` wrapper (`.ds-button--floating.ds-button--circle:not(.dsw-gotop)`, `[role="button"].ds-button--floating.ds-button--circle:not(.dsw-gotop)`, `[role="button"].ds-button--floating[class*="ds-button--circle"]:not(.dsw-gotop)`). A post-validation gate in `_getNativeButton()` rejects non-`_0706cde` matches that are `ds-button--primary`, `ds-button--filled`, `ds-button--disabled`, or lack `ds-button--floating` — preventing misidentification of unrelated round buttons in the same wrapper (e.g. send/toolbar buttons).
- **Solo mode (`_injectionMode = 'wrapper-solo'`)**: When the native button is absent but the wrapper `aaff8b8f` exists (located by `_locateWrapperDirect()`, with structural fallback `._871cbca > div:nth-child(2)`), the button is injected as the wrapper's first child with the `dsw-gotop--solo` class, which replicates the native button's positioning (`position: absolute; bottom: 100%; right: 12px; margin-bottom: 20px`) so it appears exactly where the native button would be.

When neither the native button nor the wrapper can be located, `_injectButton()` no-ops and returns `false` — no button is created. There is no `position: fixed` fallback.

The button stays `display: none` by default in every mode and is shown only when the conversation has scrolled down (first message is above the viewport).

### SPA Resilience

A `MutationObserver` (configured in `_startWrapperObserver()`) watches the outer wrapper (`_871cbca`) with `childList + subtree` for mutations. When it detects that the go-top button has been removed from the DOM (React re-render), it re-injects the button. It also performs bidirectional mode transitions via `_transitionToStacked()` / `_transitionToSolo()`: when the native button appears while in solo mode, the button is upgraded to stacked mode (solo class removed, stacked class added, inline offset recomputed); when the native button disappears while in stacked mode, the button is downgraded back to solo mode. Transitions REUSE the same button element (moved with `insertBefore`, classes swapped, `display` state preserved) — the element is never removed and re-created, which would cause visible flicker during programmatic scrolling. A no-op guard skips the transition when the button is already in the correct mode. Debounced at 80ms to avoid duplicate injections during batch mutations.

A route observer monitors `window.location.pathname` via a body `MutationObserver` + `popstate` event. On route change, the module resets all state (cancels active scroll, clears retry timers, removes the old button, stops all observers) and, after a 100ms DOM-settling delay, drives the gated retry loop `_tryConnectDom()` instead of the old one-shot `_injectButton()` call. This ensures the button reliably appears even when the input-area wrapper `.aaff8b8f` or the native button hasn't mounted yet — `_tryConnectDom()` retries every 500ms up to 120 times until readiness, and only then performs the injection, scroll-container reattachment, listener restart, and visibility evaluation. The previously separate `_reattachScrollListener()` method was deleted as dead code (its logic is fully covered by the `_tryConnectDom()` success branch).

### Visibility Logic

- **Show condition**: The first visible message's `getBoundingClientRect().bottom < 0` (scrolled above the viewport).
- **Hide condition**: `_isAtTop()` — true only on verifiable evidence: `scrollContainer.scrollTop <= 1`, or the **verifiable first-message anchor** (`[data-virtual-list-item-key="1"]`) is fully within the viewport. Loose "first mounted message" selectors are deliberately NOT trusted for the at-top verdict: with DeepSeek's virtual list the true first message is often unmounted, and any mounted message near the viewport top would otherwise yield a false "at top" (this previously made `scrollToTopAndWait()` stop after ~one viewport).
- Hysteresis prevents flickering: if neither condition is true, the current display state is preserved.
- A DOM observer (`_startObserver()`) with 50ms debounce on body mutations triggers re-evaluation. A scroll listener on the container (throttled at 100ms) also triggers re-evaluation.

### `scrollToTopAndWait()`

This is the programmatic smooth-scroll API, returning a `Promise<{success, reason?}>`:

1. Toggle (click-to-stop): if a scroll is already in progress (`_locked`), calling it again aborts the current scroll at its present position via `_scrollReject({ success: false, reason: 'stopped-by-user' })` and returns immediately WITHOUT starting a new scroll. The button stays clickable (`aria-disabled` remains `"false"`) for the entire scroll — it is never disabled mid-scroll.
2. Scrolls in steps of `-0.9 * viewportHeight` using `scrollBy()`.
3. After each step, waits for DOM stability via a `MutationObserver` on the scroll container. If the container's `scrollHeight` changes (lazy load), the stability counter resets.
4. Top detection requires 3 consecutive stable ticks with `scrollTop <= 0` and matching `scrollHeight`.
5. Timeout after 30s (configurable). Aborted on route change during scroll (reason `'aborted'`).
6. Calls `_evaluateVisibility()` on cleanup to restore the button display state.

### Master Switch

GoToTop is controlled **solely** by `isEnabled` (no per-feature toggle). `setupStorageListener()` listens for `chrome.storage.onChanged` on the `local` namespace for `isEnabled`. The module auto-starts via `GoToTop.init()` at module load.

### Exported API

Exposed on `window.DSstudio.GoToTop`: `enable()`, `disable()`, `init()`, `scrollToTopAndWait()`, `destroy()`.

## History Panel Module (v4.11.0)

`content/history-panel.{idb,render,export,js}` + `content/history-panel.css` implement a full-conversation viewer that bypasses DeepSeek's virtual list, which (past a certain conversation length) recycles DOM within a fixed window and never requests older messages — leaving the true top unreachable by scrolling. Instead of scrolling the site's list, the module reads the conversation DeepSeek already caches locally.

### IndexedDB Read (`history-panel.idb.js`)

`window.__DS_HistoryPanel_idb` exposes pure helpers plus one impure reader. Since a content script shares the page origin, `window.indexedDB.open('deepseek-chat')` reads the page's own database directly — no extra permission, no MAIN-world injection.

- `loadActiveThread(sessionId)` — opens `deepseek-chat`, reads the `history-message` store, `get(sessionId)` (out-of-line key = conversation UUID). Returns `{ ok: true, sessionId, title, currentMessageId, messages }` or `{ ok: false, reason }` (`NO_SESSION_ID` / `NO_RECORD` / `NO_MESSAGES` / `DB_ERROR`); always closes the DB in `finally`. Messages live at `record.data.chat_messages`; title/`current_message_id` at `record.data.chat_session`.
- `buildActiveThread(messages, currentMessageId)` (pure) — walks `parent_id` from `String(currentMessageId)` up to a root (`parent_id` missing/`null`/`'0'`), reverses to oldest→newest. Falls back to sorting all messages ascending by `Number(inserted_at)` when `currentMessageId` isn't found. Cycle-guarded.
- `parseFragments(raw)` (pure) — parses the `fragments` JSON string (or passes through an array) to `{ type, content }[]`; `[]` on any failure. `normalizeThread()` composes the above into `{ messageId, parentId, role, insertedAt, fragments }[]`.

### Rendering (`history-panel.render.js`)

`window.__DS_HistoryPanel_render`: `createPanel({ onExport, onClose })` builds an unattached full-screen overlay + centered card (header with title, search input, prev/next-match + counter, jump-oldest/newest, export, close; closes on backdrop click + Esc). `renderThread(panelEl, threadResult)` fills the list — an empty/error state per `reason`, otherwise one row per message with a role label, non-THINK fragments as `white-space: pre-wrap` plain text, and `THINK` fragments inside a default-collapsed `<details>`. All conversation text goes through `textContent`/`createTextNode`; search highlighting rebuilds text nodes — **never `innerHTML`** — so message content can't inject markup. `open()`/`close()` toggle visibility and the Esc listener. Only `.dss-history-list` scrolls; the page body never does. Styles (`history-panel.css`, all `dss-history-*`, no `ds-*`/`dsw-*` overrides) support light/dark via `prefers-color-scheme`.

### Markdown Export (`history-panel.export.js`)

`window.__DS_HistoryPanel_export`: `toMarkdown(threadResult)` (pure) → H1 title + per-message role heading + datetime + non-THINK body (`THINK` excluded); `buildFilename(threadResult)` (pure) → sanitized `deepseek-<title>-<sessionId>.md`; `downloadMarkdown(threadResult)` performs the Blob/anchor download.

### Injection & Master Switch (`history-panel.js`)

`window.DSstudio.HistoryPanel` (`enable()`, `disable()`, `init()`, `destroy()`). The open-button is a clone of the site's `ds-button` styling with all `dsw-gotop*` classes stripped and a distinct clock icon (marker class `dss-history-open`), stacked 8px above the go-top button via the same offset math, de-duped and re-injected on SPA route changes. Click loads the active thread and opens the panel (created once, reused). Active only when the master switch (`isEnabled`) AND `historyPanelEnabled` (`dsHistoryPanelEnabled`, default `true`) are on; reacts live via `chrome.storage.onChanged` on the `local` namespace, removing the button and closing the panel when disabled.

## Mobile Sidebar Swipe

The `MobileSidebarSwipe` module in `content/mobile-sidebar-swipe.js` detects right-swipe gestures on mobile devices within the central 80% viewport area and clicks the sidebar toggle button to show/hide the navigation sidebar.

### Trigger Zone

The gesture is activated only when the touch starts in the central 80% of the viewport (10% margin on each side):

- **Horizontal**: `minX = innerWidth * 0.10` to `maxX = innerWidth * 0.90`
- **Vertical**: `minY = innerHeight * 0.10` to `maxY = innerHeight * 0.90`

This central-zone design avoids conflicts with Chrome Android's system back-swipe gesture (which triggers from screen edges) and accidental touches in the top status-bar / bottom navigation areas.

### Gesture Recognition

Five conditions must ALL be satisfied for a click to fire:

| # | Condition | Constant | Rationale |
|---|-----------|----------|-----------|
| a | `deltaX >= 50px` | `SWIPE_THRESHOLD_PX` | Minimum travel distance to filter noise |
| b | `deltaX > |deltaY| * 1.5` | — | Horizontal dominance (reject scroll-like vertical swipes) |
| c | `duration < 500ms` | `SWIPE_MAX_DURATION_MS` | Reject slow drags that aren't intentional fast swipes |
| d | startX within center 80% horizontal | `TRIGGER_ZONE_MARGIN_RATIO = 0.10` | Reject screen-edge swipes |
| e | startY within center 80% vertical | `TRIGGER_ZONE_MARGIN_RATIO = 0.10` | Reject top/bottom edge swipes |

### Mobile Guard

`_isMobileDevice()` returns `true` when `navigator.maxTouchPoints > 0` (physical touch device) OR the userAgent matches `/Mobi|Android|iPhone|iPad/i` (DevTools mobile emulation). All lifecycle methods (`enable()`, `_onTouchStart`, `_onTouchMove`, `_onTouchEnd`) gate on this check — desktop devices have zero overhead.

### DOM Discovery

`_findButton()` uses a primary selector `div.ds-button--capsule.ds-button--iconLabelPrimary[role="button"]` with 5 fallback class combinations. `_tryConnectDom()` polls every 500ms up to 60 times (≈30s) until the button is found, then calls `_bindTouchEvents()`.

### Master Switch Integration

`_setupStorageListener()` registers a `chrome.storage.onChanged` listener for `isEnabled` on the local namespace. When the master switch is turned off, `disable()` unbinds touch listeners, clears timers, and resets swipe state. When turned back on, `enable()` restarts DOM polling.

### Lifecycle

| Method | Behavior |
|--------|----------|
| `start()` | Checks `_isMobileDevice()`, reads `isEnabled` from storage, sets up storage listener, enables if master switch is on |
| `enable()` | Guards on mobile + already-enabled, starts `_tryConnectDom()` |
| `disable()` | Unbinds touch events, clears retry timer, resets swipe state |
| `destroy()` | Delegates to `disable()` |

### Exported API

Exposed on `window.DSstudio.MobileSidebarSwipe`: `start()`, `enable()`, `disable()`, `destroy()`.
