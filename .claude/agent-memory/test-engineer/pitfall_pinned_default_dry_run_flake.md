---
name: pinned-default-dry-run-flake
description: content-script.pinned-default.spec.js test 1 flake in Stryker dry runs — root cause (un-awaited initSettings bootstrap superseding promptPrefix generation) found and fixed 2026-09-30
metadata:
  type: project
---

Flaked in Stryker dry runs on 2026-09-26 and 2026-09-30 ("expected '' to be 'You are helpful.'", pendingPresetId already 'p1'). Root cause: content-script.js starts initSettings() un-awaited at import; the spec's beforeEach waited only one setTimeout(0), so test 1 began with the bootstrap in flight (listenerCount 1). The bootstrap's own handleChatChange() -> updatePromptPrefixFromBinding() bumps promptPrefixGeneration, the test's call bails at the generation check, and the test asserts before the bootstrap's write lands. A fresh-import probe reproduced it deterministically when the body started 2-8 macrotask ticks after import. Fixed 2026-09-30 by exporting waitForContentScriptBootstrap from test/helpers/overlay-consistency-harness.js and awaiting it in the spec's beforeEach.

**Why:** timing only surfaces under Stryker 10-way concurrency; unrelated to whatever module Stryker is mutating.

**How to apply:** any content-script.js spec that resets state in beforeEach must await waitForContentScriptBootstrap first (see [[content-script-broadcast-bootstrap]]); if this test flakes again, check that the waiter is still in its beforeEach.
