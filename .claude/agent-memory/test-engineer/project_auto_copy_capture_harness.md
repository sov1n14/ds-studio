---
name: auto-copy-capture-harness
description: Unfocused auto-copy capture (U6-14) specs - fake Clipboard on prototype with Illegal invocation, site copy buttons wrapping guarded onClick, bridge and relay loaded once per file, fake Date only, routing plain sendMessage
metadata:
  type: project
---

test/helpers/auto-copy-capture-harness.js plus unit/auto-copy.unfocused-capture.spec.js (21) and .reinject.spec.js (1), 2026-11-08. navigator.clipboard is a FakeClipboard instance (writeText on the prototype, TypeError when unbound, NotAllowedError DOMException while unfocused) installed before the bridge loads, because the bridge wraps writeText only if it exists at load. Bridge and relay load once per spec file (both listen on document); every test sets fake Date one hour later so leftover pending entries are expired; only Date is faked so MutationObserver and flush() keep real timers.

**Why:** the bridge and relay each gate independently (bridge FIFO entry, relay FIFO entry, both 1500 ms), so a negative test with no live relay entry is absorbed by the relay and cannot catch bridge mutants. Open the window first with a focused auto-copy click (writeText resolves: bridge entry consumed, relay entry stays live), then run the negative.

**How to apply:** reuse for any change to react-click-bridge.main.js clipboard wrapping or auto-copy.relay.js. 13 scratch mutants all killed via a vite transform config (no prod edits). See [[vifn-marks-rejections-handled]], [[mutation-proof-without-prod-edits]].

Mutant-kill follow-up (2026-11-08): the bridge and relay windows mask each other in the joint harness, so window, purge and FIFO mutants survived there. Kill them in isolation: unit/auto-copy.bridge-capture.mutant-kill.spec.js evaluates the bridge per test with new Function('window','document','navigator','CustomEvent', src) and observes dss:auto-copy-captured on a fresh createHTMLDocument; unit/auto-copy.relay.mutant-kill.spec.js does the same with ('globalThis','document','chrome','module'). Equivalent: `length > 0` changed to true or `>= 0` in the purge loop (`undefined <= now` is false); the relay's `pending && typeof pending.catch` guard (minimum_chrome_version 111, so promise-form sendMessage always returns a Promise or throws).
