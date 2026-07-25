---
name: project-test-harness-gotop-addendum
description: One addEventListener-mocking gotcha in go-top.enable.spec.js's "enable / disable" beforeEach that blocks observing real scroll-listener teardown — not covered by project_test_framework or the suite-split memory.
metadata:
  type: project
---

Addendum to [[project_test_framework]] and [[project_gotop_test_suite_split_2026_07_26]] (see those for the general runner command and file map — not repeated here).

**Gotcha:** `test/unit/go-top.enable.spec.js`'s "enable / disable" describe's own `beforeEach` mocks `container.addEventListener = vi.fn()` (a no-op spy, not a real listener registration). Any test that needs to prove "no scroll listener remains attached after disable" by dispatching a real `'scroll'` event must NOT reuse that hook — build a separate real DOM container with a genuine (non-mocked) `addEventListener` instead, or the dispatched event can never reach anything regardless of whether the feature actually attached or detached a listener. See the new sibling describe `disable — teardown correctness (regression)` in the same file for the pattern (own local `createRealScrollContainer()` helper).
