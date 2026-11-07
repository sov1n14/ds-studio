---
name: reference-ds-locator-probe-snapshots
description: Where 26 live DeepSeek page snapshots live, how to extract real-markup fixtures from them, and which locator fallbacks proved observable vs not (2026-11-08)
metadata:
  type: reference
---

Live DeepSeek snapshots (26 UI states, html+png+json) sit in `%TEMP%\ds-locator-probe\snaps\*.html`; analysis in `change-plan.md` beside them. Extract fixtures by parsing with `happy-dom` `Window` from `test/node_modules` (createRequire on `test/package.json`) in a scratch dir outside the repo, sanitize message text to placeholders, write to `test/fixtures/ds-snapshots/`.

Findings from the 2026-11-08 red phase:
- Every snapshot's new-chat button carries inline `min-width: 44px`, so the resolver's structural fallback only runs when that style is removed; test by stripping the style from real markup.
- Assistant toolbar: outer `.ds-flex` wrapper holds only the toolbar group plus a spacer, so `_isCensored(outer)` gives the same verdict as `_isCensored(group)`; a wrong group is not visible through the verdict.
- Export `|| msg.firstElementChild` (content-script.export.js) is not observable: across all 26 states every message without `.ds-markdown` and without user content has empty text, so output is `---\n\n` either way.
- Standalone happy-dom `querySelectorAll(':scope > [role="button"]')` returned 0 for real direct children (not re-checked inside vitest). Verify before trusting any `:scope >` code path in tests. Related: [[happy-dom-has-descendant]].
- Live retry button (snapshots error-after-abort, stream-stop-icon; on an earlier aborted user message) has classes `ds-button ds-button--warning ds-button--filled ds-button--circle ds-button--xs ds-button--icon-relative-m _76a2310` plus inline `--dsl-button-height: 24px`; no `a3b9bd76`. Harness RETRY_MARKUP omits `_76a2310` by lead mandate (G7, 2026-11-08).
- Long user-message toggle (.ds-collapsible-text-toggle-button > div > .ds-icon) appears once per snapshot (conv2-finished, conv2-top, stopped, stream-nothink, stream-stoppable) and only in the collapsed state (inline rotate(180deg)); no expanded capture exists, so expanded = strip the transform. Fixture: test/fixtures/ds-snapshots/conv2-finished-visible-items-collapsible.html (G8, 2026-11-08).
- Chat-pane fixtures `conv2-finished-chat-pane.html` / `edit-window-chat-pane.html` (`div._765a5cd` subtree) hold header, list, composer column and, in edit mode, the edit box; built for edit-message-cleanup.spec.js (G4). Assistant toolbar button index 1 carries `aria-disabled="false"` like the user edit button, so only the user-item scope rejects it.
- Sidebar (G6, 2026-11-08): test/fixtures/ds-snapshots/sidebar-expanded.html (conv2-finished) and sidebar-collapsed.html (conv-sidebar-collapsed), groups trimmed to 3 rows, uuids/titles/email replaced. Natively collapsed the wrapper children are [rail, inner(display:none)]; expanded (narrow drawer too) only [inner]. sidebar-buttons/full-collapesed-component.html equals the live rail byte-for-byte after whitespace normalization.
