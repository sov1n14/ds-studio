---
name: navigation-stale-prefix-not-real
description: Suspected "stale updatePromptPrefixFromBinding overwrites prefix after navigation" defect does NOT reproduce; 76 orderings probed 2026-09-27, spec kept as guard
metadata:
  type: project
---

2026-09-27: test/unit/content-script.navigation-stale-prefix.scenario.spec.js (4 scenarios: A->bound B, A->unbound C, A->new-chat pinned, A->new-chat unpinned) passes on current code. A throwaway sweep of recompute-start offsets -6..+12 macrotasks relative to navigation, across all 4 destinations, was 76/76 consistent.

**Why:** every handleChatChange branch awaits at least one storage read (getChatPresetMap and/or getSettings) before writing state.promptPrefix, and the pinned new-chat branch writes via updatePromptPrefixFromBinding itself (bumping the generation). A recompute started earlier queues its getSettings first, and the storage fake is FIFO, so it resolves before navigation writes.

**How to apply:** only revisit if a navigation branch starts writing the prefix synchronously or from a cache, or if evidence shows real chrome.storage reads completing out of order within an area.
