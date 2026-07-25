---
name: project_sidebar-auto-hide-tests
description: Test coverage facts for sidebar-auto-hide.js — patterns, pitfalls, and structure used when creating the spec.
metadata:
  type: project
---

`ds-studio/test/unit/sidebar-auto-hide.spec.js` was created with 32 tests (Groups A–E).

**Key patterns used:**

- Module import order: `import '../../utils/storage-manager.js'` FIRST, then the content script (ensures `StorageManager` global exists before `start()` fires).
- `beforeEach` manually resets all mutable fields; calls `document.removeEventListener` to clean up the capture-phase `mouseover` listener before nulling `_hoverMonitorHandler`.
- `afterEach` calls `vi.useRealTimers()` to restore after any `vi.useFakeTimers()` usage.
- `requestAnimationFrame` is stubbed per-test via `vi.stubGlobal('requestAnimationFrame', (cb) => cb())` for synchronous control.
- `fireMouseover(target)` dispatches `MouseEvent('mouseover', { bubbles: true })` on the actual element — capture listener on `document` receives correct `e.target`.

**Pre-existing failures (not caused by this work):**
- `unit/censor-xhr-hook.spec.js` — 2 failures (yaml fixture loading issue)
- `unit/storage-manager.migration-push.spec.js` — 3 failures (migration key regression)

**B1 (child element in ds-elevated):** This test currently PASSES because happy-dom's `el.closest('.ds-elevated')` check is implicitly supported by the current code path OR the code-implementer's fix was already applied. Verify if B1 fails on the original `sidebar-auto-hide.js` before the fix.
