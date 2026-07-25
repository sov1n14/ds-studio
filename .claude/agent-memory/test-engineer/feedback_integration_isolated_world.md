---
name: integration-isolated-world
description: Chrome content script isolated world blocks page.evaluate access to window.DSstudio; use DOM/event observable patterns instead
metadata:
  type: feedback
---

Content scripts in Chrome extensions run in an **isolated world**: they share the DOM with the main page but have a separate `window` object. `page.evaluate()` in Playwright runs in the **main world**, so it cannot access anything the content script sets on its own `window` (e.g. `window.DSstudio.GoToTop`).

**Why:** Attempted `page.evaluate(() => window.DSstudio?.GoToTop)` always returns `null` — the object lives in the content script's isolated world, not the page world.

**How to apply:**
- Never write integration tests that read content-script state via `page.evaluate`.
- Instead observe DOM effects: button presence/absence, `data-*` attributes, CSS classes.
- To trigger content-script logic indirectly, fire DOM mutations (MutationObserver pickup) or dispatch native events (`popstate`, `click`) that the content script listens to.
- To simulate route changes, use `history.pushState + window.dispatchEvent(new PopStateEvent(...))`.

See also: [[integration-scroll-listener-harness]]
