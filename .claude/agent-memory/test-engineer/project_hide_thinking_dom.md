---
name: project-hide-thinking-dom
description: Real DeepSeek DOM structure for hide-thinking tests — container/header/content pattern
metadata:
  type: project
---

The `hide-thinking.js` feature uses a three-element DOM structure. Tests must replicate this structure.

**Current DOM (post-fix):**
- `._74c0879` — container (CONTAINER_CLASS); receives `data-ht-collapsed='1'` when collapsed by extension
- `._245c867` — header inside container; this is what gets **clicked** to toggle
- `.ds-think-content` — content div inside container; **only present when expanded**. Its absence = collapsed state.

**Test helpers pattern:**
- `createExpandedContainer()` — container with header + `.ds-think-content` child; `header.click` is a `vi.fn()` that removes `.ds-think-content`
- `createCollapsedContainer()` — container with header only (no `.ds-think-content`)

**Key behavioral facts:**
- `tryCollapseButton(el)` clicks the header, not the container
- `restoreAll()` removes `data-ht-collapsed` attribute AND re-clicks the header to re-expand the block (if still connected to DOM)
- `disable()` therefore re-expands all previously collapsed blocks by clicking their headers
- `isExpanded(el)` checks for `.ds-think-content` child presence
- Old API (`isExpandedButton`, `COLLAPSED_CLASS: 'e47135bc'`) no longer exists

**Why:** The old tests used a fake button with `e47135bc` class toggling. The real DOM has a container/header/content hierarchy. See [[project_test_framework]] for how to run these tests.

## Unit test coverage (`test/unit/hide-thinking.spec.js`)

Test categories: `isExpandedButton()` detection, `tryCollapseButton()` safe-click, `applyToExisting()` batch collapse, `scanRoot()` tree traversal, `enable()/disable()` lifecycle (incl. mutation-observer test), storage-change listener, StorageManager `hideThinking` persistence integration.

**Mutation Observer design:** `{ childList: true, subtree: true }` — detects child-node additions only, NOT attribute changes. Class changes (e.g. a user manually re-expanding a block) do NOT trigger the observer — this is intentional: a "observer ignores class-change mutations (attribute-only changes)" test guarantees manually-expanded blocks are never re-collapsed by the observer. Verified by: enable feature (auto-collapse via `applyToExisting()`), clear click mocks, remove `COLLAPSED_CLASS`/toggle attribute (attribute-only mutation), assert button NOT re-clicked, then add a new button and confirm the observer still fires for childList mutations.

Note: an earlier version of this note described a companion Playwright integration spec (`feature-hide-thinking.spec.js`) — that file and the `test/integration/` directory no longer exist (integration/e2e tests are retired project-wide per CLAUDE.md §3). Unit coverage above is the current and only coverage for this feature.
