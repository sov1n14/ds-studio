# UI Adjustment Feature Specifications

> 📂 [DS studio Documentation](../../) (Chinese) › [Feature Specifications](../../SPEC.md) (Chinese) › UI Adjustments
>
> **Related Architecture**: [Content Scripts](../../architecture/CONTENT_SCRIPTS.md) (Chinese)

## 9. Sidebar Auto-Hide

- **Toggle**: A checkbox in the popup menu's "UI Adjustments" card to enable/disable this feature.
- **Storage Key**: `dsSidebarAutoHide` (boolean, default `false`).
- **Collapse Behavior**: When enabled, the sidebar (`div.dc04ec1d`) collapses to 60px width when the mouse leaves. Inner content (`div.b8812f16.a2f3d50e`) is offset via a negative `margin-left`, hidden behind the collapsed container.
- **Expand Behavior**: On mouse hover, after a 150ms delay (enter delay), the sidebar expands to its originally stored width, and the inner padding is cleared.
- **Collapse Trigger**: On mouse leave, after a 400ms delay (leave delay), the sidebar collapses back to 60px. Window resize also triggers re-collapse via a debounced (200ms) resize handler.
- **Dropdown Awareness**: When the sidebar has a pending collapse timer and the mouse enters a floating/dropdown element (detected via the class `ds-elevated` or `.ds-floating-position-wrapper`), the collapse timer is cancelled and the sidebar stays expanded. A `mouseleave` listener on the floating element triggers collapse when the user moves away. This is implemented via a capture-phase `mouseover` listener on `document` (in `setupHoverZone()`), using `el.closest()` for precise descendant-level matching, making it robust against React portals rendered outside the sidebar's DOM hierarchy.
- **CSS Transitions**: Smooth animations via injected `<style>`: `transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1)` and `transition: margin-left 0.22s cubic-bezier(0.4, 0, 0.2, 1)`.
- **Overflow Handling**: The container has `overflow: hidden`, except when DeepSeek's native collapse is active (the narrow strip must remain fully visible).
- **Master Switch Awareness**: When the master switch (`isEnabled`) is off, the module is disabled regardless of its own toggle state. When re-enabled, the module re-reads its own toggle state.
- **SPA Resilience**:
  - A `MutationObserver` on `document.body` detects whether the sidebar DOM node has been replaced (SPA navigation), rebinding events and re-collapsing.
  - A sidebar-specific `MutationObserver` monitors DeepSeek's native collapse/expand cycle, reapplying the custom collapse state when needed.
- **Storage Listener**: Registers a `chrome.storage.onChanged` listener to monitor changes to `dsSidebarAutoHide` and `isEnabled` in real time, enabling/disabling without a page refresh.
- **Startup**: Reads `dsSidebarAutoHide` and `isEnabled` from storage; enables if both are true.

## 10. Conversation Area Width Adjustment

- **Toggle and Slider**: A toggle switch and range slider in the popup menu's "UI Adjustments" card control this feature.
- **Storage Keys**: `dsChatWidth` (number, 30–100, default `70`) and `dsChatWidthEnabled` (boolean, default `false`).
- **Range**: 30% to 100% viewport width, clamped via `Math.min(Math.max(...))`.
- **CSS Injection**: Injects a `<style>` element that sets:
  - `max-width: Xvw !important` targeting `.ds-virtual-list-items._6f2c522` (message list), via the `--message-list-max-width` custom property
  - `margin-left: auto !important; margin-right: auto !important; padding-left: 0 !important; padding-right: 0 !important` targeting `._871cbca` (centering)
- **Master Switch Awareness**: Disabled when the master switch (`isEnabled`) is off; re-reads its own toggle when re-enabled.
- **SPA Resilience**: A `MutationObserver` on `._765a5cd` (or `document.body` as fallback) re-injects CSS after DOM changes, debounced at 200ms.
- **Storage Listener**: Monitors changes to `dsChatWidth`, `dsChatWidthEnabled`, and `isEnabled`, applying or removing styles in real time.

## 11. Input Box Width Adjustment

- **Toggle and Slider**: A separate toggle switch and range slider in the popup menu's "UI Adjustments" card.
- **Storage Keys**: `dsInputWidth` (number, 30–100, default `70`) and `dsInputWidthEnabled` (boolean, default `false`).
- **Range**: 30% to 100% viewport width, independent of conversation area width.
- **CSS Injection**: Injects a `<style>` element that sets `max-width: Xvw !important` and `width: min(100%, Xvw) !important` targeting `._871cbca`, `._871cbca .aaff8b8f`, `.aaff8b8f` (separate selectors for the new-conversation page), and `._871cbca ._77cefa5._3d616d3` (input area container and text input area), with `margin-left: auto` and `margin-right: auto` for centering.
- **Conversation Area Width Clamping**: When conversation area width adjustment is enabled, the effective input box width is clamped to the conversation area width (`getEffectivePercent()`). If the conversation area width is 70% and the input box width is set to 100%, the actual applied width is 70%. This ensures the input box never exceeds the conversation container width. The module also monitors changes to `dsChatWidth` and `dsChatWidthEnabled` for real-time re-clamping.
- **Master Switch Awareness**: Same pattern as conversation area width.
- **SPA Resilience**: Same `MutationObserver` pattern, 200ms debounce, monitoring `class` attribute changes on `._765a5cd`.
- **Independence**: Conversation area width and input box width operate independently — different storage keys, toggles, sliders, and CSS targets.

## 16. Auto Expand Messages — v4.32.0

- **Toggle Location**: The `#autoExpandMessagesToggle` checkbox in the popup menu's "Features" card.
- **Storage Key**: `dsAutoExpandMessages` (boolean, default `false`).
- **Behavior**: When enabled, automatically clicks collapsed "expand" buttons on the page so all messages are expanded by default. Collapsed state is determined by whether the expand button icon has a `transform` style containing `rotate(180deg)`.
- **Duplicate Click Prevention**: Processed buttons are marked with `data-dss-auto-expanded="1"` to prevent repeated clicks.
- **Enable Behavior**: When `enable()` is called, `_scanExisting()` first scans all existing expand buttons on the page and processes them one by one, then starts a `MutationObserver` to listen for subsequently added nodes.
- **Disable Behavior**: When `disable()` is called, it first performs a one-time scan of all expand button containers on the page, clicking each expanded button to collapse it, then removes all `data-dss-auto-expanded` attributes, and finally disconnects the `MutationObserver`.
- **Safety Guard**: Checks `isConnected` before clicking an expand button, preventing invalid clicks on removed nodes.
- **MutationObserver Strategy**: Observes `document.body` with `childList: true, subtree: true`, checking each added node for whether it is an expand button container (`.EXPAND_BUTTON_CONTAINER_CLASS`) or contains an expand button container among its descendants.
- **Selectors**: The expand button container class and icon class are defined in `content/ds-selectors.js` (`EXPAND_BUTTON_CONTAINER_CLASS`, `EXPAND_BUTTON_ICON_CLASS`).
- **Master Switch Awareness**: Through the `registerFeatureToggle` mechanism in `content/feature-toggle.js`, both the master switch and own-toggle gating are provided uniformly via background message routing, without directly reading `chrome.storage`.
- **Implementation Location**: `content/auto-expand-messages.js`. `start()` is called automatically on module load.

## 17. Hide Thinking Process

- **Toggle Location**: The `#hideThinkingToggle` checkbox in the popup menu's "Features" card, used to enable/disable this feature (moved from the "UI Adjustments" card in v4.32.0).
- **Storage Key**: `dsHideThinking` (boolean, default `false`).
- **Observer Configuration**: A `MutationObserver` set with `{ childList: true, subtree: true }` attached to `document.body`, observing only DOM node additions. Does not observe `attributes`, so when a user manually expands a thinking block (modifying its CSS class), the callback is not triggered, ensuring expanded blocks remain unaffected.
- **Two-Layer Search**: The callback first searches for the thinking block container (`._74c0879`) on the added nodes themselves; if not found, it then searches each added node's descendants — handling both cases where the container is a direct added node or deeply nested.
- **Safety Guard**: Before clicking the expand button, a dual check of `isConnected` and CSS class is performed, preventing invalid clicks on removed nodes (`isConnected === false`) or already-collapsed buttons (missing the expanded class).
- **Enable Behavior**: When `enable()` is called, `applyToExisting()` first collapses all existing expanded thinking blocks on the page, then starts the MutationObserver to listen for subsequently added nodes.
- **Disable Behavior**: When `disable()` is called, the MutationObserver is disconnected, and all thinking blocks previously collapsed by this feature (identified by the `data-ht-collapsed` marker) are automatically expanded, restoring the page to its pre-feature-enabled expanded state.
- **Instant Toggle**: The `chrome.storage.onChanged` listener monitors both `dsHideThinking` and `isEnabled`, enabling the feature to be toggled on/off instantly without a page refresh.
- **Master Switch Awareness**: When the master switch (`isEnabled`) is off, the module is disabled regardless of its own toggle state. When re-enabled, the module re-reads the `dsHideThinking` state.
- **Known Limitation**: DeepSeek uses virtual list rendering, where DOM nodes unmounted during scrolling are treated as "added nodes" when remounted, so scrolling back to that area may cause the thinking block to be auto-collapsed again.

## 18. Back to Top Button (GoToTop)

- **Purpose**: Provides a "Back to Top" floating button on the DeepSeek conversation page, mimicking the appearance and position of the native "Back to Bottom" (Go Down) button; clicking it automatically scrolls the conversation to the very top. This feature is **permanently enabled** with no independent toggle and is controlled entirely by the extension's master switch.
- **Appearance Specification**: The GoToTop button must be pixel-identical in appearance to the native Go Down button (34×34 circle, border, background, shadow, hover effect). The implementation uses a clone-first strategy — when the native button exists, it is duplicated via `cloneNode(true)` with the positioning hash class `_0706cde` removed; when the native button does not exist, an identical markup is rebuilt from a hardcoded template (containing `__background` / `__border` / `__icon` sublayers with inline CSS variables). The arrow is flipped using `transform: scaleY(-1)` on the native downward arrow, with `fill="currentColor"` inheriting the theme color. The site hash class `_0706cde` is not carried to prevent the site's own JS from mistakenly targeting it.
- **Injection Gating**: The button is only injected when the "input area wrapper container `.aaff8b8f` or native button `._0706cde` is ready"; `_tryConnectDom()` retries every 500ms, up to 120 times (~60 seconds). If still not ready after timeout, injection is abandoned and **no button is displayed at all** (no `position: fixed` fallback overlay). This design fixes the race condition where opening an existing conversation before the input area had rendered caused the button to be erroneously mounted on the first `.ds-theme` notification overlay.
- **Positioning Strategy**: Two modes automatically switch based on the availability of the native button and wrapper container; position automatically follows layout and window changes:
  - **Stacked Mode** (native button exists): Absolutely positioned within the `.aaff8b8f` container, 8px above the native button (margin-bottom = native margin-bottom + native height + 8px; default 62px).
  - **Solo Mode** (native button absent but container exists): Occupies the native button's standard position (`position: absolute; bottom: 100%; right: 12px; margin-bottom: 20px`).
  - When neither exists, `_injectButton()` creates no button and returns `false`.
- **Show/Hide Logic**: Uses hysteresis design to prevent boundary flickering — shown when the first message's bottom leaves the viewport top (`getBoundingClientRect().bottom < 0`); hidden when verifiably at the top (`scrollTop <= 1` or `[data-virtual-list-item-key="1"]` fully visible); intermediate states maintain the current display state.
- **Native Button Detection**: Primary selector `._0706cde:not(.dsw-gotop)`; structural fallback chain (scoped to `.aaff8b8f`) all require `ds-button--floating`, and perform post-validation on non-`_0706cde` source matches before returning, excluding `ds-button--primary` / `ds-button--filled` / `ds-button--disabled` buttons to prevent mismatching other circular buttons in the same container.
- **SPA Resilience**: A wrapper observer monitors the outer container (`._871cbca`), detecting React re-renders and automatically re-injecting or switching modes. Mode transitions (solo ↔ stacked) reuse the same element (no recreation) to avoid flickering.
- **Route Changes**: When switching conversations, any in-progress scroll is aborted, state is reset, and the old button is removed. After the DOM stabilizes, `_tryConnectDom()` gated retry loop re-injects — continuously retrying until the input area wrapper container or native button is ready (every 500ms × up to 120 times), replacing the old one-shot no-retry injection and fundamentally eliminating the race condition where the button wouldn't appear during SPA route changes due to the DOM not being ready. The timer handle for waiting for DOM stabilization is stored in `_routeChangeTimer` and can be cancelled by `disable()`.
- **Disable Behavior**: Calling `disable()` must leave no residual artifacts still acting on the page — stops three observers (DOM, route, wrapper), removes scroll listeners and the button, clears three timers (`_observerTimer`, `_enableRetryTimer`, `_routeChangeTimer`), and **calls** `_scrollReject` to abort any in-progress scroll (merely setting it to null would not stop the scroll loop). The `if (!this.enabled) return;` guard at the `_tryConnectDom()` entry point is a second line of defense, ensuring that any leaked delayed callbacks do not re-inject the button or restart observers after disable — a wrapper observer created after disable would never be torn down, and its auto-restore logic would make the button impossible to remove until the user refreshes the page.
- **Scroll to Top (Clickable Abort)**: `scrollToTopAndWait()` provides a public API (for Markdown export integration). Each polling round directly writes `scrollContainer.scrollTop = 0` to jump to top in one shot, paired with a MutationObserver waiting for lazily loaded old messages to mount — if the virtual list grows as a result, the convergence counter resets and it jumps again, with a maximum 30-second timeout. Arrival time depends solely on the number of lazy-loading rounds, not on conversation length.
  - **Jump to top in one shot going up, step-by-step going down, is intentionally asymmetric**: The `harvest.js` downward capture loop advances only `0.9 * viewportHeight` per step because it must render and capture every message along the way — content skipped by the virtual list is content lost from the export; `scrollToTopAndWait()` has no such obligation — it only needs to arrive, ignoring everything along the way. Do not unify the two for "consistency." During scrolling, the button **remains clickable at all times** (`aria-disabled` is always `"false"`, no longer disabled during scrolling); if clicked again while scrolling is in progress, the current scroll is aborted at the current position with `reason: 'stopped-by-user'` and **does not restart** (toggle-style); clicking again starts a new scroll.
- **Keyboard and Accessibility**: `<div role="button" tabindex="0">`, supporting Enter / Space keyboard activation; `aria-label="Back to Top"`; `aria-disabled` remains `"false"` at all times.
- **Implementation Location**: `content/go-top.js` (entry point), `content/go-top.locate.js` (positioning/visibility), `content/go-top.render.js` (rendering/injection/mode switching), `content/go-top.scroll.js` (scroll engine), `content/go-top.css`; public API mounted at `window.DSstudio.GoToTop`.

## 19. Mobile Sidebar Swipe Gesture

- **Purpose**: On mobile devices, allows users to swipe horizontally within the central 80% of the screen to open or close the sidebar (right-swipe opens, left-swipe closes), solving the lack of a quick sidebar toggle mechanism on mobile.
- **Mobile Only**: Determined via `_isMobileDevice()` — `navigator.maxTouchPoints > 0` (physical touch device) or User-Agent matching `/Mobi|Android|iPhone|iPad/i` (Chrome DevTools mobile emulation). Desktop environments have zero overhead, with no event listeners bound.
- **Trigger Area Geometry**: The touch start point must fall within the central 80% × 80% area of the screen (10% margin excluded from each side horizontally and vertically). This design avoids conflicts with Chrome Android's system back gesture (triggered from screen edges) and accidental touches from the top status bar / bottom navigation bar:
  - `minX = innerWidth * 0.10`, `maxX = innerWidth * 0.90`
  - `minY = innerHeight * 0.10`, `maxY = innerHeight * 0.90`
- **Gesture Recognition Conditions** (all five must be met to trigger):
  | Condition | Threshold | Description |
  |-|-|-|
  | a. Minimum swipe distance | `|deltaX| ≥ 50px` (`SWIPE_THRESHOLD_PX`) | Excludes minor jitter |
  | b. Horizontal dominance | `|deltaX| > |deltaY| × 1.5` | Excludes vertical-scroll-like swipes |
  | c. Duration | `< 500ms` (`SWIPE_MAX_DURATION_MS`) | Excludes slow drags |
  | d. Horizontal start position | `clientX ∈ [10%, 90%] innerWidth` | Excludes screen edges |
  | e. Vertical start position | `clientY ∈ [10%, 90%] innerHeight` | Excludes top/bottom edges |
- **Direction Detection**: After threshold check, `deltaX > 0` (right-swipe) triggers the open-sidebar button; `deltaX < 0` (left-swipe) triggers the close-sidebar button.
- **Open Button Selector**: Primary selector `div.ds-button--capsule.ds-button--iconLabelPrimary[role="button"]`; fallback path includes 5 alternative class combinations.
- **Close Button Selector**: Primary selector `div.ds-button--capsule.ds-button--iconLabelTertiary[role="button"]`; fallback path includes 3 alternative class combinations.
- **DOM Polling**: `_tryConnectDom()` polls for the target button every 500ms, up to 60 times (~30 seconds), silently giving up on timeout (no error thrown).
- **Master Switch Integration**: Follows the extension's master switch (`isEnabled`) entirely. Monitors `isEnabled` changes via `chrome.storage.onChanged` for instant enable/disable, with no individual feature toggle.
- **Lifecycle Methods**:
  - `start()`: Checks for mobile device, reads master switch state, sets up storage listener, enables if conditions are met.
  - `enable()`: Starts DOM polling.
  - `disable()`: Removes touch event listeners, clears polling timer, resets gesture state.
  - `destroy()`: Delegates to `disable()`.
- **Implementation Location**: `content/mobile-sidebar-swipe.js`; public API mounted at `window.DSstudio.MobileSidebarSwipe`.

## 20. Mobile Homepage Cleanup — v4.1.0

- **Purpose**: Automatically cleans up DOM elements on the mobile DeepSeek homepage to optimize the mobile device experience.
- **Implementation Location**: `content/mobile-homepage-cleanup.js`.
- **Functionality**: Automatically removes/hides DOM elements matching specific class selectors (`._9579690`).
- **Master Switch Linkage**: Follows the extension's master switch (`isEnabled`) entirely, with no independent toggle.
- **SPA Resilience**: Monitors DOM changes via MutationObserver, reapplying cleanup logic after SPA navigation.

## 21. Prevent Auto-Scroll — v4.12.0

- **Purpose**: Allows the anti-scroll-back protection that previously only took effect briefly during "Back to Top" and Markdown export to be set as **persistent** by the user. This toggle adds no new interception mechanism; it only changes the active duration of the existing `PreventAutoScroll` patch.
- **Toggle Location**: The `#preventAutoScrollToggle` checkbox in the popup menu's "Features" card (moved from the "UI Adjustments" card in v4.32.0).
- **Storage Key**: `dsPreventAutoScroll` (boolean, default `false`).
- **Persistent State Storage**: Coexists with the existing `enabled` flag on the `dataset` of the same hidden bridge element (`#dss-prevent-auto-scroll-bridge`), without using module-level mutable state.
- **`disable()` is a No-Op in Persistent Mode**: This guard is necessary, not defensive redundancy. The flag **has no reference counting**, and `harvest.js` **unconditionally** calls `disable()` in its `finally` block; without the guard, once the user enables persistence, a single Markdown export would silently turn off the protection when the export finishes. `setPersistent(false)` intentionally bypasses this guard and writes directly to `dataset`, otherwise disabling persistence would never be able to lift the protection.
- **Zero Changes to Call Sites**: The persistence logic is fully contained within the shared throttle point `content/prevent-auto-scroll-bridge.js`. The two existing call sites, `harvest.js` and `go-top.scroll.js`, require no modification — go-top's existing `wasAlreadyEnabled` save-and-restore logic naturally short-circuits in persistent mode (`isEnabled()` is always true, so it neither enables nor disables).
- **Instant Toggle**: The `chrome.storage.onChanged` listener monitors both `dsPreventAutoScroll` and `isEnabled` (only the `local` namespace), taking effect instantly without a page refresh. Any change to either key triggers a re-read from storage and recalculation, without caching partial state.
- **Master Switch Awareness**: Persistence is active only when the master switch (`isEnabled`) is true **and** `dsPreventAutoScroll` is true. When the master switch is off, persistence is always lifted, even if the own toggle is on. A missing master switch key is treated as off.
- **Known Trade-offs (Intentionally Accepted, Hence Off by Default)**: The existing MAIN-world patch is a **global** intercept at the `Element.prototype` level that only blocks **downward** scrolling and **cannot distinguish** between programmatic and user-triggered scrolling (no `isTrusted` / call stack determination). Therefore, when persistence is on:
  - DeepSeek's streaming reply "auto-follow to latest" is also blocked, requiring manual downward scrolling.
  - When switching to or opening a conversation that requires downward positioning to land at the correct position, that positioning is also blocked; upward positioning is unaffected.
  - Native mouse wheel / trackpad / scrollbar dragging does not go through these JS APIs and is unaffected; however, any "scroll to bottom" button on the page that uses these JS APIs will be blocked.
- **Implementation Location**: `content/prevent-auto-scroll-bridge.js` (added `setPersistent()` / `isPersistent()` / `start()`, `disable()` with guard added); public API mounted at `window.DSstudio.PreventAutoScroll`. `start()` is called automatically on module load, following the startup convention of `content/hide-thinking.js`.

## 22. Web Search — v4.13.0 (v4.17.0 changed to one-time entry default; v4.17.1 setting changes sync instantly)

- **Purpose**: Allows the user to specify the **starting state** of DeepSeek's "Smart Search" toggle button — `On` (starting at `aria-pressed="true"`) or `Off` (starting at `"false"`). This setting adds no page elements; it simply corrects the existing button once per activation event.
- **Semantics (v4.17.0 Change, v4.17.1 Extension)**: This setting is a **default value, not a forced state**. After applying once per activation event, it completely releases control; any subsequent manual clicks on the button by the user are preserved — the extension does not click it back until the next activation event.
- **Activation Events (v4.17.1 Added B, C)**: Three types of events each trigger one application and re-arm the one-shot flag — (A) content script `start()` with the master switch on; (B) `chrome.storage.onChanged` in the `local` namespace bringing a new `dsWebSearchToggle` value with the master switch on; (C) master switch turning from off to on. This is the defect fixed in v4.17.1: v4.17.0 only had (A), and once `_isSpent` was used up it never reset, so when the user changed the setting in the popup, already-open pages showed no response and required a page refresh.
- **Toggle Location**: A radio button group in the popup menu's "Features" card (moved from the "UI Adjustments" card in v4.32.0) (`input[name="websearchToggle"]`, two options `On` / `Off`, each wrapped in a `.segmented-option`; the circular radio appearance is provided by the shared rule `:is(.locale-option, .segmented-option) input[type="radio"]` in `popup.css`, sharing the same style as the language switch panel). `On` is the pre-checked option in the markup.
- **Storage Key**: `dsWebSearchToggle` (string, `'on'` | `'off'`, default `'on'`). The old three-state `'default'` value has been removed; reading a residual `'default'` value is always treated as `'on'` without writing back to storage.
- **Core Rule — Click Only on State Mismatch**: When `aria-pressed` already equals the target state, never click, because clicking is a toggle operation — clicking when already matching would toggle the state away. State determination: `getAttribute('aria-pressed') === 'true'`. The target state is derived from the public `mode` property (`'on'` maps to `true`).
- **One-Shot Mechanism**: The internal `_isSpent` flag marks whether the current activation event's application has been consumed. After finding the button and comparing (regardless of whether a click is needed), the flag is set to consumed and the observer is stopped. Once consumed, user manual toggles and page re-renders mounting new buttons no longer trigger clicks; only a new activation event resets the flag via `_rearm()`, applies once more, then releases control again.
- **`_rearm()` Order Must Not Be Swapped**: `_rearm()` executes in order: `disable()`, reset `_isSpent`, `_recompute()`. The `disable()` guard is `if (!this.enabled) return;`, so `enabled` must never be set to `false` before calling it — that would cause the guard to return early, leaving the `MutationObserver` attached to `document.body` as a leak. Similarly, resetting `_isSpent` alone is insufficient: the `enable()` guard is `if (this.enabled) return;`, and since `enabled` is still true from the previous application, it would return early without reapplying.
- **Element Identification (Language-Independent, Hash-Independent)**: The live page has **two visually identical** `.ds-toggle-button[aria-pressed]` elements (Deep Thinking and Smart Search), and `document.querySelector` consistently returns the first one (wrong). `findButton()` uses a two-tier identification strategy: **Tier 1**: Combines `.ds-toggle-button[aria-pressed]` (`TOGGLE_BUTTON_SELECTOR`) and `[aria-pressed="true"], [aria-pressed="false"]` (`TOGGLE_BUTTON_FALLBACK_SELECTOR`) as two candidate sets (deduplicated), using `_pickByIcon()` to match each candidate's inner `<path d="...">` `d` attribute against whether it starts with `SEARCH_ICON_PATH_PREFIX` (`'M7.9995999336'`, defined in `content/ds-selectors.js`) — the search icon's SVG path data prefix is stable across languages and build versions, independent of label text or hashed classes. **Tier 2 (Position Fallback)**: When tier 1 finds no match, if there are ≥ 2 `.ds-toggle-button[aria-pressed]` candidates, take the second button (within the toggle group, Smart Search follows Deep Thinking); if still not found, return `null`. Does not use build-hashed classes (`f79352dc` / `_6dbc175` which change with each deployment).
- **Observer Is Only for Waiting for Button Appearance**: The `MutationObserver` is only attached to body's `childList + subtree`, with the sole purpose of waiting for the button to first appear in the DOM. The `attributes` / `attributeFilter: ['aria-pressed']` observation on the button itself has been removed — that was the old source of clicking back user manual toggles, conflicting with the one-shot semantics. After one application, the observer stops, until the next activation event re-arms.
- **Click Throttle Removed**: The old `CLICK_COOLDOWN_MS` (500ms) was intended to suppress ping-pong from consecutive forced clicks. Under the one-shot model, there is at most one click per page load; the constant and its guard are dead code and have been deleted.
- **Master Switch Awareness**: Only acts when the master switch (`isEnabled`) is true. `chrome.storage.onChanged` (only the `local` namespace) monitors both `isEnabled` and `dsWebSearchToggle`, with both branches going through `_rearm()`. When application **has not yet** occurred (button hasn't appeared, or master switch started as off), the change is still effective — that application will use the latest value at the time. When the master switch turns **off**, it likewise re-arms, but the subsequent `_recompute()` correctly falls into `disable()`: no button is clicked, and pending applications and observers are cancelled.
- **`disable()` Does Not Restore Button State**: Unlike `hide-thinking`, this feature does not own any restorable state — stopping means leaving the button in its current state, with no extra click.
- **Implementation Location**: `content/websearch-toggle.js` (tests access via `module.exports`). `start()` is called automatically on module load, following the startup convention of `content/hide-thinking.js`.
