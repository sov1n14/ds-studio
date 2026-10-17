---
name: reference-popup-html-real-dom
description: Build a real popup DOM from popup.html for applySettingsToDom / bindToggles / applyMasterSwitchUI specs; strip link and script tags at string level first or happy-dom fetches assets from localhost:3000
metadata:
  type: reference
---

`test/unit/popup-auto-click-toggles.spec.js` (2026-09-24) parses `popup/popup.html` with DOMParser, copies body into `document.body`, and keys every `[id]` element into a `dom` object (plus `websearchRadios`). That object feeds the real `applySettingsToDom(dom, settings)`, `createToggleManager(ctx).bindToggles(dom)`, and the extracted `applyMasterSwitchUI` — no hand-built partial dom, so a missing ref cannot mask a wiring gap.

**Why:** happy-dom fetches `<link rel=stylesheet>` and `<script src>` even inside a DOMParser document, producing hundreds of ECONNREFUSED stderr lines and ~14s runtime. Removing the nodes after parsing is too late; strip them from the HTML string with regex before `parseFromString`.

applyMasterSwitchUI now runs only through test/helpers/popup-master-switch-harness.js (mountPopupHtml + buildApplyMasterSwitchUI): it derives bound identifiers from popup.js 4-space-indent const DOM-ref declarations and throws on unmatched elements. Never reintroduce a hard-coded CLOSURE_VAR_NAMES list; that broke two specs when autoRetryToggle was added (2026-09-24).

**How to apply:** Reuse this harness for any new popup toggle. Before trusting a red run, point TOGGLES at an existing toggle (hideThinking / preventAutoScroll) in a throwaway copy and confirm green — that proved the harness in the auto-retry/auto-continue red phase. Related: [[project-popup-toggle-factory-conventions]], [[pitfall_bash_heredoc_long_files]].
