---
name: e2e-batch3-live-facts
description: Live DeepSeek facts from E2E batch 3 (edit box, real-send capture, auto-click synthetic buttons, temp-chat row) and the Bash quoting trap hit while writing sabotage copies
metadata:
  type: reference
---

Measured 2026-11-08 on `.browser-profile`. The profile rests with `isEnabled: false`, so the temp-chat row, quote button and prompt prefix are all absent until a spec turns the master on. The native edit box is `textarea[name="user query"]` inside the edited virtual-list item; pin that item by its `data-virtual-list-item-key` value, because a positional `.first()` re-resolves after hover and opened the edit box on a different message. Kept user messages display a literal `<user-input>` wrapper; the edit box opens with it stripped. A real Enter on the home page with `chat/completion` aborted posts a body whose `prompt` holds the injected text, does not navigate and writes no chat binding. Conversation 8176d3c0 matches both CONTINUE selectors, so never enable auto-continue on it; the home page matches none.

**Why:** These facts decide whether an E2E assertion is reachable without sending a message and whether a locator stays on the intended element.

**How to apply:** Use `blockSendRequests` (capture plus abort) for real-send specs and `guardAgainstSending` (also swallows composer Send clicks at `<html>` capture) for composer-value specs. Auto-click specs use a synthetic button whose own `__reactProps$` onClick counts only trusted native events; the MAIN-world bridge reaches it. The v4.36.8 edit-window regression cannot be run against pre-fix code without touching production, so its sabotage copies inject the symptom (fill the edit box) instead. In Bash heredocs a JS string containing a backslash-n escape arrives as a real newline and breaks the copy; use a space separator. See [[e2e-live-calibration]].
