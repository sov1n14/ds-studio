---
name: preset-dom-resolvers-tests
description: preset-overlay.dom-resolvers.spec.js design after the 2026-11-08 structural-selector rewrite; real header fixtures, gap-branch placement, why center mode is vacuous for resolvers
metadata:
  type: project
---

`test/unit/preset-overlay.dom-resolvers.spec.js` (22 tests, rewritten 2026-11-08) loads captured header containers from `test/fixtures/ds-snapshots/` (`conversation-header.html`, `home-header.html`, `mobile-ua-home-header.html`) and locates expected elements by captured position (container.children[1] = title row, its children[1] = title, lastElementChild = new-chat, container.children[2] = share button), never via the selectors under test.

**Why:** the old spec built headers with `SELECTOR.slice(1)` class derivation, which broke when selectors became structural, and its placement checks ran in the >= 768 px center branch, which ignores title/button rects, so 17 resolver tests passed no matter which element was picked.

**How to apply:**
- Resolvers are exported (`require('../../content/preset-overlay.resolvers.js')`); assert `result.el` with `toBe`, not `toEqual` (vitest compares DOM nodes with isEqualNode, so a structurally equal wrong node passes).
- Placement checks belong in the < 768 px gap branch with `getNaturalWidth` stubbed to 80 and every decoy (share button, centred title copy, sidebar toggle) given a rect that yields a different left; mutation probes (share, centred title, toggle, first button) each turned 8-10 tests red.
- Controller specs mount `findAndMount`/`start` targets from the same fixtures (`appendConversationHeader` / `appendHomeHeader` local helpers).
- rAF trampoline (`makeRafSync`) still required; see [[reference-ds-locator-probe-snapshots]].
