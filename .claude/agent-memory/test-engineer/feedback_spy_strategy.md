---
name: spy-strategy-internal-object
description: vi.spyOn on module exports cannot intercept internal object method calls in quote-reply.js — use DOM/state observations instead
metadata:
  type: feedback
---

When `handleSelectionChange` calls `QuoteReply.hideButton` or `QuoteReply.showButton`, it goes through the internal `QuoteReply` object literal, NOT via `module.exports`. Spying on the exported object with `vi.spyOn(quoteReply, 'hideButton')` will not intercept those calls.

**Why:** The module pattern captures `QuoteReply` as a local object reference. `module.exports` is a separate object that holds references to the same functions, but replacing the export property does not affect the internal call path.

**How to apply:** For `handleSelectionChange` tests, verify observable effects:
- `hideButton` path: check `btn.style.display === 'none'` and `__getState().selectedText === ''`
- `showButton` path: check `btn.style.display === 'flex'` and `__getState().selectedText` is populated

This pattern applies to any content script module using the same internal-object design.
