---
name: auto-open-sidebar-observer-equivalents
description: Why observer-lifecycle mutants in content/auto-open-sidebar.js (76:17, 89:25, 90:17 true, 91:13, 121:13) survive click-count tests, and what does kill the guard-edge mutants
metadata:
  type: project
---

In `content/auto-open-sidebar.js` the MutationObserver callback returns early when `!this.isEnabled` (line 78), and `disable()` both disconnects the observer and sets `isEnabled = false`. The two guards are mutually redundant, so every "observer not disconnected / second observer leaked" mutant (76:17 `if (this._observer) return` to false, 89:25 `_stopObserver` body emptied, 90:17 `if (true) return`, 91:13 `disconnect()` removed, 121:13 `_stopObserver()` call removed) produces identical clicks: leaked observers either hit the isEnabled gate or are deduplicated by `_hasClickedThisEpisode`. Confirmed by Stryker on 2026-10-16: tests "second enable then disable then new episode gives 0 clicks" and "disable then re-enable observes again" killed nothing and were dropped.

**Why:** the lead had classified these as weak assertions; they are only killable through the platform boundary (count MutationObserver instances connected minus disconnected by wrapping `globalThis.MutationObserver`), which the lead's "clicks or public state only" constraint excluded.

**How to apply:** do not rewrite click-count tests for these mutants; either accept them as equivalent or get the lead's approval to assert the observer resource lifetime at the MutationObserver boundary. Killers that worked: exact 1500 ms boundary under fake timers (64:38), a buttonless collapse asserting zero `console.error` calls because the scan's try/catch swallows the TypeError (61:17), `AutoOpenSidebar.isEnabled` after a broadcast disable (124:30), a direct `window.DSstudio.AutoOpenSidebar.disable()` before any enable (90:17 BooleanLiteral and `if (false)`).
