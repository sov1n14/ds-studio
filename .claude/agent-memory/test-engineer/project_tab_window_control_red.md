---
name: project-tab-window-control-red
description: RED-phase contracts pinned for utils/tab-control.js and utils/window-control.js (backlog B1/B17/B11, decision D5) and the dual-route stub trick used for the window singleton
metadata:
  type: project
---

`test/unit/tab-control.spec.js` and `test/unit/window-control.spec.js` were authored red on 2026-08-22 against modules that do not exist yet (backlog B1, B17, B11, D5).

**Why:** Five popup modules call `chrome.tabs.*`/`chrome.windows.*` directly; the backlog moves them behind `utils/` adapters. D5 additionally upgrades the editor window to a true singleton whose content swaps when a different prompt group is clicked, so the window id must live in `chrome.storage.session`, not a popup closure.

**How to apply:** These are thin adapters, so the chrome-call arguments ARE the observable contract and are asserted directly. Two harness notes worth reusing: `chrome.storage.session` is deliberately absent from `test/setup/vitest.setup.js` (each spec installs its own stub and `delete`s it in afterEach), and the "navigate the existing window" test stubs BOTH `chrome.windows.get` (populated, with `expect.anything()` for the options arg) AND `chrome.tabs.query` with the same tab list, so either route to the window's tab satisfies the test without the spec dictating which one the implementation picks.
