# User Interaction Module Architecture

> 📂 [DS studio Documentation](../) › [Architecture](../ARCHITECTURE.md) › [Content Script Modules](CONTENT_SCRIPTS.md) › User Interaction
>
> **Related Specifications**: [Feature Specifications](../spec/04-features.md)

## Quote Reply Module

`content/quote-reply.js` implements a `QuoteReply` singleton that adds a floating "Quote Reply" button triggered by text selection in the AI response area.

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
- **React-aware write**: Uses `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` (same pattern as `content/prompt-injector.controller.js:84-85`) followed by `input` and `change` event dispatch to trigger React state updates.
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

`content/edit-message-cleanup.js` strips the injected prompt wrapper from DeepSeek's edit textarea so the user edits only their original message. It complements the prompt-injection flow in `content/prompt-injector.controller.js` (`injectPrefix`, re-exported through `content-script.js`): injection wraps the outgoing message, this module unwraps it on re-edit.

### Trigger and Scope

- **Delegated listener**: A single document-level `click` handler (`handleEditButtonClick`) registered idempotently via a `window` guard flag.
- **Edit-button resolution**: `e.target.closest(EDIT_BUTTON_SELECTOR)` — the icon button with `[aria-disabled]` inside `.ds-flex` in a user-message item (an item containing `.ds-collapsible-text`) (`EDIT_BUTTON_SELECTOR` = `EDIT_MESSAGE_BUTTON_SELECTOR`). Non-matching clicks return early (guard clause).

### Asynchronous Textarea Detection (`waitForNewTextarea`)

The edit textarea renders AFTER the click, so it must be detected asynchronously. A naive "walk up to the nearest ancestor that contains a textarea" approach is wrong: at click time the only textarea on the page is the main bottom composer, and the broad virtual-list ancestor contains it — so that strategy resolves synchronously to the WRONG (empty) textarea and never waits for the real edit box. Detection is therefore snapshot-based and class-independent:

- `handleEditButtonClick` snapshots the textareas already present at click time: `new Set(document.querySelectorAll(ANY_TEXTAREA_SELECTOR))` (`'textarea'`, matching every textarea including the main input).
- **`waitForNewTextarea(preExisting, onFound)`**: watches `document.body` via `MutationObserver` (`childList: true, subtree: true`) and picks the first textarea NOT in the snapshot — that is definitively the edit textarea. Fires `onFound` at most once, then disconnects. Hard timeout `DETECTION_TIMEOUT_MS` (2000ms). If the found textarea's `value` is still empty at discovery (React not yet populated), a secondary watch on that specific textarea waits up to `VALUE_WAIT_TIMEOUT_MS` (800ms) for the value to populate. All per-click state (resolved flag, timeout id, observer) is closure-local — no module-level mutable state.

### max-height Adjustments (`applyMaxHeightAdjustments` + `computeDynamicMaxHeight`)

Applied once at the detection moment (`onFound`), when the edit UI is mounted and the target elements exist:

- **`.cc852ac5`** (`REMOVE_MAX_HEIGHT_SELECTOR`): inline `style.maxHeight = 'none'` on every matched element — always runs.
- **`._646a522`** (`DYNAMIC_MAX_HEIGHT_SELECTOR`): inline `style.maxHeight` set to a dynamic value computed at that moment via the pure `computeDynamicMaxHeight(windowHeight, sourceHeightA, sourceHeightB)` = `windowHeight - sourceHeightA - sourceHeightB - MAX_HEIGHT_OFFSET_PX` (offset = 32px). Heights are read in real time: `window.innerHeight`, and `getBoundingClientRect().height` of the first `CHAT_HEADER_SELECTOR` (`div:has(> .the-header)`, `HEIGHT_SOURCE_SELECTOR_A`) and first `CONTENT_COLUMN_SELECTOR` (`.ds-virtual-list.ds-scroll-area > div:has(textarea[name="search"])`, `HEIGHT_SOURCE_SELECTOR_B`). **Missing-source rule**: if either source element is absent from the DOM, the `._646a522` adjustment is skipped entirely (left untouched) — the `.cc852ac5` removal still runs. Computed once; no resize listener. Overrides are not restored when editing ends.

### Scroll-into-position (`applyEditScrollPosition` + `computeScrollDelta` + `findScrollableAncestor`)

After the max-height adjustment and wrapper cleanup, the edit box is scrolled so it visually sits `EDIT_SCROLL_GAP_PX` (16px) below the fixed header `CHAT_HEADER_SELECTOR`. Because `.cc852ac5` lives inside a scrollable container while `CHAT_HEADER_SELECTOR` is fixed (different z-layers), the alignment is achieved purely by adjusting the container's `scrollTop` — not by repositioning the element. Run once inside a `requestAnimationFrame` (after `applyMaxHeightAdjustments` + `applyTextareaCleanup`) so the post-cleanup layout is measured.

- **`computeScrollDelta(editBoxTop, headerBottom, gap)`** (pure): returns `editBoxTop − (headerBottom + gap)` — the signed pixel amount to ADD to the scroller's `scrollTop` (positive scrolls down, negative scrolls up).
- **`findScrollableAncestor(el)`**: walks up from `el` (inclusive) and returns the nearest node whose `scrollHeight > clientHeight`, else `null`.
- **`applyEditScrollPosition(root)`** (root defaults to `document`, falls back to `document` when null): finds `.cc852ac5` (edit box) and `CHAT_HEADER_SELECTOR` (header), starts from `VIRTUAL_LIST_CONTAINER_SELECTOR` (`.ds-virtual-list.ds-scroll-area > .ds-virtual-list-items`) and resolves the real scroller via `findScrollableAncestor` (falling back to the list container itself when no scrollable ancestor exists), reads `getBoundingClientRect()` geometry in real time, then `scrollContainer.scrollTop += computeScrollDelta(top, bottom, EDIT_SCROLL_GAP_PX)`. **Guard rule**: if the edit box, header, or scroll container is missing, it is a no-op (no throw). One-time adjustment; no resize/scroll listener.

### Wrapper Extraction (`extractUserInput` + `applyTextareaCleanup`)

- **`extractUserInput(text)`**: Returns the inner content if `text` matches `/<user-input>\n([\s\S]*)\n<\/user-input>$/` (the same end-anchored regex shape as `injectPrefix` in `content/prompt-injector.controller.js`), else `null`. Non-string input → `null`. The `$` anchor means trailing content after `</user-input>` does not match.
- **`applyTextareaCleanup(textarea)`**: Calls `extractUserInput(textarea.value)`. On a match, rewrites the value to ONLY the inner content using `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` followed by `input`/`change` event dispatch (same React-aware write as `quote-reply.js` / `content/prompt-injector.controller.js`). When there is **no** `<user-input>` wrapper, the textarea is left completely untouched and no event is dispatched (explicit requirement — plain messages are never cleared).

### Test Interface

Exports via `module.exports` (Node-env guard): `extractUserInput`, `computeDynamicMaxHeight`, `applyMaxHeightAdjustments`, `computeScrollDelta`, `findScrollableAncestor`, `applyEditScrollPosition`, `applyTextareaCleanup`, `waitForNewTextarea`, `handleEditButtonClick`, plus constants `EDIT_BUTTON_SELECTOR`, `REMOVE_MAX_HEIGHT_SELECTOR`, `DYNAMIC_MAX_HEIGHT_SELECTOR`, `HEIGHT_SOURCE_SELECTOR_A`, `HEIGHT_SOURCE_SELECTOR_B`, `MAX_HEIGHT_OFFSET_PX`, `EDIT_SCROLL_GAP_PX`, `USER_INPUT_REGEX`, `DETECTION_TIMEOUT_MS`, `VALUE_WAIT_TIMEOUT_MS`.

## PreventAutoScroll Module

The PreventAutoScroll module uses a two-file architecture to suppress DeepSeek's automatic scroll-to-latest behavior. It is active in two distinct modes: **transient**, for the duration of a controlled operation like Markdown export or go-top, and **persistent** (v4.12.0), for as long as the user leaves the `dsPreventAutoScroll` setting on.

### Architecture

- **`content/prevent-auto-scroll.js`** (MAIN world): Executes in the page's JavaScript context. Monkey-patches `Element.prototype.scrollTo`, `Element.prototype.scrollBy`, `window.scrollTo`, `window.scrollBy`, the `scrollTop` setter on `Element.prototype`, and **`Element.prototype.scrollIntoView`** (unconditionally blocked while interception is active). Each patched method checks `_isBlockingActive()` before allowing or blocking the scroll. Interception is active when `bridge.dataset.enabled` is `'true'` and the user allow window is closed; while it is active, calls to scroll to the bottom of the conversation are suppressed. The allow window is open while `Date.now()` is below the number in `bridge.dataset.allowScrollUntil`; a missing or non-numeric value counts as closed.
- **`content/prevent-auto-scroll-bridge.js`** (ISOLATED world): Content script that manages injection and control. Injects the main-world script via a `<script>` element using `chrome.runtime.getURL('content/prevent-auto-scroll.js')`. Creates and manages a hidden `<div id="dss-prevent-auto-scroll-bridge" style="display:none">` in the document whose `dataset.enabled` and `dataset.allowScrollUntil` attributes are read by the main-world patch.

### Control Flow

- `enable()`: Sets `bridge.dataset.enabled = 'true'`. The main-world patch reads this and begins suppressing auto-scroll calls. Never touches persistent state, so it stays idempotent in either mode.
- `disable()`: Sets `bridge.dataset.enabled = 'false'` — **unless persistent mode is on, in which case it is a no-op** (v4.12.0).
- `isEnabled()`: Reads the current flag. **There is no reference counting** — outside persistent mode, `disable()` is an unconditional global off-switch. Any caller that may run nested inside another caller's enabled window MUST save the prior state via `isEnabled()` and restore it, rather than blind-toggling.
- `setPersistent(shouldPersist)` (v4.12.0): When true, enables protection and marks `bridge.dataset.persistent = 'true'`. When false, clears the mark and force-writes `dataset.enabled = 'false'` directly — deliberately bypassing `disable()`'s own persistent guard, which would otherwise make turning persistence off unable to ever release the protection.
- `isPersistent()` (v4.12.0): Reads the persistent flag. Persistent state lives on the same hidden bridge element's dataset as `enabled`, so the module keeps no module-scope mutable state.
- **User allow window** (v4.39.2): `start()` registers capture-phase `pointerdown` and `click` listeners on `document`. A press that has `isTrusted === true` and lands inside the site's native scroll-to-bottom control (`div._0706cde > div[role=button].ds-button--floating`, class `GO_TOP_NATIVE_BUTTON_CLASS` in `content/ds-selectors.js`) writes `Date.now() + 500` to `bridge.dataset.allowScrollUntil`, so the main-world patch lets every scroll through for the next 500 ms. The window covers the site's click handler, which calls `Element.scrollTo` and then about 5 re-measure calls within 25 ms. Programmatic `click()` and `dispatchEvent` presses are not trusted and open no window. The extension's own cloned back-to-top button carries `.dsw-gotop` and is excluded. The listener runs in the capture phase so the deadline is written before the site's own click handler scrolls.
- `start()` (v4.12.0): Auto-invoked at module load, mirroring `content/hide-thinking.js`'s bootstrap convention. Delegates master-switch and own-toggle gating to `registerFeatureToggle` from `content/feature-toggle.js` with `ownKey: StorageManager.KEYS.PREVENT_AUTO_SCROLL`, calling `setPersistent(true)` on enable and `setPersistent(false)` on disable. Settings are obtained from background via `DSS_GET_SETTINGS` and subsequent `DSS_SETTINGS_CHANGED` broadcasts. Persistent mode is on only when the master switch is enabled **and** this setting is true.

### Consumers

Three consumers coordinate with this bridge, and the first two nest:

- **`harvest.js`** enables it before the scroll-to-top phase and disables it in a `finally` after the entire top-to-bottom capture completes — so it stays on for the whole export. Note that `finally` block calls `disable()` **unconditionally**; combined with the absence of reference counting, that is precisely why `disable()` is a no-op under persistent mode. Without that guard, one Markdown export would silently switch off a user-enabled permanent lock.
- **`go-top.js`** (`scrollToTopAndWait`, in `go-top.scroll.js`) enables it for the duration of a single scroll-to-top and restores the prior state in `cleanup()`. Because `harvest.js` calls `scrollToTopAndWait` from inside its own enabled window, GoToTop uses save-and-restore: it disables only if it was the call that enabled. A blind `disable()` here would strip harvest's protection mid-export. Under persistent mode this logic short-circuits naturally — `isEnabled()` is already true, so GoToTop neither enables nor disables.
- **The `dsPreventAutoScroll` popup toggle** (v4.12.0) drives `setPersistent()` via `start()`'s settings subscription. The two transient consumers carry no persistent-mode logic: the persistent flag lives at the shared choke point, which is the only place a caller-agnostic mode switch can be correct given that callers do not refcount.

**Scope caveat.** The main-world patch is a global `Element.prototype`-level interception that blocks **downward** scrolls only and cannot tell page-initiated calls from user-initiated ones by themselves; the only user action it recognises is a trusted press on the native scroll-to-bottom control (see the user allow window above). Under persistent mode this means DeepSeek's streaming follow-scroll is also suppressed, and any conversation-switch that needs to scroll down to land correctly will be blocked too. Native wheel/trackpad scrolling does not route through these JS APIs and is unaffected. This trade-off is why the setting defaults to `false`.

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

A checkbox in the Features card (`#showSystemTimeToggle`) controls the setting. It is part of the master-switch-aware sub-controls: when `isEnabled` is turned off, the toggle is disabled.

### Content Script Integration

- `isShowSystemTime: false` — runtime state field in `content/chat-binding-controller.js`, initialized from storage via `applyInitialSettings()` during `initSettings()`.
- `formatSystemTime(date)` (defaults to the current time) — pure function in `content/content-script.export.time.js` returning `yyyy/mm/dd hh:mm:ss (UTC±hh:mm)` in 24-hour format with zero-padding and local timezone offset.
- `formatTimezoneOffset(date)` — pure helper in the same file returning the timezone offset string `UTC±hh:mm` (e.g., `UTC+08:00`, `UTC-03:45`).
- In `injectPrefix()` (`content/prompt-injector.controller.js`), the system time is prepended before the injection prefix:
  ```
  Current Time: 2026/05/31 14:30:00 (UTC+08:00)\n\n
  ```
  This string is inserted before the injection prefix (if any) and the `<user-input>` wrapper.

### Re-injection Guard

The timestamp is captured once at injection time (not at page load), so each message reflects the time when the user pressed send. If `isShowSystemTime` changes between messages (via popup toggle + the `DSS_SETTINGS_CHANGED` broadcast), the new value takes effect on the next send.

### Master Switch Awareness

When `isEnabled` is `false`, `injectPrefix()` returns `false` early — the system time is never prepended regardless of `isShowSystemTime`. The toggle in the popup is also disabled by `applyMasterSwitchUI()`.

## Auto Retry and Auto Continue (AutoRetry)

`content/auto-retry.js` drives both the retry button and the continue-generating button from a single `setTimeout` chain.

### Storage Keys

- `isAutoRetryEnabled` (boolean, default `false`) — `KEYS.AUTO_RETRY`, gates the retry button.
- `isAutoContinueEnabled` (boolean, default `false`) — `KEYS.AUTO_CONTINUE`, gates the continue button.

### Popup Toggles

The `#autoRetryToggle` and `#autoContinueToggle` checkboxes in the Features card write through `StorageManager.saveAutoRetry()` / `saveAutoContinue()`. Both are master-switch-aware sub-controls, and `popup/popup.live-sync.js` reflects storage changes to them live.

### Gating (registerFeatureToggle)

`start()` calls `registerFeatureToggle({ ownKey, onEnable, onDisable })` once per entry in `BUTTONS`, so each button's gate is open only when the master switch `isEnabled` and its own key are both on. `enable(name)` / `disable(name)` maintain the `_openGates` set; the module does not read storage directly.

### Round Loop

- At most one timer (`_timer`) exists at any time. When `_openGates` goes from empty to non-empty, `_scheduleRound()` schedules the next round with `DSSAutoClickDelay.nextDelayMs()` (`content/auto-click.delay.js`, a uniform random value of 0–3000ms in 100ms steps).
- `_runRound()` tries each open button's selectors in order and dispatches one bubbling `dss:react-click` custom event on the first match (the [React Click Bridge](#react-click-bridge) performs the actual click), then schedules the next round with a fresh random delay; there is no trigger cap. Each button is isolated in its own try/catch: a thrown error is logged, and the other buttons in the round and the next round still proceed.
- When `_openGates` becomes empty, `_stopTimer()` clears the timer, so no timer runs while every toggle is off.

### Button Location

Buttons are located only through the selectors in `content/ds-selectors.js`, never by button text; the continue button tries its fallback only when the primary selector finds nothing, and the retry button uses only its primary selector.

| Button | Primary | Fallback |
|-|-|-|
| Retry | `RETRY_BUTTON_SELECTOR` (`.ds-button--warning.ds-button--circle.ds-button--xs`) | — |
| Continue generating | `CONTINUE_BUTTON_SELECTOR` (`._8e85838 > .ds-button[role="button"]`) | `CONTINUE_BUTTON_FALLBACK_SELECTOR` (`._6eef0b0`) |

### React Click Bridge

The React `onClick` on DeepSeek's buttons acts only when `e.nativeEvent.isTrusted === true` and `e.nativeEvent instanceof Event`; `element.click()` from an isolated-world content script is an untrusted event and is ignored, and the isolated world cannot read the element's `__reactProps$*` expando. `content/react-click-bridge.main.js` therefore runs in the page's MAIN world:

- **Loading**: statically loaded by its own manifest `content_scripts` entry with `"world": "MAIN"` (unlike the web_accessible_resources scripts injected via `main-world-injector.js`), `matches: ["*://chat.deepseek.com/*"]`, `run_at: document_end`; the static MAIN-world declaration requires Chrome 111 (manifest `minimum_chrome_version`).
- **Listening**: a self-installing IIFE listens for `dss:react-click` on `document`; `auto-retry.js`, `auto-open-sidebar.js`, `auto-copy.js`, and this file each declare the event name (no shared loader across worlds).
- **Triggering**: reads `onClick` from the target element's own `__reactProps$*` and calls it with a minimal synthetic event: `nativeEvent` is `Object.create(Event.prototype, { isTrusted: { value: true } })` (passing the check above), plus `target` / `currentTarget` and no-op `preventDefault` / `stopPropagation`.
- **Fallback**: when the element has no React `onClick`, it calls `el.click()`.
- **Clipboard capture** (v4.39.0): this file wraps `navigator.clipboard.writeText`, registers a pending capture entry of about 1500 ms only for clicks whose `detail` is `'auto-copy'`, and dispatches `dss:auto-copy-captured` only when the site's write Promise rejects; the wrapper always returns the result of the original call (including a synchronous throw), so what the site sees does not change. The rules are in [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370).
- **Error handling**: the listener body is wrapped in try/catch and logs `console.error('[DSS] react-click-bridge:', err)` when the React `onClick` throws.
- **Double-evaluation guard**: the `window.__dssIsReactClickBridgeInstalled` flag is a defensive guard: if the script is evaluated twice in the same window, a single listener and a single wrapper layer remain, so one `dss:react-click` leads to one `onClick` call.

### Load Order

In the manifest, `content/auto-click.delay.js` loads before `content/auto-retry.js`; `start()` throws a named load-order error when `DSSFeatureToggle` or `DSSAutoClickDelay` is absent.

## Auto Open Sidebar (AutoOpenSidebar)

`content/auto-open-sidebar.js` (isolated world) clicks the "open sidebar" button on DeepSeek's collapsed rail once each time the sidebar collapses, keeping the sidebar open.

### Storage Key

- `isAutoOpenSidebarEnabled` (boolean, default `false`) — `KEYS.AUTO_OPEN_SIDEBAR`, written to sync and local by `StorageManager.saveAutoOpenSidebar(enabled)`; the `getSettings()` field is `autoOpenSidebar`, included in JSON export and import (restore) like `autoContinue`.

### Popup Toggle

The `#autoOpenSidebarToggle` checkbox in the UI Adjustments card (label `autoOpenSidebarLabel`) sits after `#autoExpandMessagesToggle` and before `#chatWidthToggle`, and writes through `StorageManager.saveAutoOpenSidebar()`. It is a master-switch-aware sub-control, and `popup/popup.live-sync.js` reflects storage changes to it live.

### Gating (registerFeatureToggle)

`start()` calls `registerFeatureToggle({ ownKey, onEnable, onDisable })` once with its own key `isAutoOpenSidebarEnabled`; `enable()` resets the episode state, registers a `window` `resize` listener, scans once, and then starts the observer; `disable()` disconnects the observer, removes the `resize` listener, and resets the episode state. The module does not read storage directly.

### Detection and Clicking

- **Collapsed episode**: The collapsed state is read from whether the sidebar wrapper (`SIDEBAR_WRAPPER_SELECTOR`, `div:has(> div > .ds-scroll-area > .ds-scroll-area)`) matches `SIDEBAR_WRAPPER_COLLAPSED_SELECTOR` from the Sidebar block of `content/ds-selectors.js` (the wrapper plus `:has(> div:nth-child(2))`, i.e. the collapse rail is present as a second direct child), checked with `wrapper.matches(...)`. An episode starts when the wrapper matches that selector and ends when it stops matching; `_scanExisting()` resets `_hasClickedThisEpisode` while not collapsed, and clicks at most once per episode.
- **Observer**: While active, a `MutationObserver` (`childList`, `subtree`, `attributes` with `attributeFilter: ['class']`) on `document.body` rescans the whole page on every mutation batch; the button's icon path can be inserted after the button node, and DeepSeek's width breakpoints re-collapse the sidebar by rewriting only the wrapper's `class`, so checking only added nodes is not enough. Errors thrown by a scan are logged with `console.error('[DSS] auto-open-sidebar:', err)`.
- **Clicking**: When the current episode has not been clicked yet, it dispatches the bubbling `dss:react-click` custom event on the button matched by `DSstudio.Selectors.SIDEBAR_OPEN_BUTTON_SELECTOR`; the [React Click Bridge](#react-click-bridge) calls the button's React `onClick` (falling back to `element.click()` when there is no React `onClick`).
- **No click in the narrow layout** (v4.36.3): Each scan first looks up DeepSeek's header hamburger button with `SIDEBAR_HAMBURGER_BUTTON_SELECTOR` (`div.ds-button--xl[role="button"]:has(path[d^="M17.2027"])`) from the Sidebar block of `content/ds-selectors.js`. The hamburger is mounted in both the desktop and narrow layouts, but its `checkVisibility()` is true only in the narrow layout (about 768px and below); the collapsed rail's open button is rendered and visible (34×34) in both layouts, so its own visibility cannot tell the layouts apart. When the hamburger exists and `typeof checkVisibility === 'function' && checkVisibility()` is true, the click is skipped without consuming the episode (neither `_hasClickedThisEpisode` nor `_lastClickAt` changes), so the button is clicked once the hamburger becomes hidden within the same episode; a hamburger lacking the `checkVisibility` method does not block the click. In the narrow layout DeepSeek re-closes the sidebar by itself about 0.5–1.2 s after any open, which is why auto-open does not click there.
- **Loop breaker**: If a new collapsed episode begins less than 1500ms after the previous click (`RECOLLAPSE_LOOP_WINDOW_MS`) with no `window` `resize` event in between, it sets `_isSuppressedUntilResize` and stops clicking; the next `resize` lifts the suppression and clears the last click time. This prevents an open-collapse loop with DeepSeek re-collapsing immediately at narrow widths.
- **Behaviour**: A manual collapse by the user also starts a new episode and is clicked again, so enabling the feature effectively keeps the sidebar open. At narrow widths DeepSeek reuses the same rail button node across collapse, open, and re-collapse and only rewrites the wrapper's `className`, so whether a click already happened is tracked per episode rather than per DOM node.

### Button Location

`SIDEBAR_OPEN_BUTTON_SELECTOR` in the Sidebar block of `content/ds-selectors.js`:

```
div.ds-button--iconLabelPrimary.ds-button--m[role="button"]:has(path[d^="M9.67272"])
```

- **Why the icon path**: The button sits in DeepSeek's collapsed rail (`SIDEBAR_NATIVE_COLLAPSED_SELECTOR`, wrapper `> div:not(:has(.ds-scroll-area))`) next to the search and new-chat buttons, and all three share the identical class string, so only the icon path distinguishes the open-sidebar button.
- **Excluded variants**: The expanded-state sidebar toggle uses `ds-button--iconLabelTertiary`, and the mobile hamburger button uses `ds-button--xl` with a different icon path, so neither matches this selector.

### Load Order

In the manifest, `content/auto-open-sidebar.js` loads right after `content/auto-expand-messages.js`, after `content/ds-selectors.js` and `content/feature-toggle.js`; `start()` logs a `console.warn` and skips registration when `DSSFeatureToggle` is absent.

## Auto Copy (AutoCopy)

The behavior rules for auto copy are in [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370), and the storage keys are in [STORAGE.md](STORAGE.md); this section covers the split between the two modules and their implementation details.

### Module Split

- **`content/reply-completion.js`** (`DSstudio.ReplyCompletion`): a pure-decision module that never modifies the DOM. `newToolbarsFromRecords(records)` returns the message toolbars newly appeared in the batch, in document order and without duplicates; `isStoppedReply(toolbar)` checks the scope `toolbar.parentElement`. The completion rules and implementation constraints are in [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370).
- **`content/auto-copy.js`** (`DSstudio.AutoCopy`): holds the two gates `_isReplyOn` and `_isCodeOn` and the observer, and finds the target buttons and dispatches the events.
- **`content/auto-copy.relay.js`** (`DSSAutoCopyRelay`, v4.39.0): the isolated-world relay module; `notePending()` records a pending relay entry, and `start()` registers the single `dss:auto-copy-captured` listener and sends `DSS_COPY_TO_CLIPBOARD`; it never calls the clipboard API itself.
- **`background/clipboard-routes.js`** (`DSSClipboardRoutes`, v4.39.0): receives `DSS_COPY_TO_CLIPBOARD` and delegates the write to the offscreen document; the message route is described in [ARCHITECTURE.md](../ARCHITECTURE.md#clipboard-write-message-route-clipboard-write-v4390).
- **`offscreen/clipboard-offscreen.js`** (`DSSClipboardOffscreen`, v4.39.0): writes with `document.execCommand('copy')` inside the offscreen document and replies `{ ok }`.
- **`utils/clipboard-permission.js`** (`DSSClipboardPermission`, v4.39.0): the permission check and request wrapper for `clipboardWrite` and `offscreen`, used by the popup and, for the check, by `background/permission-intent-routes.js`; the toggle flow is in [POPUP.md](POPUP.md) and [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370).

### Gating (registerFeatureToggle)

`start()` registers the two gates, and `onEnable` / `onDisable` set the matching gate and sync the observer. The conditions that activate each gate are in [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370), and the key names are defined in `utils/storage-manager.keys.js`.

### Observing and Triggering

- **Observer**: `content/auto-copy.js` roots the observer at `body` because a new-chat page has no message list yet and switching chats may remount the whole list; the "newly appeared" decision is already restricted to virtual-list items by `ReplyCompletion`. Attach and detach conditions are in [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370).
- **Batch Handling**: Each batch goes to `newToolbarsFromRecords` first, then toolbars for which `isStoppedReply` is true are skipped. The reply button is located by `ROLE_BUTTON_DIV_SELECTOR`, and code block buttons by `.md-code-block-banner` inside the `VIRTUAL_ITEM_KEY_SELECTOR` item that owns the toolbar; the selection rules and order are in [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370).
- **Clicking**: The dispatch mechanism is in [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370), and the bridge that handles it, together with the capture for the unfocused fallback write, is described in [React Click Bridge](#react-click-bridge).
- **Error Handling**: The `MutationObserver` callback is wrapped in try/catch; an error thrown while handling is logged as `console.error('[DSS] auto-copy:處理新工具列失敗:', error)` and observation continues.

### Load Order

`start()` throws a named load-order error when `DSSFeatureToggle`, `DSstudio.ReplyCompletion`, or `KEYS` is absent; the manifest position is in [Feature Spec §26](../spec/04-features.md#26-auto-copy-reply-and-code-blocks-auto-copy-v4370). `start()` in `content/auto-copy.relay.js` (v4.39.0) throws a named load-order error when `DSS_COPY_TO_CLIPBOARD` is absent; when the relay module is not loaded, `content/auto-copy.js` skips the registration, and copying while the tab is focused is unaffected.
## Reply-Complete Notification (ReplyNotification)

The behavior rules for the reply-complete notification are in [Feature Spec §27](../spec/04-features.md#27-reply-complete-notification-reply-notification-v4380), and the storage keys are in [STORAGE.md](STORAGE.md); this section covers the split between the content script, the background route, and the popup permission wrapper, and their implementation details.

### Module Split

- **`content/reply-notification.js`** (`DSstudio.ReplyNotification`): holds the gate `_isOn` and the observer, borrows `DSstudio.ReplyCompletion` (see [Auto Copy](#auto-copy-autocopy)) to decide which toolbars are newly completed replies, and sends a message when the tab is not in the foreground; it never calls `chrome.notifications` directly.
- **`background/notification-routes.js`** (`DSSNotificationRoutes`): receives `DSS_SHOW_NOTIFICATION` and shows the notification; the message route is described in [ARCHITECTURE.md](../ARCHITECTURE.md#reply-notification-message-route-reply-notification-v4380).
- **`utils/notification-permission.js`** (`DSSNotificationPermission`): the permission check and request wrapper, used by the popup and, for the check, by `background/permission-intent-routes.js`; the toggle flow is in [POPUP.md](POPUP.md) and [Feature Spec §27](../spec/04-features.md#27-reply-complete-notification-reply-notification-v4380).

### Gating (registerFeatureToggle)

`start()` registers a single gate, and `onEnable` / `onDisable` set `_isOn` and sync the observer. The activation conditions are in [Feature Spec §27](../spec/04-features.md#27-reply-complete-notification-reply-notification-v4380), and the key name is defined in `utils/storage-manager.keys.js`.

### Observing and Notifying

- **Observer**: `content/reply-notification.js` roots the observer at `body` for the same reason as the observer in [Auto Copy](#auto-copy-autocopy). Attach and detach conditions are in [Feature Spec §27](../spec/04-features.md#27-reply-complete-notification-reply-notification-v4380).
- **Batch Handling**: Each batch goes to `newToolbarsFromRecords` first, then toolbars for which `isStoppedReply` is true are skipped, and the remaining count is the number of newly completed replies in the batch; the foreground check runs while the batch is handled. The notification rule is in [Feature Spec §27](../spec/04-features.md#27-reply-complete-notification-reply-notification-v4380).
- **Message Content**: `title` and `body` are read at send time, so they follow the current locale; the i18n keys and copy are in [Feature Spec §27](../spec/04-features.md#27-reply-complete-notification-reply-notification-v4380).
- **Error Handling**: On failure, `chrome.runtime.sendMessage` logs `console.error('[DSS] reply-notification:送出通知訊息失敗:', error)`; the handling path is in [Feature Spec §27](../spec/04-features.md#27-reply-complete-notification-reply-notification-v4380). The `MutationObserver` callback is wrapped in try/catch, and an error thrown while handling is logged as `console.error('[DSS] reply-notification:處理新工具列失敗:', error)` and observation continues.

### Load Order

`start()` throws a named load-order error when `DSSFeatureToggle`, `DSstudio.ReplyCompletion`, or `KEYS` is absent; the manifest position is in [Feature Spec §27](../spec/04-features.md#27-reply-complete-notification-reply-notification-v4380).
