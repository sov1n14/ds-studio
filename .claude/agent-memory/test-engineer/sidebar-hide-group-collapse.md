---
name: sidebar-hide-group-collapse
description: temporary-chat-sidebar-hide hides the GROUP container when all anchors queued, not individual anchors
metadata:
  type: project
---

When writing tests for `content/temporary-chat-sidebar-hide.js`, the group collapse rule means: if ALL anchors in a date-group are queued, the GROUP element gets the hidden class — individual anchors do NOT. To test individual anchor hiding, use a multi-anchor group where only some are queued, or use a non-matching `groupClass` to trigger the fallback path.

**Why:** Spent significant debugging time on tests that checked `isHidden(anchor)` on single-anchor groups where all anchors were queued, expecting `true` but getting `false` because the group was hidden instead.

**How to apply:** Any test asserting `isHidden(byUuid.get(X)).toBe(true)` needs a group with at least one non-queued anchor alongside X.
