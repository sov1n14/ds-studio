---
name: sidebar-hide-group-collapse
description: temporary-chat-sidebar-hide hides the GROUP container when all anchors queued; fallback path reachable only when no div directly holds chat rows
metadata:
  type: project
---

When writing tests for content/temporary-chat-sidebar-hide.js, the group collapse rule means: if ALL anchors in a date-group are queued, the GROUP element gets the hidden class, individual anchors do NOT. To test individual anchor hiding, use a multi-anchor group where only some are queued.

Since 2026-11-08 SIDEBAR_DATE_GROUP_SELECTOR is structural (div:has(> a[href*="/a/chat/s/"])), so a renamed group class no longer reaches the fallback. The specs reach it by re-tagging every anchor-parent container to section (retagDateGroups in temporary-chat-sidebar-hide.spec.js) with a precondition that no chat row has a div parent.

**Why:** Spent significant debugging time on tests that checked isHidden(anchor) on single-anchor groups where all anchors were queued, expecting true but getting false because the group was hidden instead.

**How to apply:** Any test asserting isHidden(byUuid.get(X)).toBe(true) needs a group with at least one non-queued anchor alongside X; any fallback test must remove every div parent of the chat rows, captured groups included.
