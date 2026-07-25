---
name: project-test-framework
description: ds-studio test framework setup, runner commands, file placement, and established patterns
metadata:
  type: project
---

**Test framework:** Vitest v3.2.4, environment `happy-dom`, globals enabled.  
**Runner:** `cd ds-studio/test && npm run test:unit` (vitest run).  
**Coverage:** v8, covers `../utils/**/*.js` and `../content/**/*.js`.  
**Test directory:** `ds-studio/test/unit/*.spec.js` only — this is enforced by `test/vitest.config.js`'s `include: ['unit/**/*.spec.js']`. Playwright/`test/integration/` is RETIRED (CLAUDE.md §3 bans e2e tests); as of 2026-07-25 the last Playwright infra file (`test/setup/playwright-extension.js`) and an unused fixture (`test/fixtures/presets.js`) were confirmed dead and deleted. Do not reference `test/integration/*.spec.js` as current — it no longer exists.  
**Chrome mock:** `jest-chrome` + custom `InMemoryStorageMock` (fixtures/chrome-storage-mock.js). Setup in `setup/vitest.setup.js`. Storage cleared `beforeEach`.
**CRITICAL execution gotcha:** vitest MUST be run with cwd = `test/` (`cd ds-studio/test && npx vitest run`). Running from repo root skips `test/setup/vitest.setup.js` and produces a flood of bogus `chrome is not defined` failures — this has fooled multiple agents.

**Key patterns:**
- StorageManager tests: `import StorageManager from '../../utils/storage-manager.js'`; spy on `_set`, `_safeRemove` via `vi.spyOn`; restore in `afterEach`.
- Quota simulation: `chrome.storage.sync.setQuotaError(true)`; reset + `delete chrome.runtime.lastError` in `afterEach`.
- Popup function extraction: regex-extract named functions from popup.js + `new Function(...)` factory pattern (not `eval` with closures).
- DOMContentLoaded closures in popup.js cannot be extracted or spied on from outside — test observable storage state instead.
- `StorageManager.KEYS` available as `K` alias throughout tests.

**Baseline as of 2026-07-25 (updated, second pass same day):** 86 files / 1736 tests / 0 failures on a clean full run from `test/`, after migrating `test/unit/sse-parser.spec.js` (7 tests) and deleting the orphaned `sse-parser.test.js` — see [[project_orphan_test_cleanup_2026-07-25]]. Prior baseline was 85/1729/0. The two failures previously logged here (CRLF/LF markdown mismatch, quota-recovery race) are STALE — did not reproduce. Treat any failure as a new regression until proven otherwise.

**Why:** Memory preserves the current known-good baseline so future sessions can immediately tell a new regression from noise.  
**How to apply:** Compare full-suite runs against 85/1729/0. Any deviation (file count, test count, or failures) is worth investigating before reporting.
