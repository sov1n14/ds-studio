---
name: preset-dom-resolvers-tests
description: 16 tests for DOM resolver fix in preset-overlay.controller.js — title/button selection via reposition() public API
metadata:
  type: project
---

Tests live in `test/unit/preset-overlay.dom-resolvers.spec.js` (16 tests, 6 groups).

**Why:** Resolvers `resolveTitleEl` / `resolveNewChatButtonEl` are INTERNAL (IIFE closure) — cannot spy on `computePlacement` to inspect args because the closure captures the function reference at load time. All assertions use `wrapperEl.style.left` / `style.width` as the observable output.

**How to apply:** When testing internal helpers in the controller IIFEs, drive via the public surface and assert on DOM output, not on spy call args.

Key patterns:
- happy-dom implements `requestAnimationFrame` → `scheduleFrame` is ASYNC. Must stub `globalThis.requestAnimationFrame = fn => fn()` (makeRafSync) before calling `reposition()`.
- `getNaturalWidth()` returns ~20px in happy-dom → clamped to minWidth=80 → center mode `left=(containerWidth-80)/2`.
- Deterministic rect stubs via `vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(...))`.
- Test for btn1 (wrong) vs newChatBtn (correct): wrong choice produces degenerate placement (negative gap), correct choice produces center at 343.5 — this distinction is the core proof.
