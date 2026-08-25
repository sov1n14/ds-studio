# 使用者互動模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › [內容腳本模組](CONTENT_SCRIPTS.md) › 使用者互動
>
> **相關規格**：[功能規格](../spec/04-features.md)

## Quote Reply Module

`content/quote-reply.js` implements a `QuoteReply` singleton that adds a floating "引用回覆" button triggered by text selection in the AI response area.

### Trigger and Scope

- **Scope guard** (`isSelectionInScope`): Only activates when both `anchorNode` and `focusNode` of the selection reside inside `div.ds-virtual-list-visible-items`. Selections crossing outside this container are ignored.
- **Trigger event**: `document.selectionchange`, funnelled through the single `handleSelectionEvent` scheduler with a 250 ms debounce (`QUOTE_REPLY_DEBOUNCE_MS`). One event source is enough — `selectionchange` already fires for mouse drags, Shift/Arrow keyboard selection, and IME-composed input alike, so no `mouseup` or `keyup` listener is needed. `document.mousedown` is bound separately, but only to dismiss the button on an outside click.
- **Snapshot strategy**: `QuoteReply.selectedText` is captured synchronously at debounce-end. The button `click` handler uses this snapshot rather than re-reading the live selection — mitigates virtual-list node unmount race conditions.

### Lifecycle (registerFeatureToggle)

`QuoteReply.init()` registers the module with `content/feature-toggle.js` using `ownKey: null`, so the feature has no toggle of its own and follows the extension master switch alone. `registerFeatureToggle` resolves the initial state by asking the background service worker (`DSS_GET_SETTINGS`) and thereafter reacts to the `DSS_SETTINGS_CHANGED` broadcast — the module never reads `chrome.storage` directly.

- `enable()` creates the button element and attaches the `selectionchange` and `mousedown` document listeners.
- `disable()` detaches both, clears the pending debounce timer, calls `hideButton()` (which also drops the scroll/resize listeners), and removes the button element, resetting `btnEl` to `null`.
- The `dsI18n.onLocaleChanged` subscription is the one exception: `dsI18n` exposes no unsubscribe, so it is registered once behind the `hasLocaleSubscription` flag and left in place across disable cycles. While the feature is off, `handleLocaleChanged` returns immediately because `btnEl` is `null`.
- `init()` itself only registers the toggle; listeners are attached lazily, the first time the master switch resolves to on. A `window.__DSS_QR_INITIALIZED__` guard keeps a duplicate script injection from registering twice.

### Button Positioning (`unionClientRects` + `computeButtonPosition`)

`handleSelectionChange` collects all client rects from `range.getClientRects()` and merges them via `unionClientRects` into a single bounding box (`top`/`left`/`bottom`/`right`/`width`). Zero-area rects are skipped.

`computeButtonPosition` is a pure function computing `{top, left, hidden}` from that union rect, button dimensions, and viewport dimensions:

- Default: button placed 16px above the top of the full selection block, horizontally centred on the union width.
- Left/right boundary clamping: minimum 10px margin from viewport edges.
- Top flip: if computed `top < 10`, button moves 8px below the union bottom (last line of the block).
- Hidden: returned when the full selection block has scrolled out of the viewport (`bottom < 0` or `top > vh`).

### Scroll and Resize Handling

A single `handleViewportChange` handler serves both `scroll` (capture, passive) and `resize`. It is attached to `window` only while the button is visible (`showButton`) and detached on `hideButton`, tracked by the `isScrollAttached` flag so the pair is never double-bound. The handler defers to `requestAnimationFrame` before re-running `handleSelectionChange`, so it does not block the scroll thread.

### Textarea Injection (`injectQuote`)

Appends `formatQuote(selectedText)` to the textarea value:

- **`formatQuote`**: `text.split(/\r?\n/).map(l => '> ' + l).join('\n')` — each line receives a Markdown blockquote prefix.
- **React-aware write**: Uses `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` (same pattern as `content-script.js:302-303`) followed by `input` and `change` event dispatch to trigger React state updates.
- **Append logic**: empty textarea → quoted text only; non-empty → existing content + `\n` (if not already ending with `\n`) + quoted text.

### CSS Injection

A `<style id="dss-quote-reply-style">` is injected into `document.head` with `.dss-quote-btn` styles:

- `position: fixed; z-index: 2147483000` for proper stacking above the DeepSeek UI.
- Light/dark mode handled by both `@media (prefers-color-scheme: dark)` and `html[data-theme="dark"]` selectors (the latter covers DeepSeek's runtime theme toggle).
- **i18n support** (v4.3.3+): The button label text is sourced via `dsI18n.t('quoteReplyBtnLabel')` instead of being hardcoded, and a `dsI18n.onLocaleChanged(QuoteReply.handleLocaleChanged)` subscription live-updates the button text when the user switches language without requiring a page reload. `handleLocaleChanged` preserves the existing `<svg>` node and rebuilds only the label `<span>`.

### Dismissal Conditions

The button hides when: (1) text selection is cleared or collapses, (2) selection node leaves scope, (3) the selection scrolls fully out of the viewport, (4) the window resizes (recomputes position, hides if out of bounds), (5) the user clicks anywhere outside the button.

### Test Interface

Exports via `module.exports` (Node-env guard): `handleSelectionChange`, `injectQuote`, `unionClientRects`, `computeButtonPosition`, `isSelectionInScope`, `formatQuote`, `showButton`, `hideButton`, `getButtonEl`, `enable`, `disable`, `__resetState`, `__setState`, `__getState`.

## Edit Message Cleanup Module

`content/edit-message-cleanup.js` strips the injected prompt wrapper from DeepSeek's edit textarea so the user edits only their original message. It complements the prompt-injection flow in `content-script.js` (`injectPrefix`): injection wraps the outgoing message, this module unwraps it on re-edit.

### Trigger and Scope

- **Delegated listener**: A single document-level `click` handler (`handleEditButtonClick`) registered idempotently via a `window` guard flag.
- **Edit-button resolution**: `e.target.closest('.d4910adc')` — the obfuscated edit-button class (`EDIT_BUTTON_CLASS`). Non-matching clicks return early (guard clause).

### Asynchronous Textarea Detection (`waitForNewTextarea`)

The edit textarea renders AFTER the click, so it must be detected asynchronously. A naive "walk up to the nearest ancestor that contains a textarea" approach is wrong: at click time the only textarea on the page is the main bottom composer, and the broad virtual-list ancestor contains it — so that strategy resolves synchronously to the WRONG (empty) textarea and never waits for the real edit box. Detection is therefore snapshot-based and class-independent:

- `handleEditButtonClick` snapshots the textareas already present at click time: `new Set(document.querySelectorAll('textarea'))`.
- **`waitForNewTextarea(preExisting, onFound)`**: watches `document.body` via `MutationObserver` (`childList: true, subtree: true`) and picks the first textarea NOT in the snapshot — that is definitively the edit textarea. Fires `onFound` at most once, then disconnects. Hard timeout `DETECTION_TIMEOUT_MS` (2000ms). If the found textarea's `value` is still empty at discovery (React not yet populated), a secondary watch on that specific textarea waits up to `VALUE_WAIT_TIMEOUT_MS` (800ms) for the value to populate. All per-click state (resolved flag, timeout id, observer) is closure-local — no module-level mutable state.

### max-height Adjustments (`applyMaxHeightAdjustments` + `computeDynamicMaxHeight`)

Applied once at the detection moment (`onFound`), when the edit UI is mounted and the target elements exist:

- **`.cc852ac5`** (`REMOVE_MAX_HEIGHT_SELECTOR`): inline `style.maxHeight = 'none'` on every matched element — always runs.
- **`._646a522`** (`DYNAMIC_MAX_HEIGHT_SELECTOR`): inline `style.maxHeight` set to a dynamic value computed at that moment via the pure `computeDynamicMaxHeight(windowHeight, sourceHeightA, sourceHeightB)` = `windowHeight - sourceHeightA - sourceHeightB - MAX_HEIGHT_OFFSET_PX` (offset = 32px). Heights are read in real time: `window.innerHeight`, and `getBoundingClientRect().height` of the first `._2be88ba` (`HEIGHT_SOURCE_SELECTOR_A`) and first `._871cbca` (`HEIGHT_SOURCE_SELECTOR_B`). **Missing-source rule**: if either source element is absent from the DOM, the `._646a522` adjustment is skipped entirely (left untouched) — the `.cc852ac5` removal still runs. Computed once; no resize listener. Overrides are not restored when editing ends.

### Scroll-into-position (`applyEditScrollPosition` + `computeScrollDelta` + `findScrollableAncestor`)

After the max-height adjustment and wrapper cleanup, the edit box is scrolled so it visually sits `EDIT_SCROLL_GAP_PX` (16px) below the fixed header `._2be88ba`. Because `.cc852ac5` lives inside a scrollable container while `._2be88ba` is fixed (different z-layers), the alignment is achieved purely by adjusting the container's `scrollTop` — not by repositioning the element. Run once inside a `requestAnimationFrame` (after `applyMaxHeightAdjustments` + `applyTextareaCleanup`) so the post-cleanup layout is measured.

- **`computeScrollDelta(editBoxTop, headerBottom, gap)`** (pure): returns `editBoxTop − (headerBottom + gap)` — the signed pixel amount to ADD to the scroller's `scrollTop` (positive scrolls down, negative scrolls up).
- **`findScrollableAncestor(el)`**: walks up from `el` (inclusive) and returns the nearest node whose `scrollHeight > clientHeight`, else `null`.
- **`applyEditScrollPosition(root)`** (root defaults to `document`, falls back to `document` when null): finds `.cc852ac5` (edit box) and `._2be88ba` (header), starts from `.ds-virtual-list-items._6f2c522` and resolves the real scroller via `findScrollableAncestor` (fallback to `._6f2c522` itself), reads `getBoundingClientRect()` geometry in real time, then `scrollContainer.scrollTop += computeScrollDelta(top, bottom, EDIT_SCROLL_GAP_PX)`. **Guard rule**: if the edit box, header, or scroll container is missing, it is a no-op (no throw). One-time adjustment; no resize/scroll listener.

### Wrapper Extraction (`extractUserInput` + `applyTextareaCleanup`)

- **`extractUserInput(text)`**: Returns the inner content if `text` matches `/<user-input>\n([\s\S]*)\n<\/user-input>$/` (the same end-anchored regex shape as `content-script.js`), else `null`. Non-string input → `null`. The `$` anchor means trailing content after `</user-input>` does not match.
- **`applyTextareaCleanup(textarea)`**: Calls `extractUserInput(textarea.value)`. On a match, rewrites the value to ONLY the inner content using `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` followed by `input`/`change` event dispatch (same React-aware write as `quote-reply.js` / `content-script.js`). When there is **no** `<user-input>` wrapper, the textarea is left completely untouched and no event is dispatched (explicit requirement — plain messages are never cleared).

### Test Interface

Exports via `module.exports` (Node-env guard): `extractUserInput`, `computeDynamicMaxHeight`, `applyMaxHeightAdjustments`, `computeScrollDelta`, `findScrollableAncestor`, `applyEditScrollPosition`, `applyTextareaCleanup`, `waitForNewTextarea`, `handleEditButtonClick`, plus constants `EDIT_BUTTON_CLASS`, `REMOVE_MAX_HEIGHT_SELECTOR`, `DYNAMIC_MAX_HEIGHT_SELECTOR`, `HEIGHT_SOURCE_SELECTOR_A`, `HEIGHT_SOURCE_SELECTOR_B`, `MAX_HEIGHT_OFFSET_PX`, `EDIT_SCROLL_GAP_PX`, `USER_INPUT_REGEX`, `DETECTION_TIMEOUT_MS`, `VALUE_WAIT_TIMEOUT_MS`.

## PreventAutoScroll Module

The PreventAutoScroll module uses a two-file architecture to suppress DeepSeek's automatic scroll-to-latest behavior. It is active in two distinct modes: **transient**, for the duration of a controlled operation like Markdown export or go-top, and **persistent** (v4.12.0), for as long as the user leaves the `dsPreventAutoScroll` setting on.

### Architecture

- **`content/prevent-auto-scroll.js`** (MAIN world): Executes in the page's JavaScript context. Monkey-patches `Element.prototype.scrollTo`, `Element.prototype.scrollBy`, `window.scrollTo`, `window.scrollBy`, the `scrollTop` setter on `Element.prototype`, and **`Element.prototype.scrollIntoView`** (unconditionally blocked when bridge is enabled). Each patched method checks `_isBridgeEnabled()` before allowing or blocking the scroll. If the bridge is enabled (interception active), calls to scroll to the bottom of the conversation are suppressed.
- **`content/prevent-auto-scroll-bridge.js`** (ISOLATED world): Content script that manages injection and control. Injects the main-world script via a `<script>` element using `chrome.runtime.getURL('content/prevent-auto-scroll.js')`. Creates and manages a hidden `<div id="dss-prevent-auto-scroll-bridge" style="display:none">` in the document whose `dataset.enabled` attribute is read by the main-world patch.

### Control Flow

- `enable()`: Sets `bridge.dataset.enabled = 'true'`. The main-world patch reads this and begins suppressing auto-scroll calls. Never touches persistent state, so it stays idempotent in either mode.
- `disable()`: Sets `bridge.dataset.enabled = 'false'` — **unless persistent mode is on, in which case it is a no-op** (v4.12.0).
- `isEnabled()`: Reads the current flag. **There is no reference counting** — outside persistent mode, `disable()` is an unconditional global off-switch. Any caller that may run nested inside another caller's enabled window MUST save the prior state via `isEnabled()` and restore it, rather than blind-toggling.
- `setPersistent(shouldPersist)` (v4.12.0): When true, enables protection and marks `bridge.dataset.persistent = 'true'`. When false, clears the mark and force-writes `dataset.enabled = 'false'` directly — deliberately bypassing `disable()`'s own persistent guard, which would otherwise make turning persistence off unable to ever release the protection.
- `isPersistent()` (v4.12.0): Reads the persistent flag. Persistent state lives on the same hidden bridge element's dataset as `enabled`, so the module keeps no module-scope mutable state.
- `start()` (v4.12.0): Auto-invoked at module load, mirroring `content/hide-thinking.js`'s bootstrap convention. Reads `dsPreventAutoScroll` and the `isEnabled` master switch from `chrome.storage.local`, applies the result, then subscribes to `chrome.storage.onChanged` (ignoring namespaces other than `local`). Persistent mode is on only when the master switch is enabled AND the setting is true; an absent master key counts as disabled. Every relevant change re-reads both keys from storage rather than caching partial state.

### Consumers

Three consumers coordinate with this bridge, and the first two nest:

- **`harvest.js`** enables it before the scroll-to-top phase and disables it in a `finally` after the entire top-to-bottom capture completes — so it stays on for the whole export. Note that `finally` block calls `disable()` **unconditionally**; combined with the absence of reference counting, that is precisely why `disable()` had to become a no-op under persistent mode. Without that guard, one Markdown export would silently switch off a user-enabled permanent lock.
- **`go-top.js`** (`scrollToTopAndWait`, in `go-top.scroll.js`) enables it for the duration of a single scroll-to-top and restores the prior state in `cleanup()`. Because `harvest.js` calls `scrollToTopAndWait` from inside its own enabled window, GoToTop uses save-and-restore: it disables only if it was the call that enabled. A blind `disable()` here would strip harvest's protection mid-export. Under persistent mode this logic short-circuits naturally — `isEnabled()` is already true, so GoToTop neither enables nor disables.
- **The `dsPreventAutoScroll` popup toggle** (v4.12.0) drives `setPersistent()` via `start()`'s storage subscription. Neither of the two transient consumers was modified to support it: the persistent flag lives at the shared choke point, which is the only place a caller-agnostic mode switch can be correct given that callers do not refcount.

**Scope caveat.** The main-world patch is a global `Element.prototype`-level interception that blocks **downward** scrolls only and cannot distinguish page-initiated from user-initiated calls. Under persistent mode this means DeepSeek's streaming follow-scroll is also suppressed, and any conversation-switch that needs to scroll down to land correctly will be blocked too. Native wheel/trackpad scrolling does not route through these JS APIs and is unaffected. This trade-off is why the setting defaults to `false`.

### Design Decisions

- The content script (isolated world) uses its own unpatched `Element.prototype` references for all scroll operations, so `harvest.js` and `go-top.js` can scroll freely while the page's auto-scroll is suppressed. Note this describes immunity from the patch, not coordination with it — enabling the patch is a separate, explicit step each consumer must take.
- The bridge element avoids `chrome.*` API calls from the main world (which are unavailable there).
- The main-world script includes an idempotency guard (`window.__dsvPreventAutoScrollInstalled`) to prevent double-injection.
- Both files are declared in `manifest.json`: `prevent-auto-scroll.js` as a `web_accessible_resource`, `prevent-auto-scroll-bridge.js` in the `content_scripts` array.

## System Time Injection

The system time injection feature prepends a timestamp before user messages to provide the model with the current date and time.

### Storage Key

- `dsShowSystemTime` (boolean, default `false`) — stored in the `KEYS.SHOW_SYSTEM_TIME` key.

### Popup Toggle

A checkbox in the Features & Export card (`#showSystemTimeToggle`) controls the setting. It is part of the master-switch-aware sub-controls: when `isEnabled` is turned off, the toggle is disabled.

### Content Script Integration

In `content-script.export.js` (re-exported through `content-script.js`):

- `let showSystemTime = false` — runtime state variable, initialized from storage during `initSettings()`.
- `formatSystemTime(date = new Date())` — pure function returning `yyyy/mm/dd hh:mm:ss (UTC±hh:mm)` in 24-hour format with zero-padding and local timezone offset.
- `formatTimezoneOffset(date)` — pure helper returning the timezone offset string `UTC±hh:mm` (e.g., `UTC+08:00`, `UTC-03:45`).
- In `injectPrefix()`, the system time is prepended before the injection prefix:
  ```
  Current Time: 2026/05/31 14:30:00 (UTC+08:00)\n\n
  ```
  This string is inserted before the injection prefix (if any) and the `<user-input>` wrapper.

### Re-injection Guard

The timestamp is captured once at injection time (not at page load), so each message reflects the time when the user pressed send. If `showSystemTime` changes between messages (via popup toggle + `chrome.storage.onChanged`), the new value takes effect on the next send.

### Master Switch Awareness

When `isEnabled` is `false`, `injectPrefix()` returns early — the system time is never prepended regardless of `showSystemTime`. The toggle in the popup is also disabled by `applyMasterSwitchUI()`.
