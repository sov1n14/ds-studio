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
**Chrome mock:** `jest-chrome` was removed (see [[project_jest_chrome_removal]]) — `chrome.*` is now a hand-rolled `vi.fn()`-based mock written directly in `setup/vitest.setup.js`, plus the custom `InMemoryStorageMock` (fixtures/chrome-storage-mock.js) for `chrome.storage`. Storage cleared `beforeEach`.
**CRITICAL execution gotcha:** vitest MUST be run with cwd = `test/` (`cd ds-studio/test && npx vitest run`). Running from repo root skips `test/setup/vitest.setup.js` and produces a flood of bogus `chrome is not defined` failures — this has fooled multiple agents.

**Key patterns:**
- StorageManager tests: `import StorageManager from '../../utils/storage-manager.js'`; spy on `_set`, `_safeRemove` via `vi.spyOn`; restore in `afterEach`.
- Quota simulation: `chrome.storage.sync.setQuotaError(true)`; reset + `delete chrome.runtime.lastError` in `afterEach`.
- Popup function extraction: regex-extract named functions from popup.js + `new Function(...)` factory pattern (not `eval` with closures).
- DOMContentLoaded closures in popup.js cannot be extracted or spied on from outside — test observable storage state instead.
- `StorageManager.KEYS` available as `K` alias throughout tests.
- `utils/storage-manager.js` is a BARREL/MIXIN file only: it holds `KEYS`, `DEFAULTS`, error classes, and the simple one-line `saveX()` writers that call `this._set(...)`. The actual logic for `getSettings()`, `initialize()`, migration-push, sync/local reconciliation, presets, and chatmap lives in sibling files (`storage-manager.local.js`, `.sync.js`, `.presets.js`, `.chatmap.js`, `.chunk-lock.js`, `.init.js`) merged onto the same object via `Object.assign` at module load (see file header comment for load order). When "implementation blindness" forbids reading "the unit's implementation file", identify which of these 7 files actually contains the logic under test first — reading storage-manager.js alone for KEYS/DEFAULTS shape and writer-method style is safe and does not leak logic-layer behavior.
- All `test/unit/*.spec.js` files use CRLF line endings (confirmed again in storage-manager.spec.js / storage-manager.migration-push.spec.js) — same convention already noted for popup.js in [[project_popup_live_sync_tests]]. When editing these files via a scripted (non-Edit-tool) approach, normalize to plain-LF for anchor matching then re-serialize as CRLF, or line-level diffs will silently fail to match.
- This agent role sometimes has no Edit/Write tool available (Read/Glob/Grep/Bash/Skill/ToolSearch only). File edits then go through a small Node script run via Bash (Node v24 available in this repo); avoid heredoc + backslash-escaped quotes together (fragile under Git Bash quoting) — prefer template literals (backticks) for building multi-line JS source strings.

**Baseline as of 2026-07-25 (updated, second pass same day):** 86 files / 1736 tests / 0 failures on a clean full run from `test/`, after migrating `test/unit/sse-parser.spec.js` (7 tests) and deleting the orphaned `sse-parser.test.js` — see [[project_orphan_test_cleanup_2026-07-25]]. Prior baseline was 85/1729/0. The two failures previously logged here (CRLF/LF markdown mismatch, quota-recovery race) are STALE — did not reproduce. Treat any failure as a new regression until proven otherwise.

**Why:** Memory preserves the current known-good baseline so future sessions can immediately tell a new regression from noise.  
**How to apply:** Compare full-suite runs against 85/1729/0. Any deviation (file count, test count, or failures) is worth investigating before reporting.
