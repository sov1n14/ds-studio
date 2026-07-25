---
name: project-test-framework
description: ds-studio test framework setup, runner commands, file placement, and established patterns
metadata:
  type: project
---

**Test framework:** Vitest v3.2.4, environment `happy-dom`, globals enabled.  
**Runner:** `cd ds-studio/test && npm run test:unit` (vitest run).  
**Coverage:** v8, covers `../utils/**/*.js` and `../content/**/*.js`.  
**Test directory:** `ds-studio/test/unit/*.spec.js` (unit), `ds-studio/test/integration/*.spec.js` (playwright).  
**Chrome mock:** `jest-chrome` + custom `InMemoryStorageMock` (fixtures/chrome-storage-mock.js). Setup in `setup/vitest.setup.js`. Storage cleared `beforeEach`.

**Key patterns:**
- StorageManager tests: `import StorageManager from '../../utils/storage-manager.js'`; spy on `_set`, `_safeRemove` via `vi.spyOn`; restore in `afterEach`.
- Quota simulation: `chrome.storage.sync.setQuotaError(true)`; reset + `delete chrome.runtime.lastError` in `afterEach`.
- Popup function extraction: regex-extract named functions from popup.js + `new Function(...)` factory pattern (not `eval` with closures).
- DOMContentLoaded closures in popup.js cannot be extracted or spied on from outside — test observable storage state instead.
- `StorageManager.KEYS` available as `K` alias throughout tests.

**Pre-existing failures (not regression):**
- `unit/content-script.markdown.spec.js` — 5 failures: Windows CRLF vs LF line-ending mismatch in expected strings.
- `unit/storage-manager.quota.spec.js` — 1 failure: `recovers from quota error on subsequent successful saves` (dsPresetIndex still in dsLocalAuth after recovery).

**Why:** Memory preserves these so future sessions don't mistake them for new regressions.  
**How to apply:** When running full test suite, filter these out or expect them; only alert on new failures.
