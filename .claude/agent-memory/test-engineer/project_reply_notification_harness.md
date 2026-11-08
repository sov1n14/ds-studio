---
name: reply-notification-harness
description: content/reply-notification.js red-phase harness (2026-11-08) - routed sendMessage double with failure modes, foreground model, Object.create(globalThis) load env, oracle results
metadata:
  type: project
---

test/helpers/reply-notification-harness.js reuses the auto-copy page fixtures and routes chrome.runtime.sendMessage by type: GET_SETTINGS answers settings, DSS_SHOW_NOTIFICATION is copied at call time and answered by mode ok / reject (promise rejects, or callback gets lastError set only during the callback) / throw. Foreground = own-property getters for document.visibilityState and document.hidden plus a hasFocus spy; captureUncaught collects process unhandledRejection and window error events.

**Why:** the source-evaluation tests (auto-start, exports, missing deps) use a globals object made by Object.create(globalThis), bound as both globalThis and window, so the module still sees dsI18n, DSS_SHOW_NOTIFICATION and chrome; assigning undefined makes a dependency absent.

**How to apply:** oracle check on 2026-11-08 killed 17 of 18 wrong oracles. A once-per-batch notification survived because the requirement does not say how many notifications two replies completing in one batch should send; ask before adding a test for it. See [[auto-copy-harness]], [[scratch-and-oracle-check]].

Mutant-kill round 2026-11-08: harness gained modes undefined / non-thenable (sendMessage returns no promise). test/unit/reply-notification.mutant-kill.spec.js kills gate mutants through on-off-on and a duplicate start() registration (feature-toggle only fires callbacks on transitions, so a second start() is the only public way to reach _setGate(true) with an observer present). Equivalent: _isOn initial value, the !_isOn early return, the disconnect block (jsdom disconnect clears the record queue, so each guards the other), completedCount === 0. Break hasFocus only in the completing batch, or a count-vs-foreground order change breaks the catch-path test.
