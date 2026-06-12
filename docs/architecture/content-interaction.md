# 使用者互動模組架構

> 📂 [DS studio 文件](../) › [架構文件](../ARCHITECTURE.md) › [內容腳本模組](CONTENT_SCRIPTS.md) › 使用者互動
>
> **相關規格**：[功能規格](../spec/04-features.md)

## Quote Reply Module

`content/quote-reply.js` implements a `QuoteReply` singleton that adds a floating "引用回覆" button triggered by text selection in the AI response area.

### Trigger and Scope

- **Scope guard** (`isSelectionInScope`): Only activates when both `anchorNode` and `focusNode` of the selection reside inside `div.ds-virtual-list-visible-items`. Selections crossing outside this container are ignored.
- **Trigger events**: `document.mouseup` (250ms debounce), `document.selectionchange` (250ms debounce), and `keyup` for Shift/Arrow keys (250ms debounce, skips `isComposing`).
- **Snapshot strategy**: `_selectedText` is captured synchronously at debounce-end. The button `click` handler uses this snapshot rather than re-reading the live selection — mitigates virtual-list node unmount race conditions.

### Button Positioning (`unionClientRects` + `computeButtonPosition`)

`handleSelectionChange` collects all client rects from `range.getClientRects()` and merges them via `unionClientRects` into a single bounding box (`top`/`left`/`bottom`/`right`/`width`). Zero-area rects are skipped.

`computeButtonPosition` is a pure function computing `{top, left, hidden}` from that union rect, button dimensions, and viewport dimensions:

- Default: button placed 16px above the top of the full selection block, horizontally centred on the union width.
- Left/right boundary clamping: minimum 10px margin from viewport edges.
- Top flip: if computed `top < 10`, button moves 8px below the union bottom (last line of the block).
- Hidden: returned when the full selection block has scrolled out of the viewport (`bottom < 0` or `top > vh`).

### Scroll and Resize Handling

Scroll/resize event listeners (`_scrollHandler`, `_resizeHandler`) are attached only while the button is visible (`showButton`) and detached on `hideButton`, preventing unnecessary event processing when the button is hidden. Both handlers use `requestAnimationFrame` to re-run `handleSelectionChange` without blocking the scroll thread.

### Textarea Injection (`injectQuote`)

Appends `formatQuote(selectedText)` to the textarea value:

- **`formatQuote`**: `text.split(/\r?\n/).map(l => '> ' + l).join('\n')` — each line receives a Markdown blockquote prefix.
- **React-aware write**: Uses `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` (same pattern as `content-script.js:391`) followed by `input` and `change` event dispatch to trigger React state updates.
- **Append logic**: empty textarea → quoted text only; non-empty → existing content + `\n` (if not already ending with `\n`) + quoted text.

### CSS Injection

A `<style id="dss-quote-reply-style">` is injected into `document.head` with `.dss-quote-btn` styles:

- `position: fixed; z-index: 2147483000` for proper stacking above the DeepSeek UI.
- Light/dark mode handled by both `@media (prefers-color-scheme: dark)` and `html[data-theme="dark"]` selectors (the latter covers DeepSeek's runtime theme toggle).

### Dismissal Conditions

The button hides when: (1) text selection is cleared or collapses, (2) selection node leaves scope, (3) the selection scrolls fully out of the viewport, (4) the window resizes (recomputes position, hides if out of bounds), (5) the user clicks anywhere outside the button.

### Test Interface

Exports via `module.exports` (Node-env guard): `handleSelectionChange`, `injectQuote`, `computeButtonPosition`, `isSelectionInScope`, `formatQuote`, `showButton`, `hideButton`, `getButtonEl`, `__resetState`, `__setState`, `__getState`. Pattern matches `content-script.js:756-795`.

### ARIA and Accessibility

The combobox follows ARIA authoring practices:
- The trigger has `role="combobox"`, `aria-haspopup="listbox"`, and `aria-expanded`.
- The panel has `role="listbox"` and `aria-label="提示詞組清單"`.
- Each preset item has `role="option"`.
- Action buttons (edit, delete) have `aria-label` attributes.
- The drag handle has `aria-hidden="true"` since drag is an enhancement not available to all input modalities.

## PreventAutoScroll Module

The PreventAutoScroll module uses a two-file architecture to suppress DeepSeek's automatic scroll-to-latest behavior during controlled operations like Markdown export.

### Architecture

- **`content/prevent-auto-scroll.js`** (MAIN world): Executes in the page's JavaScript context. Monkey-patches `Element.prototype.scrollTo`, `Element.prototype.scrollBy`, and the `scrollTop` setter on `Element.prototype`. Each patched method checks `_isBridgeEnabled()` before allowing or blocking the scroll. If the bridge is enabled (interception active), calls to scroll to the bottom of the conversation are suppressed.
- **`content/prevent-auto-scroll-bridge.js`** (ISOLATED world): Content script that manages injection and control. Injects the main-world script via a `<script>` element using `chrome.runtime.getURL('content/prevent-auto-scroll.js')`. Creates and manages a hidden `<div id="dss-prevent-auto-scroll-bridge" style="display:none">` in the document whose `dataset.enabled` attribute is read by the main-world patch.

### Control Flow

- `enable()`: Sets `bridge.dataset.enabled = 'true'`. The main-world patch reads this and begins suppressing auto-scroll calls.
- `disable()`: Sets `bridge.dataset.enabled = 'false'`. Auto-scroll resumes normally.

### Design Decisions

- The content script (isolated world) uses its own unpatched `Element.prototype` references for all scroll operations, so `harvest.js` and `go-top.js` can scroll freely while the page's auto-scroll is suppressed.
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

In `content-script.js`:

- `let showSystemTime = false` — runtime state variable, initialized from storage during `initSettings()`.
- `formatSystemTime(date = new Date())` — pure function returning `yyyy/mm/dd hh:mm:ss` in 24-hour format with zero-padding.
- In `injectPrefix()`, the system time is prepended before the injection prefix:
  ```
  Current Time: 2026/05/31 14:30:00\n\n
  ```
  This string is inserted before the injection prefix (if any) and the `<user-input>` wrapper.

### Re-injection Guard

The timestamp is captured once at injection time (not at page load), so each message reflects the time when the user pressed send. If `showSystemTime` changes between messages (via popup toggle + `chrome.storage.onChanged`), the new value takes effect on the next send.

### Master Switch Awareness

When `isEnabled` is `false`, `injectPrefix()` returns early — the system time is never prepended regardless of `showSystemTime`. The toggle in the popup is also disabled by `applyMasterSwitchUI()`.
