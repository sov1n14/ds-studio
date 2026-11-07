---
name: project-hide-thinking-dom
description: Real DeepSeek think-block structure (expanded vs collapsed), the shared real-markup fixture helper, and the scanRoot closest() regression found 2026-11-08
metadata:
  type: project
---

Captured think block (first child of the assistant .ds-message): children are header, spacer, think body nodes, footer. Expanded body = three `.ds-think-content` steps (loading dots, separator, markdown) interleaved with a "搜索到 N 个网页" search row (`.ds-icon:first-child + span + div`, a header lookalike) and a "浏览 N 个页面" row with reference links. Natively collapsed = header, spacer, footer only; React unmounts the body nodes (childList mutation), it does not toggle a class.

Fixtures: test/fixtures/ds-snapshots/think-{open,closed,streaming}-message.html; helper test/helpers/think-block-fixtures.js (loadThinkMessage, thinkParts positional anatomy, installNativeThinkToggle, stripHashedClasses). hide-thinking.spec.js asserts the page-level outcome (block shows no .ds-think-content), not only the click.

**Why:** 2026-11-08 the structural-selector change made scanRoot use `root.closest(CONTAINER_SELECTOR)`, so any child added to an unmarked block re-collapses it; a natively collapsed block the user expands snaps shut (red test "observer does not re-collapse a natively collapsed block the user expands"; passes on HEAD 0872dfe). It conflicts with the plan-requested "header renders after the empty block" scenario, which closest() was added for.

**How to apply:** check this test's status before touching hide-thinking; both scenarios must hold together.
