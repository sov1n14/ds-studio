---
name: auto-copy-harness
description: content/auto-copy.js scenario harness (jsdom, real chat pane + bridge + guarded buttons, shared activation log) and the oracle-check result from the 2026-11-08 red phase
metadata:
  type: project
---

test/helpers/auto-copy-harness.js (2026-11-08) drives content/auto-copy.js through real ds-selectors, reply-completion, feature-toggle and react-click-bridge under jsdom (MESSAGE_TOOLBAR_SELECTOR needs `:has()`). It mounts conv2-finished-chat-pane.html with its visible-items replaced by the reply-completion fixture list, guards EVERY role=button on the page, and logs labels on guarded activation, so one `toEqual([...labels])` asserts both what was clicked and order.

**Why:** the design names the dss:react-click event as the output, but testing-pitfalls requires activation; a guarded onClick reached via the bridge satisfies both, and guarding every button turns "nothing else clicked" into a free assertion.

**How to apply:** new toolbars need two batches (mount item, flush, append row, flush; `completeNewReply`); appending both in one batch counts as a re-mount. import.meta.glob loaders re-execute after vi.resetModules (verified with the oracle). Oracle check: reference 18/18, ten wrong oracles each failed at least one test. Interface names this spec fixed beyond the design: saveAutoCopyReply / saveAutoCopyCode, getSettings fields autoCopyReply / autoCopyCode. See [[scratch-and-oracle-check]], [[auto-click-loop-test-harness]].
