---
name: vifn-marks-rejections-handled
description: A vi.fn whose implementation returns a rejected promise hides a missing .catch in the caller - vitest 3 tinyspy attaches handlers for mock.settledResults, so no unhandledRejection ever fires
metadata:
  type: project
---

vitest 3.2 `vi.fn` attaches its own then-handlers to every promise its implementation returns (to fill `mock.settledResults`), which marks a rejection as handled. A test asserting "a rejected sendMessage does not escape as an unhandled rejection" therefore passes even when the code under test has no `.catch` at all.

**Why:** 2026-11-08, unfocused auto-copy capture specs: a scratch mutant removing the relay's `pending.catch(...)` survived while `chrome.runtime.sendMessage` was the harness vi.fn; replacing it with a plain routing function (calls recorded by hand) killed it via a `process.on('unhandledRejection')` recorder.

**How to apply:** whenever a test checks that a boundary rejection is swallowed, make the faked boundary a plain function (not vi.fn, not mockImplementation) and record unhandled rejections plus window 'error' events yourself. Other harnesses that model sendMessage rejections with vi.fn (auto-click-harness, reply-notification-harness) cannot prove "handled" this way. See test/helpers/auto-copy-capture-harness.js routeSendMessage / recordUncaught, [[auto-copy-harness]].
