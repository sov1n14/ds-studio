---
name: export-collapsed-thinking-scenario
description: Real-Harvest export scenario harness for collapsed think blocks (jsdom, non-overflow container, fake timers) and the harvestAllMessages-wrapper probe that proves display-state tests are non-vacuous
metadata:
  type: project
---

test/unit/export-collapsed-thinking.scenario.spec.js (2026-11-08) drives exportConversationToMarkdown with the REAL Harvest (static imports harvest.toast, harvest.dom, harvest.js; harvest.policy is preloaded by setup) under jsdom. Non-overflowing container (scrollHeight === clientHeight) means no scrolling and isComplete:true; Blob is swapped for a capturing class and fake timers wrap only the export call (vi.runAllTimersAsync). jsdom prints "Not implemented: navigation to another Document" from the download anchor click, which is noise.

**Why:** a "stays collapsed after export" test passes vacuously on pre-fix code because nothing expands the block, so it must share a test with the "thinking exported" assertion (the combined form).

**How to apply:** prove such display-state tests with a scratch copy that wraps window.DSstudio.Harvest.harvestAllMessages to click collapsed headers before harvest, with and without a restore click afterwards. The restore variant must turn the collapsed tests green and the include-off test red; the no-restore variant must turn the combined test red on the display assertion. Related: [[harvest-export-tests]], [[project-hide-thinking-dom]].
