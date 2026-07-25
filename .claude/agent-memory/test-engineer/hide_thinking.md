---
name: hide-thinking-feature-tests
description: Hide Thinking Process feature test structure, coverage analysis, and mutation observer design
metadata:
  type: project
---

## Hide Thinking Feature Test Coverage

### Unit Tests (hide-thinking.spec.js)
- **Total tests**: 19 (14 original + 5 new from storage-manager tests)
- **Location**: `ds-studio/test/unit/hide-thinking.spec.js`
- **Test categories**: 
  1. `isExpandedButton()` — detects expanded state (3 tests)
  2. `tryCollapseButton()` — safely clicks buttons (4 tests)
  3. `applyToExisting()` — batch collapse (1 test)
  4. `scanRoot()` — tree traversal (1 test)
  5. `enable() / disable()` — lifecycle (5 tests including new mutation observer test)
  6. Storage listener — responds to storage changes (3 tests)
  7. StorageManager integration — hideThinking persistence (2 tests)

### Integration Tests (feature-hide-thinking.spec.js)
- **Total tests**: 6 — all passing
- **Location**: `ds-studio/test/integration/feature-hide-thinking.spec.js`
- **Test coverage**:
  1. Popup toggle saves dsHideThinking to storage
  2. hideThinking checkbox disabled when master switch off
  3. Enable dsHideThinking collapses existing buttons
  4. New buttons auto-collapse when feature enabled
  5. Disabling dsHideThinking stops automatic clicks
  6. Already collapsed buttons not clicked again

### Mutation Observer Design
- **Configuration**: `{ childList: true, subtree: true }` — only detects child node additions, NOT attribute changes
- **Callback logic**: Only processes `mutation.addedNodes`
- **Implication**: Class changes (e.g., user manually expanding button) do NOT trigger the observer

### Coverage Gap — FIXED
**Criterion 3**: User manually expands one block; new block appears elsewhere — only the new block collapses (manually expanded block not touched).

**Gap**: No explicit test verifying that class-change mutations (attributes-only) do NOT trigger observer.

**Fix Applied**: Added test "observer ignores class-change mutations (attribute-only changes)" that:
1. Enables feature (buttons auto-collapse via `applyToExisting()`)
2. Clears click mocks
3. Simulates class change by removing COLLAPSED_CLASS (attribute mutation, not childList)
4. Verifies button was NOT clicked again (observer ignored attribute mutation)
5. Adds new button to verify observer still works for childList mutations

This test guarantees the observer's protection: manually expanded buttons will never be re-collapsed by the observer.

### Test Statistics Summary
- **Unit**: 261 passing / 5 failing (pre-existing markdown line-ending issues)
- **Integration**: 6 passing
- **Hide-thinking specific**: 19 unit tests + 6 integration tests = 25 total
- **Regressions**: None introduced
